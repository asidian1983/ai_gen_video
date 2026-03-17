# 3차 작업 문서 — AI 영상 생성 플랫폼 BullMQ 잡 큐 구현

> **작성일**: 2026-03-17
> **작업 단계**: 3차 (BullMQ 마이그레이션 및 잡 큐 상태 추적)
> **기준 브랜치**: `feature/rest-api-design`
> **관련 PR**: `feature/bullmq-job-queue` → `main`

---

## 1. 작업 개요

2차에서 구축한 REST API 위에 비동기 잡 처리 레이어를 고도화했다.
유지보수가 중단된 `bull` 라이브러리를 `bullmq`로 전면 교체하고,
스마트 재시도 로직, 진행률 메타데이터 지속 저장, 잡 상태 조회 전용 API를 추가했다.

### 3차 작업 범위 요약

| 분류 | 항목 |
|------|------|
| 패키지 변경 | `@nestjs/bull` + `bull` + `@types/bull` → `@nestjs/bullmq` + `bullmq` |
| 수정 파일 | 9개 (`app.module.ts`, `queue.constants.ts`, `video-generation.processor.ts`, `queue.module.ts`, `videos.service.ts`, `videos.module.ts`, `video.entity.ts`, `video-response.dto.ts`, `video-status-response.dto.ts`) |
| 신규 파일 | 3개 (`queue.controller.ts`, `queue.service.ts`, `dto/job-status.dto.ts`) |
| 신규 API 엔드포인트 | `GET /queue/jobs/:jobId` |
| 잡 상태 추적 | `queueJobId` DB 컬럼 저장, `video.metadata` JSONB에 진행률 기록 |

---

## 2. 핵심 변경 내용

### 2.1 `package.json` — 패키지 교체

| 제거 | 추가 |
|------|------|
| `@nestjs/bull ^10.1.1` | `@nestjs/bullmq ^10.2.3` |
| `bull ^4.12.2` | `bullmq ^5.12.0` |
| `@types/bull ^4.10.0` | _(bullmq는 자체 TypeScript 지원)_ |

**마이그레이션 주의점**: BullMQ는 Bull의 완전 재작성 버전으로 API가 호환되지 않는다.
`@Process()` 데코레이터 패턴이 제거되고 `WorkerHost` 상속 방식으로 대체되었다.

---

### 2.2 `src/app.module.ts` — Redis 연결 설정 변경

```typescript
// Before (Bull)
BullModule.forRootAsync({
  useFactory: (config) => ({
    redis: { host, port, password },
    defaultJobOptions: { attempts: 3, ... },
  }),
})

// After (BullMQ)
BullMQModule.forRootAsync({
  useFactory: (config) => ({
    connection: { host, port, password },  // 키 이름 변경: redis → connection
  }),
})
```

`defaultJobOptions`는 루트 설정에서 제거하고 각 큐의 `registerQueue` 옵션으로 이동했다.

---

### 2.3 `src/modules/queue/constants/queue.constants.ts` — `VideoJobName` 열거형 추가

```typescript
export const VIDEO_GENERATION_QUEUE = 'video-generation';

export enum VideoJobName {
  GENERATE = 'generate',
}

// 하위 호환성 유지
export const VIDEO_GENERATION_JOB = VideoJobName.GENERATE;
```

잡 이름을 문자열 리터럴 대신 열거형으로 관리해 오타를 방지하고
`process()` 메서드의 `switch` 분기를 타입 안전하게 처리한다.

---

### 2.4 `src/modules/videos/entities/video.entity.ts` — `queueJobId` 컬럼 추가

```typescript
@Column({ nullable: true })
queueJobId: string;
```

영상 DB 레코드와 BullMQ 큐 잡을 양방향으로 참조할 수 있도록
잡 생성 직후 `job.id`를 문자열로 변환해 저장한다.

---

### 2.5 `src/modules/queue/processors/video-generation.processor.ts` — WorkerHost 패턴으로 재작성

**클래스 구조 변경**:

```typescript
// Before (Bull)
@Processor(VIDEO_GENERATION_QUEUE)
export class VideoGenerationProcessor {
  @Process(VIDEO_GENERATION_JOB)
  async handleVideoGeneration(job: Job<...>): Promise<void> { ... }
}

// After (BullMQ)
@Processor(VIDEO_GENERATION_QUEUE)
export class VideoGenerationProcessor extends WorkerHost {
  async process(job: Job<...>): Promise<void> {
    switch (job.name) {
      case VideoJobName.GENERATE:
        return this.handleVideoGeneration(job);
    }
  }
}
```

