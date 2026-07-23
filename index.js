const express = require('express');
const { createServer } = require('node:http');
const { join } = require('node:path');
const crypto = require('node:crypto');
const { Server } = require('socket.io');
const { Pool } = require('pg');
const bcrypt = require('bcrypt');
const webpush = require('web-push');

if (process.env.NODE_ENV !== 'production') {
  require('dotenv').config();
}

const app = express();
const server = createServer(app);

app.use(express.json());
app.use(express.static(__dirname));

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL?.includes('localhost')
    ? false
    : { rejectUnauthorized: false }
});

const io = new Server(server);

const vapidPublicKey = process.env.VAPID_PUBLIC_KEY || '';
const vapidPrivateKey = process.env.VAPID_PRIVATE_KEY || '';

if (vapidPublicKey && vapidPrivateKey) {
  webpush.setVapidDetails(
    process.env.VAPID_SUBJECT || 'mailto:coconut-chat@example.com',
    vapidPublicKey,
    vapidPrivateKey
  );
}

function getTokenSecret() {
  return process.env.SESSION_SECRET || process.env.DATABASE_URL;
}

function normalizeUsername(username) {
  return String(username || '').trim().slice(0, 30);
}

function normalizePassword(password) {
  return String(password || '');
}

function normalizeNickname(nickname) {
  return String(nickname || '').trim().slice(0, 30);
}

function normalizeMessage(message) {
  return String(message || '').trim().slice(0, 500);
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
    id: String(user.id),
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

    if (!crypto.timingSafeEqual(signatureBuffer, expectedBuffer)) {
      return null;
    }

    const payload = decodePayload(payloadBase64);

    if (!payload.id || !payload.username) {
      return null;
    }

    return {
      id: String(payload.id),
      username: payload.username
    };
  } catch (e) {
    return null;
  }
}

function createFriendCode() {
  return crypto.randomBytes(4).toString('hex').toUpperCase();
}

async function createUniqueFriendCode() {
  while (true) {
    const code = createFriendCode();

    const existing = await pool.query(
      'SELECT id FROM users WHERE friend_code = $1',
      [code]
    );

    if (existing.rows.length === 0) {
      return code;
    }
  }
}

function toPublicUser(user) {
  return {
    id: String(user.id),
    username: user.username,
    nickname: user.nickname || user.username,
    profileImage: user.profile_image || '',
    statusMessage: user.status_message || '',
    friendCode: user.friend_code
  };
}

function toPublicMessage(message) {
  return {
    id: String(message.id),
    roomId: String(message.room_id),
    senderId: String(message.sender_id),
    senderName: message.sender_name,
    profileImage: message.profile_image || '',
    unreadCount: Number(message.unread_count || 0),
    content: message.deleted_for_everyone
      ? '삭제된 메시지입니다.'
      : message.content,
    deletedForEveryone: message.deleted_for_everyone,
    createdAt: message.created_at
  };
}

async function getUserById(id) {
  const result = await pool.query(
    `
    SELECT id, username, nickname, profile_image, status_message, friend_code, created_at
    FROM users
    WHERE id = $1
    `,
    [id]
  );

  return result.rows[0] || null;
}

async function requireAuth(req, res, next) {
  try {
    const authHeader = req.headers.authorization || '';
    const token = authHeader.startsWith('Bearer ')
      ? authHeader.slice('Bearer '.length)
      : null;

    const tokenUser = verifyToken(token);

    if (!tokenUser) {
      return res.status(401).json({
        message: '로그인이 필요합니다.'
      });
    }

    const user = await getUserById(tokenUser.id);

    if (!user) {
      return res.status(401).json({
        message: '사용자를 찾을 수 없습니다.'
      });
    }

    req.user = user;
    next();
  } catch (e) {
    console.error('requireAuth error:', e);

    return res.status(500).json({
      message: '인증 처리 중 오류가 발생했습니다.'
    });
  }
}

async function requireRoomMember(roomId, userId) {
  const result = await pool.query(
    `
    SELECT room_id, user_id, last_read_message_id, left_at
    FROM room_members
    WHERE room_id = $1
      AND user_id = $2
      AND left_at IS NULL
    `,
    [roomId, userId]
  );

  return result.rows[0] || null;
}

async function getActiveRoomMemberIds(roomId) {
  const result = await pool.query(
    `
    SELECT user_id
    FROM room_members
    WHERE room_id = $1
      AND left_at IS NULL
    `,
    [roomId]
  );

  return result.rows.map((row) => String(row.user_id));
}

function joinUserPersonalRoom(socket) {
  socket.join(`user:${socket.user.id}`);
}

async function joinUserChatRooms(socket) {
  const result = await pool.query(
    `
    SELECT room_id
    FROM room_members
    WHERE user_id = $1
      AND left_at IS NULL
    `,
    [socket.user.id]
  );

  for (const row of result.rows) {
    socket.join(`room:${row.room_id}`);
  }
}

function emitUserStateChanged(userId) {
  io.to(`user:${userId}`).emit('friends changed');
  io.to(`user:${userId}`).emit('rooms changed');
}

function isPushConfigured() {
  return Boolean(vapidPublicKey && vapidPrivateKey);
}

