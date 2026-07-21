# Coconut Chat MVP

Supabase Postgres와 Socket.IO를 사용한 실시간 채팅 MVP입니다.

회원가입/로그인은 DB에 저장하고, 채팅 메시지는 저장하지 않습니다.  
따라서 채팅 내용은 현재 접속 중인 사용자들에게만 실시간으로 보입니다.

## 주요 기능

- 회원가입
- 로그인
- 비밀번호 bcrypt 해시 저장
- Socket.IO 기반 실시간 채팅
- 현재 접속자 수 표시
- 채팅 메시지 DB 저장 없음
- Supabase Postgres 사용자 DB 연동
- Render 배포 가능

## 기술 스택

- Node.js
- Express
- Socket.IO
- PostgreSQL
- Supabase
- bcrypt
- dotenv
- Render

## DB 구조

이 프로젝트는 Supabase Postgres의 `users` 테이블만 사용합니다.

```sql
CREATE TABLE IF NOT EXISTS users (
  id BIGSERIAL PRIMARY KEY,
  username TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);
```
## 저장되는 정보

- id
- username
- password_hash
- created_at

## 저장하지 않는 정보:

- 채팅 메시지
- 이전 대화 기록
- 비밀번호 원문
- 설치
- npm install
- 환경변수
- 프로젝트 루트에 .env 파일을 만들고 아래 값을 넣습니다.

DATABASE_URL=your_supabase_postgres_connection_string
SESSION_SECRET=your_long_random_secret
PORT=3000
## 주의:

- .env 파일을 GitHub에 올리지 말 것
- DATABASE_URL에는 DB 비밀번호가 포함되어 있음
- SESSION_SECRET은 토큰 서명에 사용됨

## .gitignore에 아래 내용이 있어야 합니다.

- .env
- node_modules
- 실행
- npm start

## 브라우저에서 접속:

```http://localhost:3000```

- 사용 흐름
- 회원가입 버튼 클릭
- 아이디와 6자리 이상 비밀번호 입력
- 회원가입 완료 메시지 확인
- 같은 정보로 로그인
- 채팅방 입장
- 현재 접속 중인 사용자끼리 실시간 채팅
- 인증 구조
- 로그인에 성공하면 서버가 서명된 토큰을 발급합니다.

- 클라이언트는 Socket.IO 연결 시 이 토큰을 함께 보냅니다.

socket = io({
  auth: {
    token: loginToken
  }
});

서버는 연결 시점에 토큰을 검증하고, 성공하면 해당 소켓을 로그인된 사용자로 처리합니다.

이전 구조처럼 서버 메모리의 sessions Map에 의존하지 않기 때문에, 로그인 후 채팅방 입장 실패 문제가 줄어듭니다.

채팅 메시지 저장 정책
이 앱은 채팅 메시지를 DB에 저장하지 않습니다.

사용자가 접속 중이면 메시지를 볼 수 있음
나갔다가 다시 들어오면 이전 메시지는 보이지 않음
새로고침하면 이전 메시지는 사라짐
즉, 이 앱의 채팅은 실시간 전송 전용입니다.

로컬 DB 확인
로컬 개발 환경에서는 아래 주소로 가입된 사용자 목록을 확인할 수 있습니다.

http://localhost:3000/api/debug-users
이 API는 production 환경에서는 막혀 있습니다.

Render 배포
Render에 배포할 때 Environment Variables에 아래 값을 넣어야 합니다.

DATABASE_URL=your_supabase_postgres_connection_string
SESSION_SECRET=your_long_random_secret
NODE_ENV=production
Render는 PORT를 자동으로 제공합니다.

배포 후 접속 URL 예시:

https://your-service-name.onrender.com
보안 주의사항
.env를 GitHub에 올리지 않습니다.
DB 비밀번호를 코드에 직접 쓰지 않습니다.
비밀번호 원문은 저장하지 않고 bcrypt 해시만 저장합니다.
SESSION_SECRET은 충분히 긴 랜덤 문자열을 사용합니다.
Supabase DB URL이 노출됐다면 DB 비밀번호를 재설정해야 합니다.
현재 한계
이 프로젝트는 MVP이므로 다음 기능은 아직 없습니다.

- 로그아웃
- 영구 세션 저장
- JWT 만료 시간 처리
- 채팅방 분리
- 관리자 기능
- 메시지 신고/삭제
- 사용자 프로필
- 프로젝트 목적
- 이 프로젝트는 실시간 웹 채팅의 기본 구조를 학습하기 위한 MVP이므로 다소 부족한 점이 있을 수 있음. 

## 핵심 학습 포인트:

- Express 서버 구성
- Supabase Postgres 연결
- 회원가입/로그인 구현
- bcrypt 비밀번호 해시
- Socket.IO 실시간 통신
- HTTP 로그인과 WebSocket 인증 연결
- Render 배포