**진행률 업데이트 API 변경**:

```typescript
// Before: job.progress(n)
// After:  job.updateProgress(n)
```

**스마트 재시도 로직**:

```typescript
const isFinalAttempt = job.attemptsMade >= (job.opts.attempts ?? 1) - 1;

// 처리 중 오류 발생 시
if (isFinalAttempt) {
  await this.videosService.updateStatus(videoId, VideoStatus.FAILED, { errorMessage });
}
throw error; // BullMQ가 재시도 처리
```

최종 시도에서만 DB 상태를 `FAILED`로 변경한다.
중간 시도 실패 시에는 `PROCESSING` 상태를 유지해 클라이언트가 폴링을 계속할 수 있도록 한다.

**진행률 메타데이터 기록**:

각 단계마다 `video.metadata` JSONB 컬럼을 업데이트한다:

| 단계 | progressPercent | progressMessage |
|------|:-:|------|
| 시작 | 10 | `Starting generation...` |
| 프롬프트 강화 완료 | 20 | `Prompt enhanced, submitting to AI provider...` |
| AI 잡 제출 완료 | 40 | `Job submitted, waiting for AI provider...` |
| 폴링 중 (최대 30회) | 40–90 | `Rendering... (poll N/30)` |
| 완료 | 100 | `Completed` |

---

### 2.6 `src/modules/queue/queue.module.ts` — defaultJobOptions 이동 및 신규 파일 등록

```typescript
BullMQModule.registerQueue({
  name: VIDEO_GENERATION_QUEUE,
  defaultJobOptions: {
    attempts: 3,                        // 최대 3회 시도
    backoff: { type: 'exponential', delay: 5000 },  // 지수 백오프 (5s, 10s, 20s)
    removeOnComplete: { count: 100 },   // 완료 잡 최대 100개 유지
    removeOnFail: { count: 500 },       // 실패 잡 최대 500개 유지
  },
}),
```

---

### 2.7 `src/modules/videos/videos.service.ts` — queueJobId 저장

```typescript
// Before
await this.videoQueue.add(VIDEO_GENERATION_JOB, { videoId: saved.id });
return saved;

// After
const job = await this.videoQueue.add(VIDEO_GENERATION_JOB, { videoId: saved.id });
await this.videoRepository.update(saved.id, { queueJobId: String(job.id) });
saved.queueJobId = String(job.id);
return saved;
```

`@InjectQueue`, `Queue` 임포트 경로도 `@nestjs/bull` / `bull` → `@nestjs/bullmq` / `bullmq`로 변경.

---

### 2.8 DTO 변경 — `queueJobId` 필드 추가

`VideoResponseDto`와 `VideoStatusResponseDto` 모두 `queueJobId?: string` 필드를 추가했다.
이 값을 이용해 클라이언트가 `GET /queue/jobs/:jobId`를 직접 호출할 수 있다.

---

## 3. 신규 파일 상세

### 3.1 `src/modules/queue/dto/job-status.dto.ts`

```typescript
class JobStatusDto {
  jobId: string;                 // BullMQ job.id (항상 문자열)
  state: string;                 // waiting | active | completed | failed | delayed | unknown
  progress: number;              // 0–100
  attemptsMade: number;          // 현재까지 시도 횟수
  maxAttempts: number;           // 설정된 최대 시도 횟수
  failedReason?: string;         // 마지막 실패 원인
  processedOn?: string;          // ISO 8601 — 워커가 처리 시작한 시각
  finishedOn?: string;           // ISO 8601 — 완료 또는 최종 실패 시각
}
```

---

### 3.2 `src/modules/queue/queue.service.ts`

```typescript
@Injectable()
export class QueueService {
  constructor(@InjectQueue(VIDEO_GENERATION_QUEUE) private readonly queue: Queue) {}

  async getJobStatus(jobId: string): Promise<JobStatusDto>
  // job.getState() → 'waiting' | 'active' | 'completed' | 'failed' | 'delayed' | 'unknown'
  // job.progress가 number가 아닌 경우 0으로 fallback
  // Redis에 잡이 없으면 NotFoundException (removeOnComplete/Fail 초과 시)
}
```

---

### 3.3 `src/modules/queue/queue.controller.ts`

```
GET /api/v1/queue/jobs/:jobId → 200 JobStatusDto
                               → 404 잡 없음 (Redis에서 삭제된 경우)
```

- `@ApiTags('queue')`, `@ApiBearerAuth('access-token')` 적용
- `GET /videos/:id`는 DB 기반 상태를 반환하는 반면, 이 엔드포인트는 BullMQ Redis 상태를 직접 조회
- 운영/디버깅 목적으로 활용