async function getUnreadRoomCountForUser(userId) {
  const result = await pool.query(
    `
    SELECT COALESCE(SUM(unread_count), 0) AS total_unread_count
    FROM (
      SELECT
        COUNT(msg.id) FILTER (
          WHERE msg.id > COALESCE(rm.last_read_message_id, 0)
            AND msg.sender_id <> $1
            AND msg.deleted_for_everyone = false
        ) AS unread_count
      FROM rooms r
      JOIN room_members rm ON rm.room_id = r.id
      LEFT JOIN room_messages msg ON msg.room_id = r.id
      WHERE rm.user_id = $1
        AND rm.left_at IS NULL
      GROUP BY r.id, rm.last_read_message_id
    ) unread_rooms
    `,
    [userId]
  );

  return Number(result.rows[0]?.total_unread_count || 0);
}

async function sendUnreadPushToUsers(userIds) {
  if (!isPushConfigured() || userIds.length === 0) {
    return;
  }

  const uniqueUserIds = [...new Set(userIds.map(String))];

  for (const userId of uniqueUserIds) {
    const totalUnreadCount = await getUnreadRoomCountForUser(userId);

    if (totalUnreadCount <= 0) {
      continue;
    }

    const subscriptions = await pool.query(
      `
      SELECT id, endpoint, p256dh, auth
      FROM push_subscriptions
      WHERE user_id = $1
      `,
      [userId]
    );

    const payload = JSON.stringify({
      title: 'Coconut Chat',
      body: `안 읽은 메시지 ${totalUnreadCount}개`,
      unreadCount: totalUnreadCount
    });

    for (const subscription of subscriptions.rows) {
      try {
        await webpush.sendNotification(
          {
            endpoint: subscription.endpoint,
            keys: {
              p256dh: subscription.p256dh,
              auth: subscription.auth
            }
          },
          payload
        );
      } catch (e) {
        if (e.statusCode === 404 || e.statusCode === 410) {
          await pool.query(
            'DELETE FROM push_subscriptions WHERE id = $1',
            [subscription.id]
          );
        } else {
          console.error('push send error:', e);
        }
      }
    }
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

  await pool.query('ALTER TABLE users ADD COLUMN IF NOT EXISTS nickname TEXT;');
  await pool.query("ALTER TABLE users ADD COLUMN IF NOT EXISTS profile_image TEXT DEFAULT '';");
  await pool.query("ALTER TABLE users ADD COLUMN IF NOT EXISTS status_message TEXT DEFAULT '';");
  await pool.query('ALTER TABLE users ADD COLUMN IF NOT EXISTS friend_code TEXT UNIQUE;');

  await pool.query(`
    CREATE TABLE IF NOT EXISTS friendships (
      user_id BIGINT REFERENCES users(id) ON DELETE CASCADE,
      friend_id BIGINT REFERENCES users(id) ON DELETE CASCADE,
      created_at TIMESTAMPTZ DEFAULT now(),
      PRIMARY KEY (user_id, friend_id)
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS blocked_users (
      user_id BIGINT REFERENCES users(id) ON DELETE CASCADE,
      blocked_user_id BIGINT REFERENCES users(id) ON DELETE CASCADE,
      created_at TIMESTAMPTZ DEFAULT now(),
      PRIMARY KEY (user_id, blocked_user_id)
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS rooms (
      id BIGSERIAL PRIMARY KEY,
      name TEXT,
      type TEXT NOT NULL CHECK (type IN ('direct', 'group')),
      created_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ DEFAULT now()
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS room_members (
      room_id BIGINT REFERENCES rooms(id) ON DELETE CASCADE,
      user_id BIGINT REFERENCES users(id) ON DELETE CASCADE,
      last_read_message_id BIGINT DEFAULT 0,
      joined_at TIMESTAMPTZ DEFAULT now(),
      left_at TIMESTAMPTZ,
      PRIMARY KEY (room_id, user_id)
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS room_messages (
      id BIGSERIAL PRIMARY KEY,
      room_id BIGINT REFERENCES rooms(id) ON DELETE CASCADE,
      sender_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
      content TEXT NOT NULL,
      deleted_for_everyone BOOLEAN DEFAULT false,
      deleted_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ DEFAULT now()
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS room_message_deletions (
      message_id BIGINT REFERENCES room_messages(id) ON DELETE CASCADE,
      user_id BIGINT REFERENCES users(id) ON DELETE CASCADE,
      deleted_at TIMESTAMPTZ DEFAULT now(),
      PRIMARY KEY (message_id, user_id)
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS push_subscriptions (
      id BIGSERIAL PRIMARY KEY,
      user_id BIGINT REFERENCES users(id) ON DELETE CASCADE,
      endpoint TEXT UNIQUE NOT NULL,
      p256dh TEXT NOT NULL,
      auth TEXT NOT NULL,
      created_at TIMESTAMPTZ DEFAULT now()
    );
  `);

  await pool.query('ALTER TABLE room_messages ADD COLUMN IF NOT EXISTS deleted_for_everyone BOOLEAN DEFAULT false;');
  await pool.query('ALTER TABLE room_messages ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;');

  await pool.query('UPDATE users SET nickname = username WHERE nickname IS NULL;');
  await pool.query("UPDATE users SET profile_image = '' WHERE profile_image IS NULL;");
  await pool.query("UPDATE users SET status_message = '' WHERE status_message IS NULL;");

  const usersWithoutCode = await pool.query(`
    SELECT id
    FROM users
    WHERE friend_code IS NULL
  `);

  for (const user of usersWithoutCode.rows) {
    const friendCode = await createUniqueFriendCode();

    await pool.query(
      'UPDATE users SET friend_code = $1 WHERE id = $2',
      [friendCode, user.id]
    );
  }
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
    const passwordHash = await bcrypt.hash(password, 12);
    const friendCode = await createUniqueFriendCode();

    const result = await pool.query(
      `
      INSERT INTO users (username, password_hash, nickname, profile_image, friend_code)
      VALUES ($1, $2, $3, $4, $5)
      RETURNING id, username, nickname, profile_image, status_message, friend_code
      `,
      [username, passwordHash, username, '', friendCode]
    );

    return res.status(201).json({
      message: '회원가입 완료',
      user: toPublicUser(result.rows[0])
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
      `
      SELECT id, username, password_hash, nickname, profile_image, status_message, friend_code
      FROM users
      WHERE username = $1
      `,
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

    return res.json({
      user: toPublicUser(user),
      token: createToken(user)
    });
  } catch (e) {
    console.error('login error:', e);

    return res.status(500).json({
      message: '로그인 실패'
    });
  }
});

app.get('/api/me', requireAuth, async (req, res) => {
  return res.json({
    user: toPublicUser(req.user)
  });
});

app.get('/api/push/public-key', requireAuth, async (req, res) => {
  return res.json({
    publicKey: vapidPublicKey,
    enabled: isPushConfigured()
  });
});

app.post('/api/push/subscription', requireAuth, async (req, res) => {
  const subscription = req.body.subscription;
  const endpoint = String(subscription?.endpoint || '').trim();
  const p256dh = String(subscription?.keys?.p256dh || '').trim();
  const auth = String(subscription?.keys?.auth || '').trim();

  if (!endpoint || !p256dh || !auth) {
    return res.status(400).json({
      message: '푸시 구독 정보가 올바르지 않습니다.'
    });
  }

  try {
    await pool.query(
      `
      INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth)
      VALUES ($1, $2, $3, $4)
      ON CONFLICT (endpoint)
      DO UPDATE SET
        user_id = EXCLUDED.user_id,
        p256dh = EXCLUDED.p256dh,
        auth = EXCLUDED.auth
      `,
      [req.user.id, endpoint, p256dh, auth]
    );

    return res.json({
      message: '푸시 알림을 등록했습니다.'
    });
  } catch (e) {
    console.error('push subscription save error:', e);

    return res.status(500).json({
      message: '푸시 알림 등록 실패'
    });
  }
});

app.patch('/api/me/nickname', requireAuth, async (req, res) => {
  const nickname = normalizeNickname(req.body.nickname);

  if (!nickname) {
    return res.status(400).json({
      message: '닉네임을 입력하세요.'
    });
  }

  try {
    const result = await pool.query(
      `
      UPDATE users
      SET nickname = $1
      WHERE id = $2
      RETURNING id, username, nickname, profile_image, status_message, friend_code
      `,
      [nickname, req.user.id]
    );

    return res.json({
      message: '닉네임을 수정했습니다.',
      user: toPublicUser(result.rows[0])
    });
  } catch (e) {
    console.error('nickname update error:', e);

    return res.status(500).json({
      message: '닉네임 수정 실패'
    });
  }
});

app.patch('/api/me/profile-image', requireAuth, async (req, res) => {
  const profileImage = String(req.body.profileImage || '').trim().slice(0, 500);

  try {
    const result = await pool.query(
      `
      UPDATE users
      SET profile_image = $1
      WHERE id = $2
      RETURNING id, username, nickname, profile_image, status_message, friend_code
      `,
      [profileImage, req.user.id]
    );

    return res.json({
      message: '프로필 이미지를 수정했습니다.',
      user: toPublicUser(result.rows[0])
    });
  } catch (e) {
    console.error('profile image update error:', e);

    return res.status(500).json({
      message: '프로필 이미지 수정 실패'
    });
  }
});

app.patch('/api/me/status-message', requireAuth, async (req, res) => {
  const statusMessage = String(req.body.statusMessage || '').trim().slice(0, 80);

  try {
    const result = await pool.query(
      `
      UPDATE users
      SET status_message = $1
      WHERE id = $2
      RETURNING id, username, nickname, profile_image, status_message, friend_code
      `,
      [statusMessage, req.user.id]
    );

    return res.json({
      message: '상태메시지를 수정했습니다.',
      user: toPublicUser(result.rows[0])
    });
  } catch (e) {
    console.error('status message update error:', e);

    return res.status(500).json({
      message: '상태메시지 수정 실패'
    });
  }
});

app.patch('/api/me/username', requireAuth, async (req, res) => {
  const newUsername = normalizeUsername(req.body.newUsername);
  const currentPassword = normalizePassword(req.body.currentPassword);

  if (!newUsername || !currentPassword) {
    return res.status(400).json({
      message: '새 아이디와 현재 비밀번호를 입력하세요.'
    });
  }

  try {
    const currentUserResult = await pool.query(
      'SELECT id, password_hash FROM users WHERE id = $1',
      [req.user.id]
    );

    const currentUser = currentUserResult.rows[0];
    const passwordOk = await bcrypt.compare(
      currentPassword,
      currentUser.password_hash
    );

    if (!passwordOk) {
      return res.status(401).json({
        message: '현재 비밀번호가 올바르지 않습니다.'
      });
    }

    const result = await pool.query(
      `
      UPDATE users
      SET username = $1
      WHERE id = $2
      RETURNING id, username, nickname, profile_image, status_message, friend_code
      `,
      [newUsername, req.user.id]
    );

    const user = result.rows[0];

    return res.json({
      message: '아이디를 변경했습니다.',
      user: toPublicUser(user),
      token: createToken(user)
    });
  } catch (e) {
    console.error('username update error:', e);

    if (e.code === '23505') {
      return res.status(409).json({
        message: '이미 사용 중인 아이디입니다.'
      });
    }

    return res.status(500).json({
      message: '아이디 변경 실패'
    });
  }
});

app.patch('/api/me/password', requireAuth, async (req, res) => {
  const currentPassword = normalizePassword(req.body.currentPassword);
  const newPassword = normalizePassword(req.body.newPassword);
  const newPasswordConfirm = normalizePassword(req.body.newPasswordConfirm);

  if (!currentPassword || !newPassword || !newPasswordConfirm) {
    return res.status(400).json({
      message: '현재 비밀번호와 새 비밀번호를 모두 입력하세요.'
    });
  }

  if (newPassword.length < 6) {
    return res.status(400).json({
      message: '새 비밀번호는 6자 이상이어야 합니다.'
    });
  }

  if (newPassword !== newPasswordConfirm) {
    return res.status(400).json({
      message: '새 비밀번호가 서로 일치하지 않습니다.'
    });
  }

  try {
    const result = await pool.query(
      'SELECT id, password_hash FROM users WHERE id = $1',
      [req.user.id]
    );

    const user = result.rows[0];
    const passwordOk = await bcrypt.compare(
      currentPassword,
      user.password_hash
    );

    if (!passwordOk) {
      return res.status(401).json({
        message: '현재 비밀번호가 올바르지 않습니다.'
      });
    }

    const newPasswordHash = await bcrypt.hash(newPassword, 12);

    await pool.query(
      'UPDATE users SET password_hash = $1 WHERE id = $2',
      [newPasswordHash, req.user.id]
    );

    return res.json({
      message: '비밀번호를 변경했습니다.'
    });
  } catch (e) {
    console.error('password update error:', e);

    return res.status(500).json({
      message: '비밀번호 변경 실패'
    });
  }
});

app.post('/api/friends/by-code', requireAuth, async (req, res) => {
  const friendCode = String(req.body.friendCode || '').trim().toUpperCase();

  if (!friendCode) {
    return res.status(400).json({
      message: '친구 코드를 입력하세요.'
    });
  }

  try {
    const friendResult = await pool.query(
      `
      SELECT id, username, nickname, profile_image, status_message, friend_code
      FROM users
      WHERE friend_code = $1
      `,
      [friendCode]
    );

    const friend = friendResult.rows[0];

    if (!friend) {
      return res.status(404).json({
        message: '해당 친구 코드를 찾을 수 없습니다.'
      });
    }

    if (String(friend.id) === String(req.user.id)) {
      return res.status(400).json({
        message: '자기 자신은 친구로 추가할 수 없습니다.'
      });
    }

    await pool.query(
      `
      DELETE FROM blocked_users
      WHERE user_id = $1
        AND blocked_user_id = $2
      `,
      [req.user.id, friend.id]
    );

    await pool.query(
      `
      INSERT INTO friendships (user_id, friend_id)
      VALUES ($1, $2), ($2, $1)
      ON CONFLICT DO NOTHING
      `,
      [req.user.id, friend.id]
    );

    emitUserStateChanged(req.user.id);
    emitUserStateChanged(friend.id);

    return res.status(201).json({
      message: '친구를 추가했습니다.',
      friend: toPublicUser(friend)
    });
  } catch (e) {
    console.error('friend add error:', e);

    return res.status(500).json({
      message: '친구 추가 실패'
    });
  }
});

app.post('/api/friends/by-user/:userId', requireAuth, async (req, res) => {
  const targetUserId = req.params.userId;

  if (String(targetUserId) === String(req.user.id)) {
    return res.status(400).json({
      message: '자기 자신은 친구로 추가할 수 없습니다.'
    });
  }

  try {
    const targetResult = await pool.query(
      `
      SELECT id, username, nickname, profile_image, status_message, friend_code
      FROM users
      WHERE id = $1
      `,
      [targetUserId]
    );

    const targetUser = targetResult.rows[0];

    if (!targetUser) {
      return res.status(404).json({
        message: '사용자를 찾을 수 없습니다.'
      });
    }

    await pool.query(
      `
      DELETE FROM blocked_users
      WHERE user_id = $1
        AND blocked_user_id = $2
      `,
      [req.user.id, targetUserId]
    );

    await pool.query(
      `
      INSERT INTO friendships (user_id, friend_id)
      VALUES ($1, $2), ($2, $1)
      ON CONFLICT DO NOTHING
      `,
      [req.user.id, targetUserId]
    );

    emitUserStateChanged(req.user.id);
    emitUserStateChanged(targetUserId);

    return res.status(201).json({
      message: '친구를 추가했습니다.',
      friend: toPublicUser(targetUser)
    });
  } catch (e) {
    console.error('friend add by user error:', e);

    return res.status(500).json({
      message: '친구 추가 실패'
    });
  }
});

app.get('/api/friends', requireAuth, async (req, res) => {
  try {
    const result = await pool.query(
      `
      SELECT u.id, u.username, u.nickname, u.profile_image, u.status_message, u.friend_code
      FROM friendships f
      JOIN users u ON u.id = f.friend_id
      WHERE f.user_id = $1
      ORDER BY u.nickname, u.username
      `,
      [req.user.id]
    );

    return res.json({
      friends: result.rows.map(toPublicUser)
    });
  } catch (e) {
    console.error('friends list error:', e);

    return res.status(500).json({
      message: '친구 목록 조회 실패'
    });
  }
});

app.delete('/api/friends/:friendId', requireAuth, async (req, res) => {
  const friendId = req.params.friendId;

  try {
    await pool.query(
      `
      DELETE FROM friendships
      WHERE (user_id = $1 AND friend_id = $2)
         OR (user_id = $2 AND friend_id = $1)
      `,
      [req.user.id, friendId]
    );

    emitUserStateChanged(req.user.id);
    emitUserStateChanged(friendId);

    return res.json({
      message: '친구를 삭제했습니다.'
    });
  } catch (e) {
    console.error('friend delete error:', e);

    return res.status(500).json({
      message: '친구 삭제 실패'
    });
  }
});

app.post('/api/blocks/:userId', requireAuth, async (req, res) => {
  const blockedUserId = req.params.userId;

  if (String(blockedUserId) === String(req.user.id)) {
    return res.status(400).json({
      message: '자기 자신은 차단할 수 없습니다.'
    });
  }

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const targetResult = await client.query(
      'SELECT id FROM users WHERE id = $1',
      [blockedUserId]
    );

    if (targetResult.rows.length === 0) {
      await client.query('ROLLBACK');

      return res.status(404).json({
        message: '사용자를 찾을 수 없습니다.'
      });
    }

    await client.query(
      `
      INSERT INTO blocked_users (user_id, blocked_user_id)
      VALUES ($1, $2)
      ON CONFLICT DO NOTHING
      `,
      [req.user.id, blockedUserId]
    );

    await client.query(
      `
      DELETE FROM friendships
      WHERE (user_id = $1 AND friend_id = $2)
         OR (user_id = $2 AND friend_id = $1)
      `,
      [req.user.id, blockedUserId]
    );

    const directRoomsResult = await client.query(
      `
      SELECT r.id
      FROM rooms r
      JOIN room_members m1 ON m1.room_id = r.id AND m1.user_id = $1
      JOIN room_members m2 ON m2.room_id = r.id AND m2.user_id = $2
      WHERE r.type = 'direct'
        AND m1.left_at IS NULL
        AND m2.left_at IS NULL
      `,
      [req.user.id, blockedUserId]
    );

    for (const room of directRoomsResult.rows) {
      await client.query(
        `
        UPDATE room_members
        SET left_at = now()
        WHERE room_id = $1
          AND user_id = $2
        `,
        [room.id, req.user.id]
      );
    }

    await client.query('COMMIT');

    emitUserStateChanged(req.user.id);
    emitUserStateChanged(blockedUserId);

    return res.json({
      message: '사용자를 차단했습니다.'
    });
  } catch (e) {
    await client.query('ROLLBACK');

    console.error('block user error:', e);

    return res.status(500).json({
      message: '차단 실패'
    });
  } finally {
    client.release();
  }
});

