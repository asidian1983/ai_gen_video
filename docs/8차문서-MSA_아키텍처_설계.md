# 8차 문서 — MSA 아키텍처 설계

> 서비스 경계 정의 · 도메인 이벤트 시스템 · 느슨한 결합 기반 구현
> 작성일: 2026-03-18

---

## 1. 현재 상태 vs MSA 목표

### 현재 (모놀리스 + 컨테이너 분리)

```
┌─────────────────────────────────┐  ┌──────────────────────────────┐
│      api 컨테이너               │  │    worker 컨테이너           │
│  ┌─────────────────────────┐    │  │ ┌──────────────────────────┐ │
│  │ AuthModule              │    │  │ │ QueueModule (Processor)  │ │
│  │ UsersModule             │    │  │ │ VideosModule             │ │
│  │ VideosModule ──────────────Redis──▶ AiModule                │ │
│  │ QueueModule             │    │  │ │ StorageModule            │ │
│  │ AiModule                │    │  │ └──────────────────────────┘ │
│  │ StorageModule           │    │  └──────────────────────────────┘
│  └─────────────────────────┘    │
└─────────────────────────────────┘
           ↕ PostgreSQL / Redis (공유)
```

**문제점:** 모든 도메인이 직접 임포트로 결합 — 하나의 모듈 변경이 전체 재배포를 요구

---

### 목표 MSA (서비스 경계 분리)

```
                    ┌──────────────────┐
  Client ──────────▶│  API Gateway     │ port 3000
                    │  (Routing + JWT  │
                    │   validation)    │
                    └────────┬─────────┘
                             │ HTTP / gRPC / TCP
              ┌──────────────┼──────────────────┐
              ▼              ▼                  ▼
   ┌──────────────┐  ┌──────────────┐  ┌──────────────────┐
   │   Identity   │  │    Video     │  │  Storage Service │
   │   Service    │  │   Service    │  │  (S3 Abstraction)│
   │  port 3001   │  │  port 3002   │  │  port 3004       │
   │              │  │              │  └──────────────────┘
   │ AuthModule   │  │ VideosModule │
   │ UsersModule  │  │ QueueModule  │         ┌──────────────────┐
   │              │  │ (Processor)  │         │   AI Service     │
   │ DB: users    │  │              │────────▶│  port 3003       │
   └──────────────┘  │ DB: videos   │         │                  │
                     └──────┬───────┘         │ AiModule         │
                            │                 │ (FakeProvider /  │
                            ▼                 │  OpenAI)         │
                    ┌──────────────┐          └──────────────────┘
                    │   Redis      │
                    │ (Queue +     │
                    │  EventBus)   │
                    └──────────────┘
```

---

## 2. 서비스 경계 및 데이터 소유권

### Identity Service (인증 + 사용자)

| 항목 | 내용 |
|------|------|
| **소유 도메인** | 사용자 계정, 자격증명, 역할 |
| **소유 엔티티** | `User` 테이블 |
| **공개 API** | `POST /auth/register`, `POST /auth/login`, `POST /auth/refresh`, `GET /auth/profile` |
| **외부 의존성** | PostgreSQL (users 스키마) |
| **이벤트 발행** | `user.registered`, `user.deleted` |
| **현재 경로** | `src/modules/auth/`, `src/modules/users/` |

### Video Service (영상 + 큐 + 워커)

| 항목 | 내용 |
|------|------|
| **소유 도메인** | 영상 생성 요청, 상태 추적, 결과 관리 |
| **소유 엔티티** | `Video` 테이블 |
| **공개 API** | `POST /videos`, `GET /videos`, `GET /videos/:id`, `GET /videos/:id/result` |
| **외부 의존성** | PostgreSQL (videos 스키마), Redis (BullMQ + 상태 캐시), AI Service, Storage Service |
| **이벤트 발행** | `video.created`, `video.processing.started`, `video.progress.updated`, `video.completed`, `video.failed` |
| **현재 경로** | `src/modules/videos/`, `src/modules/queue/` |

### AI Service (AI 프로바이더 추상화)