---

## 4. 설계 결정 근거

### 4.1 Bull → BullMQ 교체

`bull`은 2021년 이후 사실상 유지보수가 중단되었다.
`bullmq`는 공식 후속 라이브러리로 TypeScript-first 설계, `WorkerHost` 패턴,
Redis Streams 지원, 더 안정적인 재시도 메커니즘을 제공한다.

### 4.2 스마트 재시도 — 최종 시도에서만 FAILED 기록

중간 시도에서 `FAILED`를 기록하면 클라이언트가 폴링 중 종단 상태를 인식하고 폴링을 멈춘다.
하지만 BullMQ는 내부적으로 재시도를 진행하기 때문에 실제로는 처리 중인 상황이다.
`PROCESSING` 상태를 유지하면 클라이언트 경험에 영향 없이 재시도가 투명하게 처리된다.

### 4.3 진행률 메타데이터를 `video.metadata` JSONB에 저장

`progressPercent`, `progressMessage`, `estimatedSecondsRemaining`, `aiJobId` 등
생성 과정의 임시 데이터를 별도 컬럼으로 추가하지 않고 기존 JSONB 필드를 활용한다.
서버 재시작 시에도 진행률이 DB에 지속되어 클라이언트는 언제든 최신 상태를 확인할 수 있다.

### 4.4 잡 상태 엔드포인트를 별도 분리

`GET /videos/:id`는 DB 기반 상태(장기 보존)를 반환하는 애플리케이션의 정보 소스다.
반면 BullMQ의 내부 상태(`waiting`, `delayed` 등)는 Redis에만 존재하며
`removeOnComplete` 설정으로 일정 시간 후 삭제된다.
이 둘을 분리해 클라이언트는 `GET /videos/:id`를 신뢰할 수 있는 기본 API로 사용하고,
`GET /queue/jobs/:jobId`는 디버깅/운영 목적으로 활용할 수 있다.

### 4.5 Redis 메모리 관리

`removeOnComplete: { count: 100 }` — 완료 잡은 최근 100개만 유지 (결과는 DB에 있으므로 불필요)
`removeOnFail: { count: 500 }` — 실패 잡은 디버깅을 위해 500개까지 유지

---

## 5. 잡 흐름도

### 5.1 전체 처리 흐름

```
POST /api/v1/videos
        │
        ▼
  videosService.createAndQueue()
  ├─ videoRepository.save()         → status: PENDING, queueJobId: null
  ├─ videoQueue.add('generate', { videoId })
  └─ videoRepository.update({ queueJobId: job.id })
        │
        ▼ (BullMQ Worker가 잡 수신)
  @OnWorkerActive → 로그
        │
  handleVideoGeneration(job)
        │
  ├─ updateStatus(PROCESSING, { progressPercent: 10, progressMessage: 'Starting...' })
  │   job.updateProgress(10)
        │
  ├─ aiService.enhancePrompt()
  │   updateStatus(PROCESSING, { progressPercent: 20, ... })
  │   job.updateProgress(20)
        │
  ├─ aiService.generateVideo()
  │   updateStatus(PROCESSING, { progressPercent: 40, aiJobId })
  │   job.updateProgress(40)
        │
  └─ 폴링 루프 (최대 30회 × 10초)
      │   진행률: 40 → 90
      │
      ├─ videoUrl 수신 시 ──► storageService.uploadFromUrl()
      │                      updateStatus(COMPLETED, { videoUrl })
      │                      job.updateProgress(100)
      │                      @OnWorkerCompleted → 로그
      │
      └─ 시간 초과 또는 오류
          │
          isFinalAttempt?
          ├─ YES ──► updateStatus(FAILED, { errorMessage })
          │          throw error
          │          @OnWorkerFailed → 로그
          └─ NO  ──► throw error (BullMQ가 재시도 스케줄링)
                     DB 상태: PROCESSING 유지
```

### 5.2 BullMQ 잡 상태 vs DB VideoStatus 대응표

| BullMQ State | DB VideoStatus | 설명 |
|---|---|---|
| `waiting` | `PENDING` | 큐에 등록됨, 워커 대기 중 |
| `active` | `PROCESSING` | 워커가 처리 중 |
| `completed` | `COMPLETED` | 성공 완료 |
| `failed` (재시도 잔여) | `PROCESSING` | 실패했으나 재시도 예정 |
| `failed` (재시도 소진) | `FAILED` | 최종 실패 |
| `delayed` | `PROCESSING` | 지수 백오프 대기 중 |
| _(삭제됨)_ | `COMPLETED` / `FAILED` | Redis에서 evict, DB 상태가 최종 소스 |