app.post('/api/rooms/direct', requireAuth, async (req, res) => {
  const friendId = req.body.friendId;

  if (!friendId) {
    return res.status(400).json({
      message: '친구를 선택하세요.'
    });
  }

  try {
    const friendship = await pool.query(
      `
      SELECT 1
      FROM friendships
      WHERE user_id = $1
        AND friend_id = $2
      `,
      [req.user.id, friendId]
    );

    if (friendship.rows.length === 0) {
      return res.status(403).json({
        message: '친구만 1:1 채팅을 시작할 수 있습니다.'
      });
    }

    const blockResult = await pool.query(
      `
      SELECT 1
      FROM blocked_users
      WHERE (user_id = $1 AND blocked_user_id = $2)
         OR (user_id = $2 AND blocked_user_id = $1)
      `,
      [req.user.id, friendId]
    );

    if (blockResult.rows.length > 0) {
      return res.status(403).json({
        message: '차단된 사용자와는 1:1 채팅을 시작할 수 없습니다.'
      });
    }

    const existingRoom = await pool.query(
      `
      SELECT r.id, r.name, r.type, r.created_at
      FROM rooms r
      JOIN room_members m1 ON m1.room_id = r.id AND m1.user_id = $1
      JOIN room_members m2 ON m2.room_id = r.id AND m2.user_id = $2
      WHERE r.type = 'direct'
        AND m1.left_at IS NULL
        AND m2.left_at IS NULL
        AND (
          SELECT COUNT(*)
          FROM room_members m
          WHERE m.room_id = r.id
            AND m.left_at IS NULL
        ) = 2
      LIMIT 1
      `,
      [req.user.id, friendId]
    );

    if (existingRoom.rows[0]) {
      return res.json({
        room: existingRoom.rows[0]
      });
    }

    const friend = await getUserById(friendId);
    const roomName = friend?.nickname || friend?.username || '1:1 채팅';

    const roomResult = await pool.query(
      `
      INSERT INTO rooms (name, type, created_by)
      VALUES ($1, 'direct', $2)
      RETURNING id, name, type, created_at
      `,
      [roomName, req.user.id]
    );

    const room = roomResult.rows[0];

    await pool.query(
      `
      INSERT INTO room_members (room_id, user_id)
      VALUES ($1, $2), ($1, $3)
      `,
      [room.id, req.user.id, friendId]
    );

    io.to(`user:${req.user.id}`).emit('rooms changed');
    io.to(`user:${friendId}`).emit('rooms changed');

    return res.status(201).json({
      room
    });
  } catch (e) {
    console.error('direct room error:', e);

    return res.status(500).json({
      message: '1:1 채팅방 생성 실패'
    });
  }
});

