# English

> A real-time chat application built with Node.js, Express, Socket.IO, PostgreSQL, and Supabase.

> **Current Status: Work in Progress — Not Suitable for Production Use**

---

## Project Overview

Coconut Chat MVP is a personal full-stack project created to study how real-time chat systems are designed, implemented, and operated.

It began as a simple Socket.IO experiment. Over time, it expanded to include user authentication, friendships, user blocking, multiple chat rooms, persistent message storage, read receipts, message deletion, and push notification subscriptions.

This repository contains significantly more functionality than a typical chat tutorial. However, having many features does not automatically make software reliable, secure, maintainable, or suitable for production.

The most accurate description of Coconut Chat in its current state is a functional prototype with serious architectural, security, testing, and operational weaknesses.

---

## Features

### Authentication

* User registration
* User login
* Password hashing with bcrypt
* Signed token-based authentication
* Protected HTTP endpoints
* Socket.IO connection authentication

### Social Features

* Friend requests
* Friend list management
* User search
* User blocking

### Messaging

* Real-time messaging with Socket.IO
* Multiple chat rooms
* Persistent message storage
* Message history retrieval
* Read receipts
* Message deletion
* Chat room membership management

### Notifications

* Push notification subscription storage
* Push notification delivery infrastructure

---

## Tech Stack

### Backend

* Node.js
* Express
* Socket.IO

### Database

* PostgreSQL
* Supabase

### Security and Configuration

* bcrypt
* Node.js `crypto`
* dotenv

### Deployment

* Render

---

## Database

This application uses PostgreSQL hosted on Supabase. The current implementation stores chat messages and related metadata in PostgreSQL.

The database includes tables related to the following areas:

* Users
* Friendships
* Chat rooms
* Chat room members
* Chat room messages
* Message read status
* Deleted messages
* Push notification subscriptions

---

## Current Project Structure

Most backend responsibilities are currently contained in a single oversized server file.

That file handles all of the following:

* Application configuration
* Database initialization
* Database schema changes
* Authentication
* HTTP routes
* Socket.IO events
* Friendship logic
* Blocking logic
* Chat room logic
* Message handling
* Read receipts
* Message deletion
* Push notifications

This structure made it easier to add features quickly.

However, it also created serious maintainability problems.

The file is difficult to navigate, difficult to test, difficult to review, and risky to modify. A small change to one feature can unexpectedly affect completely unrelated parts of the application.

The project should eventually be reorganized into a structure similar to the following:

```text
src/
  app.js
  server.js

  config/
    env.js
    database.js

  routes/
    auth.routes.js
    users.routes.js
    friends.routes.js
    rooms.routes.js
    messages.routes.js

  controllers/
    auth.controller.js
    users.controller.js
    friends.controller.js
    rooms.controller.js
    messages.controller.js

  services/
    auth.service.js
    friend.service.js
    room.service.js
    message.service.js
    notification.service.js

  repositories/
    user.repository.js
    friend.repository.js
    room.repository.js
    message.repository.js

  middleware/
    authenticate.js
    rateLimit.js
    validate.js
    errorHandler.js

  socket/
    index.js
    authentication.js
    room.events.js
    message.events.js

  database/
    migrations/
    seeds/

  validators/
  errors/
  utils/

tests/
  unit/
  integration/
  socket/
```

---

## Installation

Clone the repository.

```bash
git clone https://github.com/nyongnyongi/COCONUT_CHAT_MVP.git
cd COCONUT_CHAT_MVP
```

Install the dependencies.

```bash
npm install
```

Create a `.env` file in the project root.

```env
DATABASE_URL=your_supabase_postgres_connection_string
SESSION_SECRET=your_long_random_secret
PORT=3000
NODE_ENV=development
```

Start the application.

```bash
npm start
```

Open the following address in your browser.

```text
http://localhost:3000
```

---

## Environment Variables

### `DATABASE_URL`

