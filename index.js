const express = require('express');
const { createServer } = require('node:http');
const { join } = require('node:path');
const crypto = require('node:crypto');
const { Server } = require('socket.io');
const { Pool } = require('pg');
const bcrypt = require('bcrypt');

if (process.env.NODE_ENV !== 'production') {
  require('dotenv').config();
}

const app = express();
const server = createServer(app);

app.use(express.json());
app.use(express.static(__dirname));

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

const io = new Server(server);

function getTokenSecret() {
  return process.env.SESSION_SECRET || process.env.DATABASE_URL;
}

function normalizeUsername(username) {
  return String(username || '').trim().slice(0, 30);
}

function normalizePassword(password) {
  return String(password || '');
}

function encodePayload(payload) {
  return Buffer.from(JSON.stringify(payload)).toString('base64url');
}

function decodePayload(payloadBase64) {
  return JSON.parse(Buffer.from(payloadBase64, 'base64url').toString('utf8'));
}

function signPayload(payloadBase64) {
  return crypto
    .createHmac('sha256', getTokenSecret())
    .update(payloadBase64)
    .digest('base64url');
}

function createToken(user) {
  const payloadBase64 = encodePayload({
    id: user.id,
    username: user.username,
    createdAt: Date.now()
  });

  const signature = signPayload(payloadBase64);

  return `${payloadBase64}.${signature}`;
}

function verifyToken(token) {
  try {
    if (!token || typeof token !== 'string') {
      return null;
    }

    const [payloadBase64, signature] = token.split('.');

    if (!payloadBase64 || !signature) {
      return null;
    }

    const expectedSignature = signPayload(payloadBase64);

    const signatureBuffer = Buffer.from(signature);
    const expectedBuffer = Buffer.from(expectedSignature);

    if (signatureBuffer.length !== expectedBuffer.length) {
      return null;
    }

    const signatureOk = crypto.timingSafeEqual(
      signatureBuffer,
      expectedBuffer
    );

    if (!signatureOk) {
      return null;
    }

    const payload = decodePayload(payloadBase64);

    if (!payload.id || !payload.username) {
      return null;
    }

    return {
      id: payload.id,
      username: payload.username
    };
  } catch (e) {
    return null;
  }
}

async function initDb() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id BIGSERIAL PRIMARY KEY,
      username TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      created_at TIMESTAMPTZ DEFAULT now()
    );
  `);
}

function getOnlineCount() {
  let count = 0;

  for (const socket of io.sockets.sockets.values()) {
    if (socket.user) {
      count += 1;
    }
  }

  return count;
}

function emitOnlineCount() {
  io.emit('online count', getOnlineCount());
}

app.get('/', (req, res) => {
  res.sendFile(join(__dirname, 'index.html'));
});

app.post('/api/signup', async (req, res) => {
  const username = normalizeUsername(req.body.username);
  const password = normalizePassword(req.body.password);

  if (!username || password.length < 6) {
    return res.status(400).json({
      message: '아이디와 6자 이상 비밀번호가 필요합니다.'
    });
  }

  try {
    const existing = await pool.query(
      'SELECT id FROM users WHERE username = $1',
      [username]
    );

    if (existing.rows.length > 0) {
      return res.status(409).json({
        message: '이미 사용 중인 아이디입니다.'
      });
    }

    const passwordHash = await bcrypt.hash(password, 12);

    const result = await pool.query(
      `
      INSERT INTO users (username, password_hash)
      VALUES ($1, $2)
      RETURNING id, username
      `,
      [username, passwordHash]
    );

    return res.status(201).json({
      message: '회원가입 완료',
      user: result.rows[0]
    });
  } catch (e) {
    console.error('signup error:', e);

    if (e.code === '23505') {
      return res.status(409).json({
        message: '이미 사용 중인 아이디입니다.'
      });
    }

    return res.status(500).json({
      message: '회원가입 실패'
    });
  }
});

app.post('/api/login', async (req, res) => {
  const username = normalizeUsername(req.body.username);
  const password = normalizePassword(req.body.password);

  if (!username || password.length < 6) {
    return res.status(400).json({
      message: '아이디와 6자 이상 비밀번호가 필요합니다.'
    });
  }

  try {
    const result = await pool.query(
      'SELECT id, username, password_hash FROM users WHERE username = $1',
      [username]
    );

    if (result.rows.length === 0) {
      return res.status(401).json({
        message: '아이디 또는 비밀번호가 틀렸습니다.'
      });
    }

    const user = result.rows[0];
    const passwordOk = await bcrypt.compare(password, user.password_hash);

    if (!passwordOk) {
      return res.status(401).json({
        message: '아이디 또는 비밀번호가 틀렸습니다.'
      });
    }

    const token = createToken(user);

    return res.json({
      user: {
        id: user.id,
        username: user.username
      },
      token
    });
  } catch (e) {
    console.error('login error:', e);

    return res.status(500).json({
      message: '로그인 실패'
    });
  }
});

app.get('/api/debug-users', async (req, res) => {
  if (process.env.NODE_ENV === 'production') {
    return res.status(404).json({ message: 'Not found' });
  }

  try {
    const result = await pool.query(`
      SELECT id, username, created_at
      FROM users
      ORDER BY id DESC
      LIMIT 20
    `);

    return res.json(result.rows);
  } catch (e) {
    console.error('debug users error:', e);

    return res.status(500).json({
      message: '사용자 조회 실패'
    });
  }
});

io.on('connection', (socket) => {
  const user = verifyToken(socket.handshake.auth.token);

  if (!user) {
    socket.emit('auth error', '로그인이 필요합니다.');
    socket.disconnect();
    return;
  }

  socket.user = user;

  io.emit('system message', `[${user.username}] 님이 접속했습니다.`);
  emitOnlineCount();

  socket.on('chat message', (msg, callback) => {
    const safeMsg = String(msg || '').trim().slice(0, 500);

    if (!safeMsg) {
      callback?.();
      return;
    }

    io.emit('chat message', socket.user.username, safeMsg);

    callback?.();
  });

  socket.on('disconnect', () => {
    if (socket.user) {
      io.emit('system message', `[${socket.user.username}] 님이 퇴장했습니다.`);
      emitOnlineCount();
    }
  });
});

async function main() {
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL environment variable is required.');
  }

  await initDb();

  const port = process.env.PORT || 3000;

  server.listen(port, () => {
    console.log(`server running on port ${port}`);
  });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});