app.post('/api/rooms/group', requireAuth, async (req, res) => {
  const requestedName = String(req.body.name || '').trim().slice(0, 50);
  const memberIds = Array.isArray(req.body.memberIds)
    ? req.body.memberIds.map(String)
    : [];
  const uniqueMemberIds = [...new Set([String(req.user.id), ...memberIds])];

  if (uniqueMemberIds.length < 2) {
    return res.status(400).json({
      message: '단체 채팅에는 최소 2명이 필요합니다.'
    });
  }

  if (uniqueMemberIds.length > 100) {
    return res.status(400).json({
      message: '단체 채팅은 최대 100명까지 가능합니다.'
    });
  }

  try {
    const friendsResult = await pool.query(
      `
      SELECT friend_id
      FROM friendships
      WHERE user_id = $1
        AND friend_id = ANY($2::bigint[])
      `,
      [req.user.id, uniqueMemberIds.filter((id) => id !== String(req.user.id))]
    );

    const friendIds = friendsResult.rows.map((row) => String(row.friend_id));
    const allowedIds = new Set([String(req.user.id), ...friendIds]);
    const blocked = uniqueMemberIds.some((id) => !allowedIds.has(String(id)));

    if (blocked) {
      return res.status(403).json({
        message: '친구만 단체 채팅에 초대할 수 있습니다.'
      });
    }

    const membersResult = await pool.query(
      `
      SELECT COALESCE(nickname, username) AS display_name
      FROM users
      WHERE id = ANY($1::bigint[])
      ORDER BY display_name
      `,
      [uniqueMemberIds]
    );

    const memberNames = membersResult.rows.map((row) => row.display_name);
    const roomName = requestedName || memberNames.join(', ');

    const roomResult = await pool.query(
      `
      INSERT INTO rooms (name, type, created_by)
      VALUES ($1, 'group', $2)
      RETURNING id, name, type, created_at
      `,
      [roomName, req.user.id]
    );

    const room = roomResult.rows[0];

    for (const userId of uniqueMemberIds) {
      await pool.query(
        `
        INSERT INTO room_members (room_id, user_id)
        VALUES ($1, $2)
        ON CONFLICT (room_id, user_id)
        DO UPDATE SET left_at = NULL
        `,
        [room.id, userId]
      );

      io.to(`user:${userId}`).emit('rooms changed');
    }

    return res.status(201).json({
      room
    });
  } catch (e) {
    console.error('group room error:', e);

    return res.status(500).json({
      message: '단체 채팅방 생성 실패'
    });
  }
});