The connection string used to connect to Supabase PostgreSQL.

It generally contains the database username, password, host, and database name.

Never commit this value to GitHub.

If it has ever been exposed publicly, the database password should be changed immediately.

### `SESSION_SECRET`

A secret value used to sign authentication tokens.

It should be long and cryptographically random.

The application should refuse to start if this environment variable is missing.

Using another sensitive value, such as `DATABASE_URL`, as a fallback secret is unsafe. Authentication secrets and database credentials must remain completely independent.

### `PORT`

The local HTTP server port.

Render generally provides this value automatically in production.

### `NODE_ENV`

Indicates the current runtime environment.

Typical values include:

```text
development
production
test
```

---

## Authentication Architecture

After a successful login, the server generates a signed authentication token.

The client sends this token when establishing a Socket.IO connection.

```javascript
const socket = io({
  auth: {
    token: loginToken
  }
});
```

The server verifies the token during the Socket.IO handshake and associates the socket connection with the authenticated user.

This approach is better than relying entirely on an in-memory session map. It allows authentication to survive reconnections and work more reliably across multiple application instances.

However, the current authentication lifecycle is incomplete.

The following areas are missing or insufficiently implemented:

* Token expiration
* Refresh token rotation
* Session revocation
* Token invalidation on logout
* Session invalidation after password changes
* Multi-device session management
* Email verification
* Password recovery
* Brute-force protection
* Login attempt throttling

The current custom authentication system should be treated as an educational implementation, not as a secure authentication solution.

Custom authentication is surprisingly easy to begin and much harder than expected to complete safely.

---

## Message Storage Policy

The application currently stores chat messages in PostgreSQL.

Depending on room membership and authorization rules, users may be able to retrieve previous messages after refreshing the page or reconnecting.

The application may also store the following information:

* Message sender
* Chat room
* Creation timestamp
* Read status
* Deletion status

The application does not currently provide end-to-end encryption.

It must not be used for sensitive, confidential, medical, financial, military, legally privileged, or otherwise protected communication.

---

## Local Development Debugging

A debugging endpoint may exist in the local development environment for inspecting registered users.

Example:

```text
http://localhost:3000/api/debug-users
```

This endpoint must be disabled in production.

Even though password hashes are not plain-text passwords, exposing a list of users and password hashes is still a serious security incident.

Debugging endpoints should eventually be removed or protected by strict development-only controls.

---

## Render Deployment

When deploying to Render, configure the following environment variables:

```env
DATABASE_URL=your_supabase_postgres_connection_string
SESSION_SECRET=your_long_random_secret
NODE_ENV=production
```

Render generally provides `PORT` automatically.

Example deployment URL:

```text
https://your-service-name.onrender.com
```

A successful deployment does not mean that the application is ready for production.

Deployment only proves that the process can run on another computer. It does not prove that the system is secure, observable, scalable, backed up, or resilient to failure.

---

## Security Notes

* Never commit `.env`
* Never hardcode database credentials
* Never store plain-text passwords
* Use a long and random `SESSION_SECRET`
* Rotate exposed credentials immediately
* Apply rate limiting to authentication endpoints
* Limit request body size
* Validate and normalize all user input
* Configure secure HTTP headers
* Restrict CORS origins
* Do not expose internal error details
* Prevent unauthorized chat room access
* Test every authorization rule
* Handle user-generated content safely
* Review Socket.IO events with the same care as HTTP endpoints

Socket.IO is not a security boundary.

Every event must verify that the connected user is authorized to perform the requested action.

Knowing a chat room ID must not be enough to join a room, read messages, delete messages, or modify room membership.

---

## Current Limitations

This project is not suitable for production use.

Known limitations include:

* An oversized monolithic server file
* Unclear separation of responsibilities
* No automated test suite
* No reliable CI pipeline
* No formal database migration system
* Database schema changes during application startup
* Incomplete token lifecycle
* No refresh token rotation
* No session revocation
* No account recovery
* No email verification
* No serious rate-limiting strategy
* Insufficient abuse prevention
* Insufficient input validation
* Insufficient error handling
* Insufficient structured logging
* No centralized monitoring
* No alerting system
* No documented backup strategy
* No documented recovery procedure
* No load testing
* No security audit
* No privacy policy
* No terms of service
* No moderation workflow
* No administrator tools
* No account deletion workflow
* No data retention policy
* No accessibility review
* No verified mobile browser support

Calling this project an MVP does not make these problems disappear.

An MVP may have fewer features, but the features it does have should behave predictably and should not expose users to obvious security or data-loss risks.

---

## Required Tests

The project currently needs automated tests covering at least the following areas.

### Authentication Tests

* Registration succeeds with valid input
* Duplicate usernames are rejected
* Invalid passwords are rejected
* Passwords are stored as hashes
* Login succeeds with valid credentials
* Login fails with invalid credentials
* Invalid tokens are rejected
* Expired tokens are rejected
* Logged-out sessions cannot reconnect

### Authorization Tests

* A user cannot access another user's private data
* A blocked user cannot send messages
* A non-member cannot read room messages
* An unauthorized user cannot join a room
* A user cannot delete another user's message
* A removed member cannot continue receiving room events
* A user cannot modify another user's push subscription

### Messaging Tests

* Messages are stored correctly
* Message ordering remains stable
* Read receipts are recorded correctly
* Deleted messages are hidden according to policy
* Duplicate events do not create duplicate messages
* Reconnection does not corrupt message state

### Operational Tests

* The server shuts down safely when required environment variables are missing
* Database failures return controlled errors
* Migrations can run against a clean database
* Migrations can be rolled back or recovered
* Restarting the application does not corrupt data

---

## Roadmap

### Phase 1: Documentation and Stability

* Document the current database schema
* Document all environment variables
* Remove unused dependencies
* Add linting and formatting
* Add consistent error handling

### Phase 2: Security

* Require `SESSION_SECRET`
* Add token expiration
* Add refresh token rotation
* Add session revocation
* Add login rate limiting
* Add registration rate limiting
* Add HTTP security headers
* Restrict CORS
* Add input validation
* Review every authorization path

### Phase 3: Architecture

* Split the monolithic server file
* Separate routes, controllers, services, and repositories
* Extract Socket.IO event handlers
* Introduce a formal migration tool
* Add configuration validation
* Introduce structured application errors

### Phase 4: Testing and Automation

* Add unit tests
* Add API integration tests
* Add Socket.IO integration tests
* Add authorization tests
* Add GitHub Actions
* Add dependency auditing
* Add automated migration checks

### Phase 5: Operations

* Add structured logging
* Add error tracking
* Add a health-check endpoint
* Add uptime monitoring
* Add database backups
* Test database restoration
* Add performance testing
* Add deployment rollback procedures

### Phase 6: Product Requirements

* Add email verification
* Add password recovery
* Add account deletion
* Add moderation tools
* Add abuse-reporting workflows
* Add a privacy policy
* Add terms of service
* Add data retention rules
* Improve accessibility

---

## Evaluation

This project has a common early-stage problem: it mistakes feature accumulation for engineering maturity.

Having many features is not the same as having a good system.

This repository demonstrates effort, curiosity, and persistence. At the same time, it demonstrates weak responsibility boundaries, insufficient testing, incomplete security design, outdated documentation, and almost nonexistent operational readiness.

The largest server file has been allowed to absorb nearly every responsibility in the application. That is not simplicity. It is complexity deferred until later.

The authentication system works well enough to demonstrate the concept, but it is not mature enough to protect real users.

The database structure increasingly supports complex functionality, but the migration strategy is effectively improvised schema modification during application startup.

The messaging system stores private user conversations, but it does not yet provide the policies, safeguards, monitoring, or recovery procedures expected from software that stores personal communication.