| 항목 | 내용 |
|------|------|
| **소유 도메인** | AI 영상 생성 제출 및 폴링, 프롬프트 향상 |
| **공개 API** | gRPC / TCP Message: `generateVideo`, `getGenerationStatus`, `enhancePrompt` |
| **외부 의존성** | OpenAI API, FakeVideoProvider (메모리) |
| **이벤트 발행** | 없음 (동기 요청-응답) |
| **현재 경로** | `src/modules/ai/` |

### Storage Service (S3 추상화)

| 항목 | 내용 |
|------|------|
| **소유 도메인** | 파일 저장소 접근, Presigned URL 생성 |
| **공개 API** | gRPC / TCP Message: `uploadBuffer`, `uploadFromUrl`, `getPresignedDownloadUrl` |
| **외부 의존성** | AWS S3 / MinIO |
| **이벤트 발행** | 없음 (동기 요청-응답) |
| **현재 경로** | `src/modules/storage/` |

---

## 3. 이번 구현: MSA 기반 (Loose Coupling 강화)

### 3.1 서비스 계약 인터페이스 (`src/shared/contracts/`)

서비스 간 결합의 핵심 문제는 **구현 클래스에 직접 의존**하는 것. 이를 해결하기 위해 계약 인터페이스를 분리:

```typescript
// src/shared/contracts/video.contracts.ts
export interface IVideoService {
  findById(id: string): Promise<VideoRecord>;
  updateStatus(id: string, status: VideoStatus, extra?: VideoStatusUpdate): Promise<VideoRecord>;
}

// src/shared/contracts/ai.contracts.ts
export interface IAiService {
  generateVideo(params: GenerateVideoParams, videoId?: string): Promise<GenerateVideoResult>;
  getGenerationStatus(jobId: string): Promise<GenerateVideoResult>;
  enhancePrompt(prompt: string): Promise<string>;
}

// src/shared/contracts/storage.contracts.ts
export interface IStorageService {
  uploadBuffer(buffer: Buffer, key: string, contentType?: string): Promise<string>;
  uploadFromUrl(sourceUrl: string, key: string): Promise<string>;
  getPresignedDownloadUrl(key: string, expiresIn?: number): Promise<string>;
}
```

**효과:** 서비스를 별도 프로세스로 추출할 때 이 인터페이스는 그대로 유지 — 구현만 TCP/gRPC 클라이언트로 교체

### 3.2 도메인 이벤트 시스템 (`src/shared/events/`)

```
서비스 A                 EventEmitter2              서비스 B
 (emit)  ──────────────▶  video.completed  ─────▶  (onEvent)
                            (in-process)
```

```typescript
// 이벤트 목록
VIDEO_EVENTS.CREATED             → VideoCreatedEvent
VIDEO_EVENTS.PROCESSING_STARTED  → VideoProcessingStartedEvent
VIDEO_EVENTS.PROGRESS_UPDATED    → VideoProgressUpdatedEvent
VIDEO_EVENTS.COMPLETED           → VideoCompletedEvent
VIDEO_EVENTS.FAILED              → VideoFailedEvent
```

**MSA 이전 경로:**
- 현재: `EventEmitter2` (인프로세스)
- Phase 2: `Redis Pub/Sub` (프로세스 간)
- Phase 3: `Kafka / NATS` (서비스 간, 내구성 메시지)

이벤트 계약(`VideoCompletedEvent`, `VideoFailedEvent` 등)은 변경 없이 전송 계층만 교체 가능.

### 3.3 Health Check 엔드포인트 (`src/modules/health/`)

```
GET /health  → { status: 'ok', info: { database: { status: 'up' } } }
```

`@nestjs/terminus` 기반, DB pingCheck 포함. Docker healthcheck 버그 수정:

```yaml
# docker-compose.yml (이미 수정됨)
healthcheck:
  test: ['CMD-SHELL', 'wget -qO- http://localhost:3000/health || exit 1']
```

---

## 4. 이벤트 흐름 다이어그램