app.get('/api/rooms', requireAuth, async (req, res) => {
  try {
    const result = await pool.query(
      `
      SELECT
        r.id,
        CASE
          WHEN r.type = 'direct' THEN COALESCE(other_user.nickname, other_user.username, r.name)
          ELSE r.name
        END AS display_name,
        r.type,
        r.created_at,
        COALESCE(MAX(msg.id), 0) AS last_message_id,
        COUNT(msg.id) FILTER (
          WHERE msg.id > COALESCE(rm.last_read_message_id, 0)
            AND msg.sender_id <> $1
            AND msg.deleted_for_everyone = false
        ) AS unread_count,
        (
          SELECT msg2.content
          FROM room_messages msg2
          WHERE msg2.room_id = r.id
            AND msg2.deleted_for_everyone = false
          ORDER BY msg2.id DESC
          LIMIT 1
        ) AS last_message
      FROM rooms r
      JOIN room_members rm ON rm.room_id = r.id
      LEFT JOIN room_members other_member
        ON other_member.room_id = r.id
        AND r.type = 'direct'
        AND other_member.user_id <> $1
        AND other_member.left_at IS NULL
      LEFT JOIN users other_user
        ON other_user.id = other_member.user_id
      LEFT JOIN room_messages msg ON msg.room_id = r.id
      WHERE rm.user_id = $1
        AND rm.left_at IS NULL
      GROUP BY r.id, rm.last_read_message_id, other_user.nickname, other_user.username
      ORDER BY last_message_id DESC, r.created_at DESC
      `,
      [req.user.id]
    );

    return res.json({
      rooms: result.rows.map((room) => ({
        id: String(room.id),
        name: room.display_name,
        type: room.type,
        unreadCount: Number(room.unread_count || 0),
        lastMessage: room.last_message || '',
        createdAt: room.created_at
      }))
    });
  } catch (e) {
    console.error('rooms list error:', e);

    return res.status(500).json({
      message: '채팅방 목록 조회 실패'
    });
  }
});