The previous README described behavior that the code no longer had. This is a basic documentation failure and a warning sign that features were added faster than the project was reviewed.

There is currently no strong evidence that the authorization rules are correct because there is no serious automated test suite proving them.

A system that appears to work during manual testing may still allow:

* Unauthorized access to messages
* Unauthorized message deletion
* Chat room membership bypasses
* User impersonation
* Token replay
* Abuse through unlimited requests
* Data loss during schema changes

# 번역

> Node.js, Express, Socket.IO, PostgreSQL, Supabase로 개발한 실시간 채팅 애플리케이션입니다.

> **현재 상태: 개발 진행 중인 학습 프로젝트 — 운영 환경 사용 불가**

---

## 프로젝트 소개

Coconut Chat MVP는 실시간 채팅 시스템이 어떻게 설계되고 구현되며 운영되는지를 학습하기 위해 만든 개인 풀스택 프로젝트입니다.

처음에는 간단한 Socket.IO 실험으로 시작했습니다. 이후 사용자 인증, 친구 관계, 사용자 차단, 다중 채팅방, 메시지 저장, 읽음 처리, 메시지 삭제, 푸시 알림 구독 기능까지 점차 확장되었습니다.

이 저장소는 일반적인 채팅 튜토리얼보다 훨씬 많은 기능을 포함하고 있습니다. 하지만 기능이 많다는 사실만으로 소프트웨어가 신뢰할 수 있거나, 안전하거나, 유지보수하기 쉽거나, 운영 환경에 적합해지는 것은 아닙니다.

현재 Coconut Chat은 심각한 아키텍처, 보안, 테스트, 운영상의 약점을 가진 작동 가능한 프로토타입이라고 설명하는 것이 가장 정확합니다.

---

## 주요 기능

### 인증

* 회원가입
* 로그인
* bcrypt를 사용한 비밀번호 해시 저장
* 서명된 토큰 기반 인증
* 인증이 필요한 HTTP 엔드포인트
* Socket.IO 연결 인증

### 소셜 기능

* 친구 요청
* 친구 목록 관리
* 사용자 검색
* 사용자 차단

### 메시징

* Socket.IO 기반 실시간 메시지 전송
* 다중 채팅방
* 메시지 영구 저장
* 메시지 기록 조회
* 읽음 처리
* 메시지 삭제
* 채팅방 참여자 관리

### 알림

* 푸시 알림 구독 정보 저장
* 푸시 알림 전송 기반 구조

---

## 기술 스택

### 백엔드

* Node.js
* Express
* Socket.IO

### 데이터베이스

* PostgreSQL
* Supabase

### 보안 및 설정

* bcrypt
* Node.js `crypto`
* dotenv

### 배포

* Render

---

## 데이터베이스

이 애플리케이션은 Supabase에서 호스팅되는 PostgreSQL을 사용합니다. 현재 구현은 채팅 메시지와 관련 메타데이터를 PostgreSQL에 저장합니다.

데이터베이스에는 다음 기능과 관련된 테이블이 포함되어 있습니다.

* 사용자
* 친구 관계
* 채팅방
* 채팅방 참여자
* 채팅방 메시지
* 메시지 읽음 상태
* 삭제된 메시지
* 푸시 알림 구독

---

## 현재 프로젝트 구조

현재 대부분의 백엔드 책임이 하나의 지나치게 큰 서버 파일에 들어 있습니다.

해당 파일은 다음 기능을 모두 담당합니다.

* 애플리케이션 설정
* 데이터베이스 초기화
* 데이터베이스 스키마 변경
* 인증
* HTTP 라우트
* Socket.IO 이벤트
* 친구 관계 로직
* 차단 로직
* 채팅방 로직
* 메시지 처리
* 읽음 처리
* 메시지 삭제
* 푸시 알림

이 구조는 기능을 빠르게 추가하는 데는 도움이 되었습니다.

