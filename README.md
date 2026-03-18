# AI Video Generation Backend Platform

> **프로덕션 수준의 NestJS 백엔드** — AI 기반 영상 생성 플랫폼을 실제 서비스처럼 설계·구현한 풀스택 백엔드 프로젝트

[![NestJS](https://img.shields.io/badge/NestJS-10-E0234E?style=flat-square&logo=nestjs)](https://nestjs.com)
[![TypeScript](https://img.shields.io/badge/TypeScript-5-3178C6?style=flat-square&logo=typescript)](https://www.typescriptlang.org)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-16-4169E1?style=flat-square&logo=postgresql)](https://www.postgresql.org)
[![Redis](https://img.shields.io/badge/Redis-7-DC382D?style=flat-square&logo=redis)](https://redis.io)
[![BullMQ](https://img.shields.io/badge/BullMQ-5-FF6B6B?style=flat-square)](https://docs.bullmq.io)
[![Docker](https://img.shields.io/badge/Docker-Compose-2496ED?style=flat-square&logo=docker)](https://docs.docker.com/compose)
[![Socket.IO](https://img.shields.io/badge/Socket.IO-4-010101?style=flat-square&logo=socket.io)](https://socket.io)
[![Swagger](https://img.shields.io/badge/Swagger-OpenAPI_3.0-85EA2D?style=flat-square&logo=swagger)](https://swagger.io)

---

## 프로젝트 소개

영상 생성 AI 모델을 프로덕션 환경에서 운영할 때 필요한 **백엔드 인프라 전체**를 직접 설계·구현한 포트폴리오 프로젝트입니다.

단순 CRUD를 넘어, 실제 서비스에서 발생하는 문제들을 해결합니다:

| 문제 | 해결 방법 |
|------|---------|
| AI 생성은 수십 초~수 분 소요 | BullMQ 비동기 잡 큐 + 진행률 폴링 |
| 동시 요청으로 인한 Race Condition | Optimistic Locking (`UPDATE WHERE status = :expected`) |
| 클라이언트의 반복 폴링 부하 | Socket.IO WebSocket push 실시간 알림 |
| 최종 실패 잡의 유실 | Dead Letter Queue — PostgreSQL 영구 저장 |
| 무제한 API 호출 남용 | 3-tier Named Throttler (burst/standard/sustained) |
| 단일 장애점 (monolith) | API / Worker 컨테이너 분리, MSA 도메인 이벤트 |

---

## 시스템 아키텍처

```
┌─────────────────────────────────────────────────────────────────┐
│  Client                                                          │
│    ├─ REST API   →  NestJS API Container                         │
│    └─ WebSocket  →  Socket.IO Gateway (/video-status)            │
└─────────────────┬───────────────────────────────────────────────┘
                  │
         ┌────────▼────────┐
         │   API Container  │  JWT 인증 · DTO 검증 · Rate Limiting
         │  (NestJS + HTTP) │  Swagger · Helmet · CORS
         └────────┬────────┘
                  │ BullMQ enqueue
         ┌────────▼────────┐
         │  Redis (Queue)   │  Job Queue Transport
         │  + Cache (TTL)   │  Status Cache-aside (5분 TTL)
         └────────┬────────┘
                  │ dequeue
         ┌────────▼────────┐
         │ Worker Container │  VideoGenerationProcessor
         │  (Headless NestJS│  GPT-4o Prompt 향상
         │   + BullMQ)      │  AI Provider 호출 (Fake / OpenAI)
         └────────┬────────┘  진행률 폴링 (10초 간격, 최대 30회)
                  │
         ┌────────▼────────┐
         │  AWS S3 / MinIO  │  영상 업로드 · Presigned URL
         └─────────────────┘
                  │ EventEmitter2 domain events
         ┌────────▼────────┐
         │  PostgreSQL      │  Video · User · FailedJob 영속화
         └─────────────────┘
```

**컨테이너 구성** — 동일 Docker 이미지, 진입점만 분리

```
ai-gen-video:latest
  ├─ node dist/main        → API 서버 (HTTP + WebSocket)
  └─ node dist/main.worker → 헤드리스 Worker (HTTP 없음)
```

---

## 핵심 기술 구현

### 1. Optimistic Locking으로 Race Condition 제거

BullMQ가 동일 잡을 두 Worker에 동시 전달하는 엣지케이스를 DB 레벨에서 차단:

```sql
UPDATE videos
SET status = 'processing', metadata = :meta
WHERE id = :videoId AND status = :expectedStatus
```

`affected === 0`이면 다른 Worker가 이미 처리 중 → 현재 Worker는 즉시 종료.
상태 전이 규칙은 서비스 레이어 State Machine으로 명시:

```
PENDING → PROCESSING → COMPLETED
                    └→ FAILED
PENDING → FAILED
```

### 2. 도메인 이벤트 기반 MSA 준비 아키텍처

Processor, Gateway, DLQ는 서로 직접 의존하지 않습니다:

```
VideoGenerationProcessor
  └─ eventEmitter.emit('video.progress.updated', event)
                          │
              ┌───────────┼───────────┐
              ▼           ▼           ▼
       VideoGateway   DlqService   (미래: Kafka Consumer)
    (Socket.IO push) (DB 저장)
```

`EventEmitter2` → Redis Pub/Sub → Kafka 순으로 **코드 변경 없이** 마이그레이션 가능한 계약 구조.

### 3. 실시간 진행률 — WebSocket Room 격리

```javascript
// Client
const socket = io('http://localhost:3000/video-status');
socket.emit('subscribe', { videoId: 'uuid' });

socket.on('video.progress.updated', ({ percent, message }) => {
  progressBar.update(percent); // 폴링 없이 실시간 업데이트
});
```

`video:{videoId}` Room 단위 격리로 다른 사용자 이벤트 크로스 없음.

### 4. 3-tier Rate Limiting

```
burst     — 20 req / 10s    → 순간 스파이크 방어
standard  — 100 req / 60s   → 일반 트래픽 (env 조정 가능)
sustained — 1,000 req / 1h  → 장기 남용 차단
```

엔드포인트별 개별 정책 오버라이드 (`@Throttle` 데코레이터):
- `POST /videos` — burst 3/10s + sustained 10/h (AI 작업 비용 반영)
- `POST /auth/login` — burst 5/60s + standard 10/15min (Brute-force 방어)

### 5. Dead Letter Queue

모든 재시도(최대 3회) 소진 후 영구 실패 잡을 PostgreSQL에 저장:

```
BullMQ (3회 실패)
  → VIDEO_EVENTS.FAILED 도메인 이벤트
    → DlqService.onVideoFailed()
      → failed_jobs INSERT (errorMessage, jobData, attemptsMade)

POST /queue/failed-jobs/:id/retry
  → video.status = PENDING 리셋
  → 새 BullMQ 잡 등록
  → 409 Conflict (중복 재처리 방지)
```

---

## 기술 스택

| 분류 | 기술 |
|------|------|
| 프레임워크 | NestJS 10, TypeScript 5 |
| 데이터베이스 | PostgreSQL 16 + TypeORM 0.3 |
| 큐 / 캐시 | Redis 7 + BullMQ 5 + ioredis |
| 스토리지 | AWS S3 (`@aws-sdk/client-s3`) + MinIO 호환 |
| 인증 | JWT (Passport.js) + bcryptjs salt=12 |
| 실시간 | Socket.IO 4 (`@nestjs/websockets`) |
| AI | OpenAI GPT-4o (Prompt 향상), FakeVideoProvider (시뮬레이션) |
| 모니터링 | Bull Board (`@bull-board/nestjs`) |
| 문서화 | Swagger / OpenAPI 3.0 |
| 인프라 | Docker + Docker Compose (3-stage multi-stage build) |
| 로깅 | Winston + nest-winston (JSON 구조화 로그) |
| 보안 | Helmet, CORS, ThrottlerGuard, Basic Auth |
| 헬스체크 | `@nestjs/terminus` TypeORM pingCheck |

---

## API 엔드포인트

### 인증 (`/api/v1/auth`)

| Method | Endpoint | 설명 | 인증 |
|--------|----------|------|------|
| POST | `/auth/register` | 회원가입 | Public |
| POST | `/auth/login` | 로그인 (토큰 발급) | Public |
| POST | `/auth/refresh` | 액세스 토큰 갱신 | Public |
| GET | `/auth/profile` | 내 프로필 조회 | JWT |
| POST | `/auth/logout` | 로그아웃 | JWT |

### 영상 (`/api/v1/videos`)

| Method | Endpoint | 설명 | 인증 |
|--------|----------|------|------|
| POST | `/videos` | 영상 생성 요청 (큐 등록) | JWT |
| GET | `/videos` | 내 영상 목록 (페이지네이션 + 상태 필터) | JWT |
| GET | `/videos/:id` | 작업 상태 폴링 (진행률 포함) | JWT |
| GET | `/videos/:id/result` | Presigned 다운로드 URL 발급 | JWT |
| PATCH | `/videos/:id` | 제목/메타데이터 수정 | JWT |
| DELETE | `/videos/:id` | 영상 삭제 | JWT |

### 큐 관리 (`/api/v1/queue`)

| Method | Endpoint | 설명 | 인증 |
|--------|----------|------|------|
| GET | `/queue/jobs/:jobId` | BullMQ 잡 상태 조회 | JWT |
| GET | `/queue/failed-jobs` | DLQ — 영구 실패 잡 목록 | JWT |
| GET | `/queue/failed-jobs/:id` | DLQ — 단건 조회 | JWT |
| POST | `/queue/failed-jobs/:id/retry` | DLQ — 수동 재처리 | JWT |

### 기타

| Method | Endpoint | 설명 | 인증 |
|--------|----------|------|------|
| GET | `/health` | 헬스체크 (DB 연결 확인) | Public |
| GET | `/admin/queues` | Bull Board 모니터링 UI | Basic Auth |
| GET | `/api/docs` | Swagger UI | Public (비프로덕션) |

---

## 비동기 처리 파이프라인

```
1. POST /videos
   └─ Video 레코드 생성 (status: PENDING)
   └─ BullMQ 잡 등록, queueJobId 저장
   └─ emit('video.created') → WebSocket push

2. VideoGenerationProcessor (Worker Container)
   ├─ status → PROCESSING (Optimistic Lock), progress: 10%
   ├─ emit('video.processing.started') → WebSocket push
   ├─ GPT-4o 프롬프트 향상 (progress: 20%)
   ├─ AI Provider 영상 생성 제출 (progress: 40%)
   ├─ 10초 간격 폴링 (최대 30회 = 5분)
   │    └─ emit('video.progress.updated') → WebSocket push
   ├─ S3 업로드 (또는 alreadyStored=true 시 URL 직접 사용)
   ├─ status → COMPLETED, videoUrl 저장
   └─ emit('video.completed') → WebSocket push

3. 실패 시 (최대 3회 재시도, 지수 백오프: 5s → 25s → 125s)
   └─ emit('video.failed') → DlqService → failed_jobs INSERT

4. GET /videos/:id/result  →  Presigned URL 발급 (최대 24시간)
```

---

## 데이터베이스 스키마

### users

| 컬럼 | 타입 | 설명 |
|------|------|------|
| id | UUID PK | 사용자 ID |
| email | VARCHAR UNIQUE | 이메일 |
| username | VARCHAR UNIQUE | 사용자명 |
| password | VARCHAR | bcryptjs 해시 (salt=12) |
| role | ENUM | ADMIN / USER |
| isActive | BOOLEAN | 계정 활성 여부 |

### videos

| 컬럼 | 타입 | 설명 |
|------|------|------|
| id | UUID PK | 영상 ID |
| title | VARCHAR | 제목 |
| prompt | TEXT | 생성 프롬프트 |
| status | ENUM | PENDING / PROCESSING / COMPLETED / FAILED / CANCELLED |
| videoUrl | VARCHAR | S3 영상 URL |
| width / height / fps | INTEGER | 영상 해상도/프레임 |
| metadata | JSONB | 진행률, aiJobId, 예상 잔여시간 |
| queueJobId | VARCHAR | BullMQ 잡 ID |
| userId | UUID FK | 소유자 (CASCADE DELETE) |

### failed_jobs (DLQ)

| 컬럼 | 타입 | 설명 |
|------|------|------|
| id | UUID PK | DLQ 레코드 ID |
| videoId | VARCHAR | 실패한 영상 ID |
| queueJobId | VARCHAR | 실패 당시 BullMQ 잡 ID |
| errorMessage | TEXT | 최종 에러 메시지 |
| jobData | JSONB | 재처리용 잡 데이터 스냅샷 |
| attemptsMade | INT | 총 시도 횟수 |
| retried | BOOLEAN | 수동 재처리 여부 |
| retryJobId | VARCHAR | 재처리 시 발급된 새 잡 ID |
| failedAt | TIMESTAMPTZ | 영구 실패 시각 |

---

## 로컬 실행

### 사전 요구사항

- Node.js 20+
- Docker & Docker Compose

### 환경변수 설정

```bash
cp .env.example .env
# .env 파일에서 JWT_SECRET, DB 비밀번호, S3 키, OpenAI 키 설정
```

### Docker Compose로 전체 스택 실행

```bash
# PostgreSQL + Redis + API + Worker 동시 기동
docker-compose up -d

# 로그 확인
docker-compose logs -f api
docker-compose logs -f worker
```

### 개발 서버 실행 (로컬)

```bash
npm install

# API 서버
npm run start:dev

# Worker (별도 터미널)
npm run start:worker:dev
```

### 접속 정보

| 서비스 | URL |
|--------|-----|
| REST API | `http://localhost:3000/api/v1` |
| Swagger UI | `http://localhost:3000/docs` |
| Bull Board | `http://localhost:3000/admin/queues` (admin/admin) |
| WebSocket | `ws://localhost:3000/video-status` |

---

## 환경변수

```env
# Application
NODE_ENV=development
PORT=3000
CORS_ORIGIN=http://localhost:3001

# PostgreSQL
DB_HOST=localhost
DB_PORT=5432
DB_USERNAME=postgres
DB_PASSWORD=postgres
DB_DATABASE=ai_gen_video
DB_SYNCHRONIZE=false
DB_LOGGING=false

# JWT
JWT_SECRET=your-secret-key
JWT_EXPIRES_IN=7d
JWT_REFRESH_SECRET=your-refresh-secret
JWT_REFRESH_EXPIRES_IN=30d

# Redis
REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_PASSWORD=

# AWS S3 (또는 MinIO)
AWS_REGION=us-east-1
AWS_ACCESS_KEY_ID=your-key
AWS_SECRET_ACCESS_KEY=your-secret
AWS_S3_BUCKET=ai-gen-video-storage
AWS_S3_ENDPOINT=              # MinIO 사용 시 설정

# OpenAI
OPENAI_API_KEY=your-openai-key

# AI Provider
AI_VIDEO_PROVIDER=fake         # fake | openai
AI_VIDEO_API_KEY=
AI_VIDEO_API_URL=

# Rate Limiting
THROTTLE_TTL=60
THROTTLE_LIMIT=100

# Bull Board Monitoring
MONITORING_USER=admin
MONITORING_PASSWORD=change-me-in-production
```

---

## 보안

| 항목 | 구현 |
|------|------|
| 인증 | JWT 액세스 토큰 (7d) + 리프레시 토큰 (30d) |
| 비밀번호 | bcryptjs salt=12 |
| 헤더 보안 | Helmet.js (XSS, Clickjacking, HSTS 등) |
| Rate Limiting | 3-tier ThrottlerGuard (burst/standard/sustained) |
| CORS | 설정된 Origin만 허용 |
| S3 접근 | Presigned URL 기반 (버킷 직접 노출 없음) |
| 모니터링 UI | HTTP Basic Auth 보호 |
| 권한 분리 | RolesGuard (ADMIN / USER RBAC) |

---

## 단계별 구현 이력

| 단계 | 내용 |
|------|------|
| 1단계 | NestJS 백엔드 아키텍처 설계 — 모듈 구조, JWT 인증, TypeORM 연동 |
| 2단계 | REST API 설계 및 구현 — 영상 CRUD, 페이지네이션, Swagger 문서화 |
| 3단계 | BullMQ 잡큐 구현 — Bull → BullMQ 마이그레이션, 재시도 로직, 상태 추적 |
| 4단계 | AI 워커 서비스 — FakeVideoProvider 시뮬레이터, 진행률 폴링, S3 업로드 파이프라인 |
| 5단계 | AWS S3 스토리지 통합 — S3Provider 분리, 에러 핸들링, 지수 백오프 재시도 로직 |
| 6단계 | 잡 상태 시스템 — Redis 캐시, Optimistic Locking, State Machine, Idempotency |
| 7단계 | 컨테이너 아키텍처 — API/Worker 분리 컨테이너, 3단계 멀티스테이지 빌드 최적화 |
| 8단계 | MSA 기반 — 서비스 계약 인터페이스, 도메인 이벤트 시스템, 헬스체크 엔드포인트 |
| 9단계 | Rate Limiting — 3단계 Named Throttler (burst/standard/sustained), 엔드포인트별 정책 |
| 10단계 | WebSocket 실시간 잡 상태 — Socket.IO Gateway, 도메인 이벤트 → Room push |
| 11단계 | Dead Letter Queue — 영구 실패 잡 PostgreSQL 영속화, 수동 재처리 API (list/retry) |
| 12단계 | 큐 모니터링 — Bull Board UI (/admin/queues), Basic Auth 보호, BullMQAdapter 연동 |

---

## 모듈 구성

```
src/
├── main.ts                      # API 앱 부트스트랩 (Swagger, Security, Versioning)
├── main.worker.ts               # Worker 전용 부트스트랩 (Headless, Graceful Shutdown)
├── app.module.ts                # 루트 모듈
├── worker-app.module.ts         # Worker 전용 모듈 (Auth/Throttler 제외)
├── config/                      # 환경변수 기반 설정 (DB, JWT, Redis, S3)
├── common/                      # 공통 계층
│   ├── decorators/              # @CurrentUser, @Public, @Roles, @SkipThrottle
│   ├── filters/                 # HttpExceptionFilter (전역 예외 처리)
│   ├── guards/                  # JwtAuthGuard, RolesGuard
│   ├── interceptors/            # TransformInterceptor (응답 표준화), LoggingInterceptor
│   └── pipes/                   # ValidationPipe (DTO 유효성 검사)
├── shared/
│   ├── contracts/               # IVideoService, IAiService, IStorageService (MSA 계약)
│   └── events/                  # VideoCreatedEvent, VideoCompletedEvent 등 도메인 이벤트
└── modules/
    ├── auth/                    # 회원가입, 로그인, 토큰 갱신 (Passport JWT)
    ├── users/                   # 사용자 엔티티 및 CRUD (RBAC)
    ├── videos/                  # 영상 생성 요청, 상태 조회, Presigned URL
    ├── ai/                      # AI Provider 추상화 계층
    │   └── providers/
    │       ├── fake-video.provider.ts   # 개발/테스트용 인메모리 시뮬레이터
    │       └── openai.provider.ts       # 실제 AI 연동 (확장 가능)
    ├── queue/                   # BullMQ 큐, 워커 프로세서, 잡 상태, DLQ
    │   ├── processors/          # VideoGenerationProcessor (WorkerHost)
    │   ├── entities/            # FailedJob (DLQ 엔티티)
    │   ├── dto/                 # JobStatusDto, FailedJobDto
    │   ├── job-status.service.ts # Optimistic Locking + Redis Cache
    │   └── dlq.service.ts       # 이벤트 캡처 + 재처리 로직
    ├── storage/                 # S3 업로드, Presigned URL, 지수 백오프 재시도
    ├── gateway/                 # Socket.IO WebSocket Gateway (Room 기반)
    ├── health/                  # @nestjs/terminus 헬스체크
    └── monitoring/              # Bull Board UI + Basic Auth 미들웨어
```