app.get('/api/rooms/:roomId/members', requireAuth, async (req, res) => {
  const roomId = req.params.roomId;

  try {
    const member = await requireRoomMember(roomId, req.user.id);

    if (!member) {
      return res.status(403).json({
        message: '채팅방 멤버가 아닙니다.'
      });
    }

    const result = await pool.query(
      `
      SELECT
        u.id,
        u.username,
        u.nickname,
        u.profile_image,
        u.status_message,
        u.friend_code,
        EXISTS (
          SELECT 1
          FROM friendships f
          WHERE f.user_id = $2
            AND f.friend_id = u.id
        ) AS is_friend,
        EXISTS (
          SELECT 1
          FROM blocked_users b
          WHERE b.user_id = $2
            AND b.blocked_user_id = u.id
        ) AS is_blocked
      FROM room_members rm
      JOIN users u ON u.id = rm.user_id
      WHERE rm.room_id = $1
        AND rm.left_at IS NULL
      ORDER BY u.nickname, u.username
      `,
      [roomId, req.user.id]
    );

    return res.json({
      members: result.rows.map((user) => ({
        ...toPublicUser(user),
        isFriend: user.is_friend,
        isBlocked: user.is_blocked
      }))
    });
  } catch (e) {
    console.error('room members error:', e);

    return res.status(500).json({
      message: '채팅방 멤버 조회 실패'
    });
  }
});