하지만 동시에 유지보수 문제를 만들었습니다.

파일을 탐색하기 어렵고, 테스트하기 어렵고, 리뷰하기 어렵고, 안전하게 수정하기 어렵습니다. 한 기능의 작은 변경이 전혀 관계없는 다른 기능에 예상하지 못한 영향을 줄 수 있습니다.

향후 다음과 비슷한 구조로 변경해야 합니다.

```text
src/
  app.js
  server.js

  config/
    env.js
    database.js

  routes/
    auth.routes.js
    users.routes.js
    friends.routes.js
    rooms.routes.js
    messages.routes.js

  controllers/
    auth.controller.js
    users.controller.js
    friends.controller.js
    rooms.controller.js
    messages.controller.js

  services/
    auth.service.js
    friend.service.js
    room.service.js
    message.service.js
    notification.service.js

  repositories/
    user.repository.js
    friend.repository.js
    room.repository.js
    message.repository.js

  middleware/
    authenticate.js
    rateLimit.js
    validate.js
    errorHandler.js

  socket/
    index.js
    authentication.js
    room.events.js
    message.events.js

  database/
    migrations/
    seeds/

  validators/
  errors/
  utils/

tests/
  unit/
  integration/
  socket/
```

---

## 설치

저장소를 복제합니다.

```bash
git clone https://github.com/nyongnyongi/COCONUT_CHAT_MVP.git
cd COCONUT_CHAT_MVP
```

의존성을 설치합니다.

```bash
npm install
```

프로젝트 루트에 `.env` 파일을 생성합니다.

```env
DATABASE_URL=your_supabase_postgres_connection_string
SESSION_SECRET=your_long_random_secret
PORT=3000
NODE_ENV=development
```

애플리케이션을 실행합니다.

```bash
npm start
```

브라우저에서 다음 주소로 접속합니다.

```text
http://localhost:3000
```

---

## 환경 변수

### `DATABASE_URL`

Supabase PostgreSQL에 연결하기 위한 접속 문자열입니다.

일반적으로 데이터베이스 사용자명, 비밀번호, 호스트, 데이터베이스 이름이 포함됩니다.

이 값을 GitHub에 절대 커밋하면 안 됩니다.

공개된 적이 있다면 데이터베이스 비밀번호를 즉시 변경해야 합니다.

### `SESSION_SECRET`

인증 토큰 서명에 사용하는 비밀 값입니다.

길고 암호학적으로 무작위인 값을 사용해야 합니다.

이 환경 변수가 없으면 애플리케이션이 실행을 거부하도록 해야 합니다.

`DATABASE_URL`과 같은 다른 민감한 값을 대체 비밀 값으로 사용하는 것은 안전하지 않습니다. 인증 비밀 값과 데이터베이스 자격 증명은 반드시 서로 독립적이어야 합니다.

### `PORT`

로컬 HTTP 서버 포트입니다.

Render 운영 환경에서는 일반적으로 자동으로 제공됩니다.

### `NODE_ENV`

현재 실행 환경을 나타냅니다.

일반적인 값은 다음과 같습니다.

```text
development
production
test
```

---

## 인증 구조

로그인에 성공하면 서버가 서명된 인증 토큰을 생성합니다.

클라이언트는 Socket.IO 연결을 생성할 때 해당 토큰을 전송합니다.

```javascript
const socket = io({
  auth: {
    token: loginToken
  }
});
```

서버는 Socket.IO 핸드셰이크 과정에서 토큰을 검증하고 소켓 연결을 인증된 사용자와 연결합니다.

이 방식은 서버 메모리의 세션 맵에만 의존하는 것보다 낫습니다. 재연결이나 여러 애플리케이션 인스턴스 환경에서도 인증을 더 안정적으로 유지할 수 있기 때문입니다.

그러나 현재 인증 생명주기는 완성되지 않았습니다.

부족하거나 구현되지 않은 부분은 다음과 같습니다.

