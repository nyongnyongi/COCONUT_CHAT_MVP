const express = require('express');
const { createServer } = require('node:http');
const { join } = require('node:path');
const { Server } = require('socket.io');
const { Pool } = require('pg');

// 변경: 로컬에서 .env 파일을 쓸 수 있게 함.
// 배포 환경(Render 등)에서는 환경변수로 DATABASE_URL을 넣으면 됨.
if (process.env.NODE_ENV !== 'production') {
  require('dotenv').config();
}

const app = express();
const server = createServer(app);

// 변경: SQLite 대신 Postgres 연결.
// DATABASE_URL은 Supabase/Render 환경변수에 넣는 값.
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production'
    ? { rejectUnauthorized: false }
    : false
});

const io = new Server(server, {
  connectionStateRecovery: {}
});

async function initDb() {
  // 변경: 메시지를 Postgres messages 테이블에 저장.
  // nickname은 “회원 계정”이 아니라 메시지에 붙는 표시 이름.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS messages (
      id BIGSERIAL PRIMARY KEY,
      client_offset TEXT UNIQUE,
      nickname TEXT,
      content TEXT NOT NULL,
      created_at TIMESTAMPTZ DEFAULT now()
    );
  `);
}

app.use(express.static(__dirname));

app.get('/', (req, res) => {
  res.sendFile(join(__dirname, 'index.html'));
});

io.on('connection', async (socket) => {
  socket.on('set nickname', (nickname, callback) => {
    // 변경: 서버에서도 닉네임을 정리하고 길이를 제한.
    socket.nickname = String(nickname || '익명').trim().slice(0, 20) || '익명';

    io.emit('system message', `[${socket.nickname}] 님이 접속했습니다.`);

    // 변경: 클라이언트 retries 옵션 때문에 ack 응답을 보냄.
    callback?.();
  });

  socket.on('chat message', async (nickname, msg, clientOffset, callback) => {
    // 변경: 클라이언트 값은 믿지 않고 서버에서 한 번 더 정리.
    const safeNickname = String(nickname || socket.nickname || '익명')
      .trim()
      .slice(0, 20) || '익명';

    const safeMsg = String(msg || '').trim().slice(0, 500);

    if (!safeMsg) {
      callback?.();
      return;
    }

    try {
      const result = await pool.query(
        `
        INSERT INTO messages (nickname, content, client_offset)
        VALUES ($1, $2, $3)
        RETURNING id
        `,
        [safeNickname, safeMsg, clientOffset]
      );

      io.emit('chat message', safeNickname, safeMsg, result.rows[0].id);
      callback?.();
    } catch (e) {
      // 변경: client_offset UNIQUE 중복이면 이미 처리된 메시지라 ack만 보냄.
      if (e.code === '23505') {
        callback?.();
        return;
      }

      console.error(e);
    }
  });

  socket.on('disconnect', () => {
    if (socket.nickname) {
      io.emit('system message', `[${socket.nickname}] 님이 퇴장했습니다.`);
    }
  });

  // 변경: 연결 복구가 안 된 경우, 마지막으로 받은 메시지 이후 기록을 다시 보내줌.
  if (!socket.recovered) {
    try {
      const serverOffset = Number(socket.handshake.auth.serverOffset || 0);

      const result = await pool.query(
        `
        SELECT id, nickname, content
        FROM messages
        WHERE id > $1
        ORDER BY id ASC
        `,
        [serverOffset]
      );

      for (const row of result.rows) {
        socket.emit(
          'chat message',
          row.nickname || '익명',
          row.content,
          row.id
        );
      }
    } catch (e) {
      console.error(e);
    }
  }
});

async function main() {
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL 환경변수가 필요합니다.');
  }

  await initDb();

  // 변경: 배포 플랫폼은 process.env.PORT 하나만 사용.
  const port = process.env.PORT || 3000;

  server.listen(port, () => {
    console.log(`server running on port ${port}`);
  });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});