app.get('/api/rooms/:roomId/messages', requireAuth, async (req, res) => {
  const roomId = req.params.roomId;

  try {
    const member = await requireRoomMember(roomId, req.user.id);

    if (!member) {
      return res.status(403).json({
        message: '채팅방 멤버가 아닙니다.'
      });
    }

    const result = await pool.query(
      `
      SELECT
        m.id,
        m.room_id,
        m.sender_id,
        COALESCE(u.nickname, u.username, '알 수 없음') AS sender_name,
        u.profile_image,
        m.content,
        m.deleted_for_everyone,
        m.created_at,
        (
          SELECT COUNT(*)
          FROM room_members reader
          WHERE reader.room_id = m.room_id
            AND reader.left_at IS NULL
            AND reader.user_id <> m.sender_id
            AND COALESCE(reader.last_read_message_id, 0) < m.id
        ) AS unread_count
      FROM room_messages m
      LEFT JOIN users u ON u.id = m.sender_id
      LEFT JOIN room_message_deletions d
        ON d.message_id = m.id
        AND d.user_id = $2
      WHERE m.room_id = $1
        AND d.message_id IS NULL
      ORDER BY m.id ASC
      LIMIT 200
      `,
      [roomId, req.user.id]
    );

    return res.json({
      messages: result.rows.map(toPublicMessage)
    });
  } catch (e) {
    console.error('room messages error:', e);

    return res.status(500).json({
      message: '메시지 조회 실패'
    });
  }
});

app.post('/api/rooms/:roomId/read', requireAuth, async (req, res) => {
  const roomId = req.params.roomId;
  const lastReadMessageId = Number(req.body.lastReadMessageId || 0);

  try {
    const member = await requireRoomMember(roomId, req.user.id);

    if (!member) {
      return res.status(403).json({
        message: '채팅방 멤버가 아닙니다.'
      });
    }

    await pool.query(
      `
      UPDATE room_members
      SET last_read_message_id = GREATEST(COALESCE(last_read_message_id, 0), $1)
      WHERE room_id = $2
        AND user_id = $3
      `,
      [lastReadMessageId, roomId, req.user.id]
    );

    io.to(`room:${roomId}`).emit('room read', {
      roomId: String(roomId),
      userId: String(req.user.id),
      lastReadMessageId
    });

    return res.json({
      message: '읽음 처리했습니다.'
    });
  } catch (e) {
    console.error('room read error:', e);

    return res.status(500).json({
      message: '읽음 처리 실패'
    });
  }
});

app.patch('/api/rooms/:roomId/name', requireAuth, async (req, res) => {
  const roomId = req.params.roomId;
  const name = String(req.body.name || '').trim().slice(0, 50);

  if (!name) {
    return res.status(400).json({
      message: '채팅방 이름을 입력하세요.'
    });
  }

  try {
    const member = await requireRoomMember(roomId, req.user.id);

    if (!member) {
      return res.status(403).json({
        message: '채팅방 멤버가 아닙니다.'
      });
    }

    const result = await pool.query(
      `
      UPDATE rooms
      SET name = $1
      WHERE id = $2
      RETURNING id, name, type, created_at
      `,
      [name, roomId]
    );

    const memberIds = await getActiveRoomMemberIds(roomId);

    for (const memberId of memberIds) {
      io.to(`user:${memberId}`).emit('rooms changed');
    }

    return res.json({
      message: '채팅방 이름을 변경했습니다.',
      room: {
        id: String(result.rows[0].id),
        name: result.rows[0].name,
        type: result.rows[0].type,
        createdAt: result.rows[0].created_at
      }
    });
  } catch (e) {
    console.error('room rename error:', e);

    return res.status(500).json({
      message: '채팅방 이름 변경 실패'
    });
  }
});

app.post('/api/rooms/:roomId/leave', requireAuth, async (req, res) => {
  const roomId = req.params.roomId;

  try {
    const member = await requireRoomMember(roomId, req.user.id);

    if (!member) {
      return res.status(403).json({
        message: '채팅방 멤버가 아닙니다.'
      });
    }

    await pool.query(
      `
      UPDATE room_members
      SET left_at = now()
      WHERE room_id = $1
        AND user_id = $2
      `,
      [roomId, req.user.id]
    );

    io.to(`user:${req.user.id}`).emit('rooms changed');

    return res.json({
      message: '채팅방에서 나갔습니다.'
    });
  } catch (e) {
    console.error('room leave error:', e);

    return res.status(500).json({
      message: '채팅방 나가기 실패'
    });
  }
});

app.delete('/api/rooms/:roomId/messages/:messageId/me', requireAuth, async (req, res) => {
  const { roomId, messageId } = req.params;

  try {
    const member = await requireRoomMember(roomId, req.user.id);

    if (!member) {
      return res.status(403).json({
        message: '채팅방 멤버가 아닙니다.'
      });
    }

    await pool.query(
      `
      INSERT INTO room_message_deletions (message_id, user_id)
      VALUES ($1, $2)
      ON CONFLICT DO NOTHING
      `,
      [messageId, req.user.id]
    );

    return res.json({
      message: '나에게서만 삭제했습니다.'
    });
  } catch (e) {
    console.error('delete for me error:', e);

    return res.status(500).json({
      message: '메시지 삭제 실패'
    });
  }
});