---

## 6. 에러 응답

기존 에러 응답 규격에 아래 항목이 추가된다.

| HTTP 코드 | 발생 엔드포인트 | 원인 |
|-----------|----------------|------|
| `404 Not Found` | `GET /queue/jobs/:jobId` | Redis에 잡이 없음 (이미 evict되었거나 잘못된 ID) |

> **참고**: Redis에서 잡이 삭제된 경우에도 `GET /videos/:id`(DB 기반)는 항상 사용 가능하다.
> 장기 상태 조회는 항상 `GET /videos/:id`를 사용할 것을 권장한다.

---

## 7. 파일 구조 변경 요약

```
src/
├── app.module.ts                             ★ 수정 — BullMQModule.forRootAsync
├── modules/
│   ├── queue/
│   │   ├── constants/
│   │   │   └── queue.constants.ts            ★ 수정 — VideoJobName 열거형 추가
│   │   ├── dto/
│   │   │   └── job-status.dto.ts             ★ 신규 — BullMQ 잡 상태 응답 DTO
│   │   ├── processors/
│   │   │   └── video-generation.processor.ts ★ 수정 — WorkerHost 패턴, 스마트 재시도
│   │   ├── queue.controller.ts               ★ 신규 — GET /queue/jobs/:jobId
│   │   ├── queue.module.ts                   ★ 수정 — BullMQModule, defaultJobOptions
│   │   └── queue.service.ts                  ★ 신규 — getJobStatus()
│   └── videos/
│       ├── dto/
│       │   ├── video-response.dto.ts          ★ 수정 — queueJobId 필드 추가
│       │   └── video-status-response.dto.ts   ★ 수정 — queueJobId 필드 추가
│       ├── entities/
│       │   └── video.entity.ts               ★ 수정 — queueJobId 컬럼 추가
│       ├── videos.module.ts                  ★ 수정 — BullMQModule.registerQueue
│       └── videos.service.ts                 ★ 수정 — InjectQueue from @nestjs/bullmq
package.json                                  ★ 수정 — 패키지 교체

docs/
└── 3차문서-BullMQ_잡큐_구현.md               ★ 신규 (본 문서)
```

---

## 8. 2차 대비 변경점 비교

| 항목 | 2차 완료 시점 | 3차 완료 시점 |
|------|-------------|--------------|
| 큐 라이브러리 | `@nestjs/bull` + `bull` | `@nestjs/bullmq` + `bullmq` |
| Redis 연결 설정 키 | `redis: { host, port }` | `connection: { host, port }` |
| Processor 패턴 | `@Process()` 데코레이터 | `WorkerHost` 상속, `process()` 메서드 |
| 진행률 업데이트 API | `job.progress(n)` | `job.updateProgress(n)` |
| 실패 상태 처리 | 모든 시도에서 `FAILED` 기록 | 최종 시도에서만 `FAILED`, 중간은 `PROCESSING` 유지 |
| 진행률 저장 위치 | 없음 (재시작 시 소실) | `video.metadata` JSONB에 지속 저장 |
| 큐 잡 ID 저장 | 없음 | `video.queueJobId` DB 컬럼 |
| 잡 상태 조회 API | 없음 | `GET /queue/jobs/:jobId` |
| 잡 재시도 설정 위치 | 루트 `defaultJobOptions` | 큐별 `registerQueue.defaultJobOptions` |
| Redis 메모리 관리 | 없음 | `removeOnComplete/Fail count` 제한 |
| 이벤트 훅 | `@OnQueueActive/Completed/Failed` | `@OnWorkerActive/Completed/Failed` |

---

## 9. 다음 작업

- [x] BullMQ 마이그레이션 및 잡 큐 상태 추적 구현 _(본 3차 작업)_
- [ ] **TypeORM 마이그레이션 스크립트** 작성 — `queueJobId` 컬럼 추가 반영 필요
  ```bash
  npm run migration:generate -- -n AddQueueJobIdToVideos
  npm run migration:run
  ```
- [ ] 실제 AI 영상 공급자(RunwayML / Stability AI) 연동 — `aiService.generateVideo()` 구현
- [ ] **Webhook 수신 엔드포인트** 구현 — 폴링 방식 대체
- [ ] 단위 테스트 / E2E 테스트 작성 — `VideoGenerationProcessor`, `QueueService` 포함
- [ ] 인증(Auth) 모듈 고도화 — 소셜 로그인, 이메일 인증
- [ ] CI/CD 파이프라인 구성 (GitHub Actions)