* 토큰 만료
* 리프레시 토큰 교체
* 세션 폐기
* 로그아웃 시 토큰 무효화
* 비밀번호 변경 후 세션 무효화
* 다중 기기 세션 관리
* 이메일 인증
* 비밀번호 복구
* 무차별 대입 공격 방어
* 로그인 시도 제한

현재 자체 인증 시스템은 보안이 보장된 구현이 아니라 학습용 구현으로 취급해야 합니다.

자체 인증은 시작하기는 놀라울 정도로 쉽고, 안전하게 완성하기는 예상보다 훨씬 어렵습니다.

---

## 메시지 저장 정책

현재 애플리케이션은 채팅 메시지를 PostgreSQL에 저장합니다.

채팅방 참여 상태와 권한 규칙에 따라 사용자는 새로고침하거나 재접속한 뒤 이전 메시지를 조회할 수 있습니다.

애플리케이션은 다음 정보도 저장할 수 있습니다.

* 메시지 전송자
* 채팅방
* 생성 시각
* 읽음 상태
* 삭제 상태

현재 종단 간 암호화를 제공하지 않습니다.

민감한 정보, 기밀 정보, 의료 정보, 금융 정보, 군사 정보, 법률상 비밀이 보장되어야 하는 대화에 사용하면 안 됩니다.

---

## 로컬 개발 디버깅

로컬 개발 환경에서는 가입된 사용자를 확인하기 위한 디버깅 엔드포인트가 존재할 수 있습니다.

예시:

```text
http://localhost:3000/api/debug-users
```

이 엔드포인트는 운영 환경에서 반드시 비활성화되어야 합니다.

비밀번호 해시가 평문 비밀번호는 아니더라도, 사용자 목록과 비밀번호 해시를 노출하는 것은 여전히 심각한 보안 사고입니다.

디버깅 엔드포인트는 최종적으로 제거하거나 엄격한 개발 환경 전용 제어로 보호해야 합니다.

---

## Render 배포

Render에 배포할 때 다음 환경 변수를 설정합니다.

```env
DATABASE_URL=your_supabase_postgres_connection_string
SESSION_SECRET=your_long_random_secret
NODE_ENV=production
```

Render는 일반적으로 `PORT`를 자동으로 제공합니다.

배포 URL 예시:

```text
https://your-service-name.onrender.com
```

배포에 성공했다고 해서 애플리케이션이 운영 가능한 것은 아닙니다.

배포는 다른 컴퓨터에서 프로세스가 실행된다는 사실만 증명합니다. 시스템이 안전한지, 관측 가능한지, 확장 가능한지, 백업되는지, 장애에 견딜 수 있는지는 증명하지 않습니다.

---

## 보안 주의사항

* `.env`를 절대 커밋하지 않습니다.
* 데이터베이스 자격 증명을 코드에 직접 작성하지 않습니다.
* 평문 비밀번호를 저장하지 않습니다.
* 길고 무작위인 `SESSION_SECRET`을 사용합니다.
* 노출된 자격 증명은 즉시 교체합니다.
* 인증 엔드포인트에 요청 제한을 적용합니다.
* 요청 본문 크기를 제한합니다.
* 모든 사용자 입력을 검증하고 정규화합니다.
* 안전한 HTTP 보안 헤더를 설정합니다.
* CORS 허용 범위를 제한합니다.
* 내부 오류 정보를 외부에 노출하지 않습니다.
* 권한 없는 채팅방 접근을 차단합니다.
* 모든 권한 규칙을 테스트합니다.
* 사용자 생성 콘텐츠를 안전하게 처리합니다.
* Socket.IO 이벤트도 HTTP 엔드포인트와 동일한 수준으로 검토합니다.

Socket.IO는 보안 경계가 아닙니다.

모든 이벤트에서 연결된 사용자가 해당 작업을 수행할 권한이 있는지 검증해야 합니다.