app.delete('/api/rooms/:roomId/messages/:messageId/everyone', requireAuth, async (req, res) => {
  const { roomId, messageId } = req.params;

  try {
    const member = await requireRoomMember(roomId, req.user.id);

    if (!member) {
      return res.status(403).json({
        message: '채팅방 멤버가 아닙니다.'
      });
    }

    const messageResult = await pool.query(
      `
      SELECT id, sender_id
      FROM room_messages
      WHERE id = $1
        AND room_id = $2
      `,
      [messageId, roomId]
    );

    const message = messageResult.rows[0];

    if (!message) {
      return res.status(404).json({
        message: '메시지를 찾을 수 없습니다.'
      });
    }

    if (String(message.sender_id) !== String(req.user.id)) {
      return res.status(403).json({
        message: '내가 보낸 메시지만 모두에게서 삭제할 수 있습니다.'
      });
    }

    await pool.query(
      `
      UPDATE room_messages
      SET deleted_for_everyone = true,
          deleted_at = now()
      WHERE id = $1
      `,
      [messageId]
    );

    io.to(`room:${roomId}`).emit('room message deleted', {
      roomId: String(roomId),
      messageId: String(messageId),
      mode: 'everyone'
    });

    return res.json({
      message: '모두에게서 삭제했습니다.'
    });
  } catch (e) {
    console.error('delete for everyone error:', e);

    return res.status(500).json({
      message: '메시지 삭제 실패'
    });
  }
});

io.on('connection', async (socket) => {
  const tokenUser = verifyToken(socket.handshake.auth.token);

  if (!tokenUser) {
    socket.emit('auth error', '로그인이 필요합니다.');
    socket.disconnect();
    return;
  }

  const user = await getUserById(tokenUser.id);

  if (!user) {
    socket.emit('auth error', '사용자를 찾을 수 없습니다.');
    socket.disconnect();
    return;
  }

  socket.user = toPublicUser(user);

  joinUserPersonalRoom(socket);
  await joinUserChatRooms(socket);

  io.emit(
    'system message',
    `[${socket.user.nickname || socket.user.username}] 님이 오픈채팅에 들어왔습니다.`
  );

  socket.on('chat message', async (msg, callback) => {
    const safeMsg = normalizeMessage(msg);

    if (!safeMsg) {
      callback?.();
      return;
    }

    const latestUser = await getUserById(socket.user.id);
    const displayName = latestUser?.nickname || socket.user.username;

    io.emit('chat message', {
      senderId: String(socket.user.id),
      senderName: displayName,
      content: safeMsg,
      createdAt: new Date().toISOString()
    });

    callback?.();
  });

  socket.on('join room', async (roomId, callback) => {
    const member = await requireRoomMember(roomId, socket.user.id);

    if (!member) {
      callback?.({
        ok: false,
        message: '채팅방 멤버가 아닙니다.'
      });
      return;
    }

    socket.join(`room:${roomId}`);

    callback?.({
      ok: true
    });
  });

  socket.on('room message', async (roomId, msg, callback) => {
    const safeMsg = normalizeMessage(msg);

    if (!safeMsg) {
      callback?.();
      return;
    }

    try {
      const member = await requireRoomMember(roomId, socket.user.id);

      if (!member) {
        callback?.({
          ok: false,
          message: '채팅방 멤버가 아닙니다.'
        });
        return;
      }

      const insertResult = await pool.query(
        `
        INSERT INTO room_messages (room_id, sender_id, content)
        VALUES ($1, $2, $3)
        RETURNING id, room_id, sender_id, content, deleted_for_everyone, created_at
        `,
        [roomId, socket.user.id, safeMsg]
      );

      const savedMessage = insertResult.rows[0];
      const latestUser = await getUserById(socket.user.id);
      const memberIds = await getActiveRoomMemberIds(roomId);

      const publicMessage = toPublicMessage({
        ...savedMessage,
        sender_name: latestUser.nickname || latestUser.username,
        profile_image: latestUser.profile_image,
        unread_count: Math.max(memberIds.length - 1, 0)
      });

      io.to(`room:${roomId}`).emit('room message', publicMessage);

      for (const memberId of memberIds) {
        io.to(`user:${memberId}`).emit('rooms changed');
      }

      const pushTargetIds = memberIds.filter((memberId) => {
        return String(memberId) !== String(socket.user.id);
      });

      sendUnreadPushToUsers(pushTargetIds).catch((e) => {
        console.error('push dispatch error:', e);
      });

      callback?.({
        ok: true,
        message: publicMessage
      });
    } catch (e) {
      console.error('room message error:', e);

      callback?.({
        ok: false,
        message: '메시지 전송 실패'
      });
    }
  });

  socket.on('disconnect', () => {
    if (!socket.user) {
      return;
    }

    io.emit(
      'system message',
      `[${socket.user.nickname || socket.user.username}] 님이 오픈채팅에서 나갔습니다.`
    );
  });
});

async function main() {
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL environment variable is required.');
  }

  await initDb();

  const port = process.env.PORT || 3000;

  server.listen(port, () => {
    console.log(`server running at http://localhost:${port}`);
  });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