```
Client
  │
  ▼ POST /videos
VideosService
  ├─ videoRepository.save()
  ├─ videoQueue.add(jobId)
  └─ emit(VIDEO_EVENTS.CREATED)
           │
           └─ [미래: notification service, analytics service 구독 가능]

VideoGenerationProcessor (Worker)
  ├─ transitionStatus(PENDING → PROCESSING)
  ├─ emit(VIDEO_EVENTS.PROCESSING_STARTED)
  │
  ├─ [AI 폴링 루프]
  │   └─ emit(VIDEO_EVENTS.PROGRESS_UPDATED)  ← WebSocket push 가능
  │
  ├─ transitionStatus(PROCESSING → COMPLETED)
  └─ emit(VIDEO_EVENTS.COMPLETED)
           │
           └─ [미래: billing service, CDN 캐시 워밍 구독 가능]
```

---

## 5. MSA 이전 로드맵

### Phase 1 (완료) — 기반 구축

| 작업 | 상태 |
|------|------|
| 서비스 계약 인터페이스 정의 | ✅ |
| 도메인 이벤트 시스템 구현 | ✅ |
| API/Worker 컨테이너 분리 | ✅ (7차) |
| 헬스 엔드포인트 | ✅ |

### Phase 2 — 프로세스 분리

| 작업 | 설명 |
|------|------|
| `@nestjs/microservices` 도입 | TCP/Redis transport |
| AI Service 추출 | 별도 NestJS 앱 + MessagePattern |
| Storage Service 추출 | 별도 NestJS 앱 + MessagePattern |
| EventBus → Redis Pub/Sub | 프로세스 간 이벤트 전달 |

### Phase 3 — 완전한 MSA

| 작업 | 설명 |
|------|------|
| API Gateway 분리 | 인증 + 라우팅 전담 서비스 |
| Identity Service 추출 | 독립 DB 스키마 |
| Video Service 추출 | 독립 DB 스키마 |
| Kafka / NATS 도입 | 내구성 이벤트 스트리밍 |
| Service Mesh (Istio) | 서비스 디스커버리 + 서킷 브레이커 |

---

## 6. 서비스 간 통신 기술 비교

| 방식 | 사용 시점 | NestJS 지원 |
|------|----------|------------|
| **EventEmitter2** (현재) | 인프로세스, 동일 monolith | `@nestjs/event-emitter` |
| **Redis Pub/Sub** | 경량 멀티 인스턴스 이벤트 | `@nestjs/microservices` Redis transport |
| **TCP Transport** | 동기 RPC, 저지연 내부 통신 | `@nestjs/microservices` TCP transport |
| **gRPC** | 타입 안전 동기 RPC, 고성능 | `@nestjs/microservices` gRPC transport |
| **Kafka** | 내구성 이벤트 스트리밍, 재처리 | `@nestjs/microservices` Kafka transport |

---

## 7. 느슨한 결합 원칙

### 구현된 원칙

| 원칙 | 구현 방법 |
|------|----------|
| **인터페이스 의존** | `IVideoService`, `IAiService`, `IStorageService` 계약 |
| **이벤트 기반 통신** | `EventEmitter2` + `VIDEO_EVENTS` 상수 |
| **단방향 의존성** | Worker → Video/AI/Storage (역방향 없음) |
| **도메인 소유권** | 각 도메인이 자신의 엔티티만 소유 |

### 위반 사항 (Phase 2에서 개선)

| 문제 | 현재 상태 | 개선 방향 |
|------|----------|----------|
| VideoProcessor가 VideosService 직접 주입 | 직접 의존 | IVideoService 인터페이스로 추상화 |
| 모든 서비스가 동일 PostgreSQL | 공유 DB | 스키마 분리 → DB 분리 |
| 동기 AI 호출 | 직접 메서드 호출 | MessagePattern (TCP/gRPC) |

---

## 8. 전체 구현 진행 현황

| 단계 | 내용 | 상태 |
|------|------|------|
| 1단계 | NestJS 백엔드 아키텍처 설계 | 완료 |
| 2단계 | REST API 설계 및 구현 | 완료 |
| 3단계 | BullMQ 잡큐 구현 | 완료 |
| 4단계 | AI 워커 서비스 및 시뮬레이션 | 완료 |
| 5단계 | AWS S3 스토리지 통합 | 완료 |
| 6단계 | 잡 상태 시스템 — Redis 일관성 | 완료 |
| 7단계 | 컨테이너 아키텍처 분리 | 완료 |
| **8단계** | **MSA 기반 — 서비스 계약, 도메인 이벤트, 헬스체크** | **완료** |