사용자가 채팅방 ID를 알고 있다는 이유만으로 채팅방에 참여하거나, 메시지를 읽거나, 메시지를 삭제하거나, 참여자를 변경할 수 있어서는 안 됩니다.

---

## 현재 한계

이 프로젝트는 운영 환경에 사용할 수 없습니다.

현재 확인된 한계는 다음과 같습니다.

* 지나치게 큰 단일 서버 파일
* 책임 분리가 불명확함
* 자동 테스트 없음
* 신뢰할 수 있는 CI 파이프라인 없음
* 정식 데이터베이스 마이그레이션 체계 없음
* 애플리케이션 시작 시 데이터베이스 스키마 변경
* 불완전한 토큰 생명주기
* 리프레시 토큰 교체 없음
* 세션 폐기 없음
* 계정 복구 없음
* 이메일 인증 없음
* 실질적인 요청 제한 전략 부족
* 악용 방지 기능 부족
* 입력 검증 부족
* 오류 처리 부족
* 구조화된 로그 부족
* 중앙 모니터링 없음
* 알림 체계 없음
* 문서화된 백업 전략 없음
* 문서화된 복구 절차 없음
* 부하 테스트 없음
* 보안 감사 없음
* 개인정보처리방침 없음
* 이용약관 없음
* 운영자 제재 절차 없음
* 관리자 도구 없음
* 계정 삭제 절차 없음
* 데이터 보관 정책 없음
* 접근성 검토 없음
* 모바일 브라우저 지원 검증 없음

이 프로젝트를 MVP라고 부른다고 해서 이러한 문제가 사라지는 것은 아닙니다.

MVP는 기능이 적을 수는 있습니다. 하지만 구현된 기능은 예측 가능하게 동작해야 하며, 사용자에게 명백한 보안 위험이나 데이터 손실 위험을 떠넘겨서는 안 됩니다.

---

## 필요한 테스트

현재 프로젝트에는 최소한 다음 영역을 검증하는 자동 테스트가 필요합니다.

### 인증 테스트

* 올바른 입력으로 회원가입이 성공하는지
* 중복 사용자명이 거부되는지
* 잘못된 비밀번호가 거부되는지
* 비밀번호가 해시로 저장되는지
* 올바른 자격 증명으로 로그인되는지
* 잘못된 자격 증명으로 로그인이 실패하는지
* 잘못된 토큰이 거부되는지
* 만료된 토큰이 거부되는지
* 로그아웃된 세션이 재연결할 수 없는지

### 권한 테스트

* 사용자가 다른 사용자의 비공개 데이터에 접근할 수 없는지
* 차단된 사용자가 메시지를 보낼 수 없는지
* 채팅방 비참여자가 메시지를 읽을 수 없는지
* 권한 없는 사용자가 채팅방에 참여할 수 없는지
* 사용자가 다른 사용자의 메시지를 삭제할 수 없는지
* 퇴장된 참여자가 계속 채팅 이벤트를 받을 수 없는지
* 사용자가 다른 사용자의 푸시 구독을 수정할 수 없는지

### 메시징 테스트

* 메시지가 올바르게 저장되는지
* 메시지 순서가 안정적으로 유지되는지
* 읽음 상태가 올바르게 기록되는지
* 삭제된 메시지가 정책에 따라 숨겨지는지
* 중복 이벤트가 중복 메시지를 생성하지 않는지
* 재연결 과정에서 메시지 상태가 깨지지 않는지

### 운영 테스트

* 필수 환경 변수가 없을 때 서버가 안전하게 종료되는지
* 데이터베이스 장애가 통제된 오류로 처리되는지
* 빈 데이터베이스에서 마이그레이션이 실행되는지
* 마이그레이션을 되돌리거나 복구할 수 있는지
* 애플리케이션 재시작 후 데이터가 손상되지 않는지

---

## 로드맵

### 1단계: 문서 및 안정성

