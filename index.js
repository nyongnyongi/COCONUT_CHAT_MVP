const express = require('express');
const { createServer } = require('node:http');
const { join } = require('node:path');
const { Server } = require('socket.io');
const sqlite3 = require('sqlite3');
const { open } = require('sqlite');
const { availableParallelism } = require('node:os');
const cluster = require('node:cluster');
const { createAdapter, setupPrimary } = require('@socket.io/cluster-adapter');

if (cluster.isPrimary) {
  const numCPUs = availableParallelism();

  for (let i = 0; i < numCPUs; i++) {
    cluster.fork({
      PORT: 3000 + i
    });
  }

  return setupPrimary();
}

async function main() {
  const db = await open({
    filename: 'chat.db',
    driver: sqlite3.Database
  });

  await db.exec(`
    CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      client_offset TEXT UNIQUE,
      content TEXT
    );
  `);


  // 기존 chat.db에는 nickname 컬럼이 없을 수 있음.
  // cluster에서는 여러 worker가 동시에 실행되므로 ALTER TABLE 에러를 안전하게 처리함.
  const columns = await db.all('PRAGMA table_info(messages)');
  const hasNicknameColumn = columns.some((column) => column.name === 'nickname');

  if (!hasNicknameColumn) {
    try {
      await db.exec('ALTER TABLE messages ADD COLUMN nickname TEXT');
    } catch (e) {
      // 다른 worker가 먼저 nickname 컬럼을 추가했을 수 있음.
      if (!String(e.message).includes('duplicate column name')) {
        throw e;
      }
    }
  }

  await db.exec('DELETE FROM messages');

  const app = express();
  const server = createServer(app);

  const io = new Server(server, {
    connectionStateRecovery: {},
    adapter: createAdapter()
  });

  app.get('/', (req, res) => {
    res.sendFile(join(__dirname, 'index.html'));
  });

  io.on('connection', async (socket) => {
    socket.on('chat message', async (nickname, msg, clientOffset, callback) => {
      let result;

      try {
        // 기존에는 content만 저장했음.
        // 닉네임을 같이 보여주려면 DB에도 nickname을 저장해야 함.
        result = await db.run(
          'INSERT INTO messages (nickname, content, client_offset) VALUES (?, ?, ?)',
          nickname,
          msg,
          clientOffset
        );
      } catch (e) {
        if (e.errno === 19) {
          if (callback) callback();
        } else {
          console.error(e);
        }

        return;
      }

      // 클라이언트가 nickname, msg, serverOffset 순서로 받게 보냄.
      io.emit('chat message', nickname, msg, result.lastID);

      if (callback) {
        callback();
      }
    });

    if (!socket.recovered) {
      try {
        await db.each(
          'SELECT id, nickname, content FROM messages WHERE id > ?',
          [socket.handshake.auth.serverOffset || 0],
          (_err, row) => {
            socket.emit(
              'chat message',
              row.nickname || '익명',
              row.content,
              row.id
            );
          }
        );
      } catch (e) {
        console.error(e);
      }
    }
  });

  const port = process.env.PORT;

  server.listen(port, () => {
    console.log(`server running at http://localhost:${port}`);
  });
}

main();

/*io.on('connection', (socket) => {
    console.log('a user connected');
    socket.on('disconnect', () => {
        console.log('user disconnected');
    });
});*/

/*io.on('connection', (socket) => {
    socket.on('chat message', (msg) => {
        console.log('message: ' + msg);
    });
});*/

/*io.on('connection', (socket) => {
    socket.on('chat message', (msg) => {
        io.emit('chat message', msg);
    });
});*/


/*socket.emit('hello', 'world');
//emit은 이벤트를 보낸다는 뜻: '서버야,hello라는 이벤트를 보낼게. 데이터는 "world" 야.'
io.on('connection', (socket) => {
    socket.on('hello', (arg) => {
        //누가 "hello" 이벤트를 보내면 실행
        console.log(arg);
    });
});*/

/*socket.emit('join', '시우');
socket.emit('message', '안녕하세요');
socket.emit('leave', '시우');

socket.on('join', (name) => {
    console.log('입장:', name);
});

socket.on('message', (msg) => {
    console.log('메시지:', msg);
});

socket.on('leave', (leave) => {
    console.log('이름:', leave);
})*/ 

//이런 식으로 socket. on 을 써버리면 각각의 이벤트에 대해 하나씩 만들어야 한다. 

/*socket.onAny((event, ...args) => {
    console.log('이벤트:', event);
    console.log('데이터:', args);
});

socket.emit('join', '시우');
socket.emit('message', '안녕하세요');
socket.emit('leave', '시우');*/

//onAny를 쓰면 모든 이벤트에 대하여 동일한 서식을 적용한다. 

/*io.on('connection', (socket) => {
    socket.join('some room');

    io.to('some room').emit('hello', 'world');

    io.except('some room').emit('hello', 'world');

    socket.leave('some room');
});*/