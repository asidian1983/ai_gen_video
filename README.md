# AI Video Generation Backend Platform

> **프로덕션 수준의 NestJS 백엔드** — AI 기반 영상 생성 서비스의 백엔드 인프라 전체를 직접 설계·구현한 포트폴리오 프로젝트

[![NestJS](https://img.shields.io/badge/NestJS-10-E0234E?style=flat-square&logo=nestjs)](https://nestjs.com)
[![TypeScript](https://img.shields.io/badge/TypeScript-5-3178C6?style=flat-square&logo=typescript)](https://www.typescriptlang.org)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-16-4169E1?style=flat-square&logo=postgresql)](https://www.postgresql.org)
[![Redis](https://img.shields.io/badge/Redis-7-DC382D?style=flat-square&logo=redis)](https://redis.io)
[![BullMQ](https://img.shields.io/badge/BullMQ-5-FF6B6B?style=flat-square)](https://docs.bullmq.io)
[![Docker](https://img.shields.io/badge/Docker-Compose-2496ED?style=flat-square&logo=docker)](https://docs.docker.com/compose)
[![Socket.IO](https://img.shields.io/badge/Socket.IO-4-010101?style=flat-square&logo=socket.io)](https://socket.io)
[![Swagger](https://img.shields.io/badge/Swagger-OpenAPI_3.0-85EA2D?style=flat-square&logo=swagger)](https://swagger.io)

---

## 무엇을 구현했는가

**18개 REST 엔드포인트 · 12개 NestJS 모듈 · 4개 Docker 서비스 · 3개 DB 테이블**

단순 CRUD가 아닌, **실제 AI SaaS 백엔드에서 반드시 해결해야 하는 문제**들을 직접 구현했습니다:

| 실제 발생하는 문제 | 구현한 해결책 | 핵심 기술 |
|----------------|------------|---------|
| AI 생성 작업이 수십 초~수 분 소요 | 비동기 Job Queue + 진행률 실시간 push | BullMQ + Socket.IO |
| 동시 Worker가 같은 잡을 처리하는 Race Condition | DB 레벨 Optimistic Locking | `UPDATE WHERE status = :expected` |
| 폴링으로 인한 서버·클라이언트 부하 | WebSocket Room 기반 실시간 push | EventEmitter2 → Socket.IO |
| 모든 재시도 소진 후 잡 유실 | Dead Letter Queue — PostgreSQL 영구 저장 | 도메인 이벤트 + TypeORM |
| API 남용 및 Brute-force 공격 | 엔드포인트별 3-tier Rate Limiting | @nestjs/throttler Named Throttler |
| 단일 장애점 (AI 처리 블로킹) | API / Worker 컨테이너 완전 분리 | Docker + MSA 도메인 이벤트 |
| 큐 상태 블랙박스 문제 | 실시간 큐 시각화 대시보드 | Bull Board |

---

## 시스템 아키텍처

```
┌──────────────────────────────────────────────────────────────────┐
│  Client                                                           │
│    ├─ HTTP  →  REST API  (JWT 인증 · Rate Limiting · Swagger)     │
│    └─ WS    →  Socket.IO Gateway  (/video-status namespace)       │
└──────────────────┬───────────────────────────────────────────────┘
                   │
          ┌────────▼────────┐
          │   API Container  │  NestJS + Express
          │                  │  Helmet · CORS · ThrottlerGuard
          └────────┬─────────┘
                   │  BullMQ.add(job)
          ┌────────▼─────────┐
          │  Redis 7          │  Job Queue Transport
          │                   │  Status Cache-aside (TTL 5분)
          └────────┬──────────┘
                   │  Worker.process(job)
          ┌────────▼─────────┐
          │ Worker Container  │  Headless NestJS (HTTP 없음)
          │                   │  GPT-4o Prompt 향상
          │                   │  AI Provider 호출 + 폴링
          └────┬──────────────┘
               │                  EventEmitter2
    ┌──────────┼──────────┐  ─────────────────────────────
    ▼          ▼          ▼       도메인 이벤트 팬아웃
  AWS S3    PostgreSQL  Socket.IO  (코드 변경 없이 Kafka로 교체 가능)
 (영상 저장)  (상태 영속화) (클라이언트 push)
```

**One Image, Two Services 패턴**
```bash
ai-gen-video:latest
  ├─ CMD node dist/main        # API + WebSocket
  └─ CMD node dist/main.worker # Worker (독립 스케일링)
```

---

## 핵심 설계 결정 (Why)

### BullMQ를 선택한 이유

> Redis Streams 기반의 BullMQ는 기존 Bull 대비 TypeScript 완전 지원, Job Groups, Rate Limiter가 내장되어 있고, 실패 잡 보관(`removeOnFail: { count: 500 }`)으로 DLQ 구현 전에도 디버깅 가능합니다.

### Optimistic Locking을 선택한 이유

> Pessimistic Lock(SELECT FOR UPDATE)은 트랜잭션 유지 중 네트워크 지연 시 전체 Worker가 블로킹됩니다. BullMQ의 at-least-once 보장 특성상 동일 잡이 두 Worker에 전달될 수 있는데, Optimistic Lock은 "시도 → 실패 감지 → 조용히 포기" 패턴으로 불필요한 대기 없이 처리합니다.

```sql
-- 단 한 줄로 Race Condition을 원천 차단
UPDATE videos SET status='processing' WHERE id=:id AND status='pending'
-- affected = 0 이면 다른 Worker가 이미 처리 중 → 즉시 종료
```

### EventEmitter2 도메인 이벤트를 선택한 이유

> Processor, WebSocket Gateway, DLQ가 서로를 직접 의존하면 기능 추가 시마다 Processor를 수정해야 합니다. 도메인 이벤트로 완전히 분리하면 새 소비자(예: Slack 알림 서비스)를 Processor 코드 변경 없이 추가할 수 있습니다. 또한 in-process EventEmitter2 → Redis Pub/Sub → Kafka로의 마이그레이션이 이벤트 계약(타입)만 유지하면 가능합니다.

---

## 핵심 기술 구현

### 1. Race Condition 제거 — Optimistic Locking + State Machine

```
상태 전이 규칙 (서비스 레이어 강제)
PENDING → PROCESSING → COMPLETED
                    └→ FAILED
PENDING → FAILED
```

`JobStatusService.transitionStatus()`: `UPDATE WHERE status = :expected` — `affected === 0`이면 다른 Worker가 선점 → 현재 Worker 즉시 종료

### 2. 실시간 진행률 — 제로 폴링 WebSocket

```javascript
// 클라이언트 구현 예시
const socket = io('http://localhost:3000/video-status');
socket.emit('subscribe', { videoId: 'uuid-here' });

socket.on('video.progress.updated', ({ percent, message }) => {
  progressBar.update(percent); // DB 조회 없이 실시간 수신
});

socket.on('video.completed', ({ videoId, videoUrl }) => {
  socket.emit('unsubscribe', { videoId });
  playVideo(videoUrl);
});
```

`video:{videoId}` Room 격리 → 다른 사용자의 이벤트 크로스 불가.

### 3. 3-tier Rate Limiting

```
Tier       Window   Limit   목적
─────────────────────────────────────────
burst      10s      20      순간 스파이크 방어
standard   60s      100     일반 트래픽 (env 조정)
sustained  1h       1,000   장기 남용 차단
```

엔드포인트별 오버라이드 — `POST /videos`는 AI 작업 비용을 반영해 sustained 10/h로 제한.

### 4. Dead Letter Queue — 데이터 유실 없는 장애 복구

```
BullMQ 3회 재시도 소진
  └─ emit(VIDEO_EVENTS.FAILED)
       └─ DlqService.onVideoFailed()    ← @OnEvent 리스너
            └─ failed_jobs INSERT
                 └─ POST /queue/failed-jobs/:id/retry
                      ├─ video.status = PENDING 리셋
                      ├─ 새 BullMQ 잡 등록
                      └─ 409 Conflict (중복 재처리 방지)
```

### 5. 3-stage Docker 멀티스테이지 빌드

```dockerfile
# Stage 1: builder (devDeps 포함 전체 빌드)
FROM node:20-alpine AS builder
RUN npm ci && npm run build        # dist/ 생성

# Stage 2: production-deps (devDeps 제거)
FROM node:20-alpine AS production-deps
RUN npm ci --omit=dev              # node_modules 경량화

# Stage 3: production (최소 이미지)
FROM node:20-alpine AS production
COPY --from=production-deps /app/node_modules .
COPY --from=builder /app/dist .    # 소스코드 없음, dist만 복사
```

> 기존 `npm ci --only=production` 후 `nest build` 실행 시 `@nestjs/cli`(devDep)가 없어 빌드 실패하는 버그를 스테이지 분리로 해결.

---

## 기술 스택

| 분류 | 기술 | 선택 이유 |
|------|------|---------|
| 프레임워크 | NestJS 10, TypeScript 5 | DI 컨테이너, 데코레이터 기반 모듈화, 엔터프라이즈 패턴 |
| 데이터베이스 | PostgreSQL 16 + TypeORM | JSONB 메타데이터 저장, Optimistic Lock SQL |
| 큐 / 캐시 | Redis 7 + BullMQ 5 | TypeScript 네이티브, 내장 재시도·지연·Rate Limiter |
| 스토리지 | AWS S3 + MinIO 호환 | Presigned URL로 서버 대역폭 제로 |
| 인증 | JWT (Passport.js) + bcryptjs | Stateless, 액세스(7d)/리프레시(30d) 이중 토큰 |
| 실시간 | Socket.IO 4 | Room 기반 격리, reconnect 자동 처리 |
| AI | OpenAI GPT-4o + FakeVideoProvider | 프롬프트 향상 + 테스트용 시뮬레이터 분리 |
| 모니터링 | Bull Board | 큐 시각화, 잡 재처리 UI |
| 문서화 | Swagger / OpenAPI 3.0 | Bearer Auth 내장, DTO → 스키마 자동 생성 |
| 인프라 | Docker Compose (3-stage build) | API/Worker 독립 스케일링 |
| 로깅 | Winston + nest-winston | JSON 구조화 로그, 레벨별 파일 분리 |
| 보안 | Helmet + ThrottlerGuard + RBAC | OWASP Top 10 대응 |

---

## API 엔드포인트 (18개)

### 인증 (`/api/v1/auth`)

| Method | Endpoint | 설명 | 인증 |
|--------|----------|------|------|
| POST | `/auth/register` | 회원가입 | Public |
| POST | `/auth/login` | 로그인 (JWT 발급) | Public |
| POST | `/auth/refresh` | 액세스 토큰 갱신 | Public |
| GET | `/auth/profile` | 내 프로필 조회 | JWT |
| POST | `/auth/logout` | 로그아웃 | JWT |

### 영상 (`/api/v1/videos`)

| Method | Endpoint | 설명 | 인증 |
|--------|----------|------|------|
| POST | `/videos` | 영상 생성 요청 (큐 등록) | JWT |
| GET | `/videos` | 내 영상 목록 (페이지네이션 + 상태 필터) | JWT |
| GET | `/videos/:id` | 작업 상태 + 진행률 조회 | JWT |
| GET | `/videos/:id/result` | Presigned 다운로드 URL 발급 (24h) | JWT |
| PATCH | `/videos/:id` | 제목/메타데이터 수정 | JWT |
| DELETE | `/videos/:id` | 영상 삭제 | JWT |

### 큐 관리 (`/api/v1/queue`)

| Method | Endpoint | 설명 | 인증 |
|--------|----------|------|------|
| GET | `/queue/jobs/:jobId` | BullMQ 잡 상태 조회 | JWT |
| GET | `/queue/failed-jobs` | DLQ 목록 (페이지네이션) | JWT |
| GET | `/queue/failed-jobs/:id` | DLQ 단건 조회 | JWT |
| POST | `/queue/failed-jobs/:id/retry` | DLQ 수동 재처리 | JWT |

### 인프라

| Method | Endpoint | 설명 | 인증 |
|--------|----------|------|------|
| GET | `/health` | 헬스체크 (DB pingCheck) | Public |
| GET | `/admin/queues` | Bull Board 모니터링 UI | Basic Auth |
| GET | `/docs` | Swagger UI | Public (비프로덕션) |

---

## 비동기 처리 파이프라인

```
① POST /videos  ──────────────────────────────────────────── < 100ms 응답
   └─ Video(PENDING) 생성 → BullMQ enqueue → emit(video.created) → WS push

② Worker (별도 프로세스, 독립 스케일 가능)
   ├─ PENDING → PROCESSING  (Optimistic Lock)        progress: 10%
   ├─ GPT-4o Prompt 향상                             progress: 20%
   ├─ AI Provider 제출                                progress: 40%
   ├─ 10초 간격 폴링 × 최대 30회 (5분 타임아웃)       progress: 40→90%
   │    └─ emit(video.progress.updated) → WS Room push (매 10초)
   ├─ S3 업로드
   └─ PROCESSING → COMPLETED                         progress: 100%

③ 실패 시 지수 백오프 재시도
   1차 실패 →  5초 후 재시도
   2차 실패 → 25초 후 재시도
   3차 실패 → FAILED + DLQ INSERT + emit(video.failed) → WS push

④ GET /videos/:id/result → Presigned URL (서버 트래픽 제로)
```

---

## 데이터베이스 스키마

### users
| 컬럼 | 타입 | 설명 |
|------|------|------|
| id | UUID PK | |
| email | VARCHAR UNIQUE | |
| username | VARCHAR UNIQUE | |
| password | VARCHAR | bcryptjs hash (salt=12) |
| role | ENUM | ADMIN / USER |
| isActive | BOOLEAN | |

### videos
| 컬럼 | 타입 | 설명 |
|------|------|------|
| id | UUID PK | |
| prompt | TEXT | 원본 프롬프트 |
| status | ENUM | PENDING / PROCESSING / COMPLETED / FAILED / CANCELLED |
| videoUrl | VARCHAR | S3 업로드 URL |
| metadata | JSONB | progressPercent, aiJobId, estimatedSecondsRemaining |
| queueJobId | VARCHAR | BullMQ 잡 ID |
| userId | UUID FK | CASCADE DELETE |

### failed_jobs (DLQ)
| 컬럼 | 타입 | 설명 |
|------|------|------|
| id | UUID PK | |
| videoId | VARCHAR | 실패한 영상 ID |
| errorMessage | TEXT | 최종 에러 |
| jobData | JSONB | 재처리용 원본 잡 데이터 |
| attemptsMade | INT | 총 시도 횟수 |
| retried | BOOLEAN | 수동 재처리 여부 |
| retryJobId | VARCHAR | 재처리 시 발급된 새 잡 ID |
| failedAt | TIMESTAMPTZ | |

---

## 로컬 실행

```bash
# 1. 환경변수 설정
cp .env.example .env

# 2. 전체 스택 기동 (PostgreSQL + Redis + API + Worker)
docker-compose up -d

# 3. 로그 확인
docker-compose logs -f api worker
```

| 서비스 | URL | 인증 |
|--------|-----|------|
| REST API | `http://localhost:3000/api/v1` | JWT Bearer |
| Swagger UI | `http://localhost:3000/docs` | — |
| Bull Board | `http://localhost:3000/admin/queues` | admin / admin |
| WebSocket | `ws://localhost:3000/video-status` | — |

**개발 모드 (로컬 PostgreSQL + Redis 직접 연결):**
```bash
npm install
npm run start:dev        # API (터미널 1)
npm run start:worker:dev # Worker (터미널 2)
```

---

## 보안

| 항목 | 구현 |
|------|------|
| 인증 | JWT 액세스 토큰 (7d) + 리프레시 토큰 (30d) |
| 비밀번호 | bcryptjs salt=12 해시 |
| HTTP 헤더 | Helmet.js — XSS, Clickjacking, HSTS, CSP |
| Rate Limiting | 3-tier ThrottlerGuard (전역 적용, 엔드포인트 오버라이드) |
| CORS | 허용 Origin 화이트리스트 |
| S3 | Presigned URL — 버킷 직접 노출 없음 |
| 모니터링 UI | HTTP Basic Auth (MONITORING_USER/PASSWORD) |
| 권한 | RolesGuard RBAC (ADMIN / USER) |

---

## 향후 개선 방향

| 항목 | 내용 |
|------|------|
| 메시지 브로커 분리 | EventEmitter2 → Redis Pub/Sub → Kafka (계약 변경 없음) |
| 인증 강화 | Refresh Token Rotation + Redis Blacklist |
| 테스트 | Jest 단위 테스트 + Supertest E2E (현재 미구현) |
| 쿠버네티스 | Helm Chart 작성, Worker HPA (CPU 기반 자동 스케일링) |
| 메트릭 | Prometheus + Grafana 연동 (`@willsoto/nestjs-prometheus`) |
| DB 마이그레이션 | TypeORM synchronize=false → Migration 파일 관리 |

---

## 단계별 구현 이력

| 단계 | 내용 |
|------|------|
| 1단계 | NestJS 아키텍처 설계 — 모듈 구조, JWT 인증, TypeORM 연동 |
| 2단계 | REST API — 영상 CRUD, 페이지네이션, Swagger 문서화 |
| 3단계 | BullMQ 잡큐 — Bull → BullMQ 마이그레이션, 재시도, 상태 추적 |
| 4단계 | AI 워커 — FakeVideoProvider 시뮬레이터, 진행률 폴링, S3 파이프라인 |
| 5단계 | AWS S3 통합 — S3Provider 분리, 지수 백오프 재시도 |
| 6단계 | 잡 상태 시스템 — Optimistic Locking, State Machine, Redis Cache |
| 7단계 | 컨테이너 아키텍처 — API/Worker 분리, 3-stage 멀티스테이지 빌드 |
| 8단계 | MSA 기반 — 서비스 계약 인터페이스, 도메인 이벤트, 헬스체크 |
| 9단계 | Rate Limiting — 3-tier Named Throttler, 엔드포인트별 정책 |
| 10단계 | WebSocket 실시간 — Socket.IO Gateway, 도메인 이벤트 → Room push |
| 11단계 | Dead Letter Queue — 영구 실패 잡 영속화, 수동 재처리 API |
| 12단계 | 큐 모니터링 — Bull Board UI, Basic Auth 보호 |
| 13단계 | CI/CD 파이프라인 — GitHub Actions (lint/typecheck/Docker build), OCIR push, OCI Compute SSH 배포 |

---

## 모듈 구성

```
src/
├── main.ts / main.worker.ts     # API · Worker 각각의 부트스트랩
├── shared/
│   ├── contracts/               # IVideoService, IAiService (MSA 계약)
│   └── events/                  # 도메인 이벤트 클래스 (transport-agnostic)
└── modules/
    ├── auth/                    # JWT · Passport · Refresh Token
    ├── videos/                  # CRUD · 상태 조회 · Presigned URL
    ├── queue/
    │   ├── processors/          # VideoGenerationProcessor (WorkerHost)
    │   ├── job-status.service   # Optimistic Locking + Redis Cache
    │   └── dlq.service          # DLQ 이벤트 캡처 + 재처리
    ├── ai/providers/            # FakeVideoProvider · OpenAIProvider
    ├── storage/                 # S3 업로드 · Presigned URL · 재시도
    ├── gateway/                 # Socket.IO WebSocket (Room 기반)
    ├── health/                  # @nestjs/terminus pingCheck
    └── monitoring/              # Bull Board + Basic Auth 미들웨어
```