* 현재 데이터베이스 스키마 문서화
* 모든 환경 변수 문서화
* 사용하지 않는 의존성 제거
* 린트 및 포맷팅 추가
* 일관된 오류 처리 추가

### 2단계: 보안

* `SESSION_SECRET` 필수화
* 토큰 만료 추가
* 리프레시 토큰 교체 추가
* 세션 폐기 추가
* 로그인 요청 제한 추가
* 회원가입 요청 제한 추가
* HTTP 보안 헤더 추가
* CORS 제한
* 입력 검증 추가
* 모든 권한 경로 검토

### 3단계: 아키텍처

* 단일 서버 파일 분리
* 라우트, 컨트롤러, 서비스, 저장소 분리
* Socket.IO 이벤트 핸들러 분리
* 정식 마이그레이션 도구 도입
* 환경 설정 검증 도입
* 구조화된 애플리케이션 오류 도입

### 4단계: 테스트 및 자동화

* 단위 테스트 추가
* API 통합 테스트 추가
* Socket.IO 통합 테스트 추가
* 권한 테스트 추가
* GitHub Actions 추가
* 의존성 감사 추가
* 자동 마이그레이션 검사 추가

### 5단계: 운영

* 구조화된 로그 추가
* 오류 추적 추가
* 상태 확인 엔드포인트 추가
* 가동 상태 모니터링 추가
* 데이터베이스 백업 추가
* 데이터베이스 복구 테스트
* 성능 테스트 추가
* 배포 롤백 절차 추가

### 6단계: 제품 요구사항

* 이메일 인증
* 비밀번호 복구
* 계정 삭제
* 운영자 제재 도구
* 신고 처리 절차
* 개인정보처리방침
* 이용약관
* 데이터 보관 규칙
* 접근성 개선

---

## 평가

이 프로젝트에는 초기 프로젝트에서 흔히 발생하는 문제가 있습니다. 기능의 누적을 엔지니어링 성숙도로 착각하고 있습니다. 기능이 많다는 것과 좋은 시스템이라는 것은 전혀 다른 이야기입니다.

이 저장소는 노력, 호기심, 끈기를 보여줍니다. 동시에 약한 책임 경계, 부족한 테스트, 불완전한 보안 설계, 오래된 문서, 사실상 존재하지 않는 운영 준비도 보여줍니다.

가장 큰 서버 파일은 애플리케이션의 거의 모든 책임을 흡수하도록 방치되었습니다. 이것은 단순함이 아닙니다. 복잡성을 나중으로 미룬 것입니다.

인증 시스템은 개념을 보여주기에는 충분히 작동하지만, 실제 사용자를 보호할 정도로 성숙하지 않았습니다.

데이터베이스 구조는 점점 복잡한 기능을 지원하고 있지만, 마이그레이션 전략은 사실상 애플리케이션 시작 시 즉흥적으로 스키마를 변경하는 수준입니다.

메시징 시스템은 사용자의 대화를 저장하지만, 개인 대화를 저장하는 소프트웨어에 요구되는 정책, 보호 장치, 모니터링, 복구 절차는 아직 제공하지 않습니다.

기존 README는 코드가 더 이상 하지 않는 동작을 설명하고 있었습니다. 이것은 기본적인 문서 관리 실패이며, 기능을 추가하는 속도가 프로젝트를 검토하는 속도보다 빨랐다는 경고 신호입니다.

현재는 권한 규칙이 올바르다는 강한 증거가 없습니다. 해당 규칙을 증명하는 제대로 된 자동 테스트가 없기 때문입니다. 수동 테스트에서 정상적으로 보이는 시스템도 실제로는 다음 문제를 허용할 수 있습니다.

* 권한 없는 메시지 접근
* 권한 없는 메시지 삭제
* 채팅방 참여 권한 우회
* 사용자 사칭
* 토큰 재사용
* 무제한 요청을 이용한 악용
* 스키마 변경 중 데이터 손실

