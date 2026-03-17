# 4차 작업 문서 — AI 영상 생성 플랫폼 워커 서비스 및 영상 생성 시뮬레이션

> **작성일**: 2026-03-17
> **작업 단계**: 4차 (BullMQ 워커 서비스 구현 및 AI 영상 생성 시뮬레이션)
> **기준 브랜치**: `main` (3차 머지 이후)
> **관련 PR**: `feature/worker-simulation` → `main`

---

## 1. 작업 개요

3차에서 구축한 BullMQ 큐 시스템 위에 실제로 동작하는 워커 서비스를 구현했다.
실제 AI 영상 공급자(RunwayML 등)가 연동되기 전까지 개발·테스트 환경에서 완전한
엔드투엔드 흐름을 검증할 수 있도록 `FakeVideoProvider`를 도입했다.

비동기 처리 파이프라인이 완전히 동작한다:
- 잡 제출 → 비동기 시뮬레이션(딜레이) → 진행률 업데이트 → 가짜 영상 URL 반환 → 완료

### 4차 작업 범위 요약

| 분류 | 항목 |
|------|------|
| 신규 파일 | `src/modules/ai/providers/fake-video.provider.ts` |
| 수정 파일 | `ai-provider.interface.ts`, `ai.service.ts`, `ai.module.ts`, `video-generation.processor.ts` |
| 핵심 기능 | 인메모리 상태 추적, 비동기 딜레이, 단계별 진행률, 가짜 영상 URL |
| 설계 변경 | `GenerateVideoResult`에 `alreadyStored` 플래그 추가 |

---

## 2. 핵심 변경 내용

### 2.1 `src/modules/ai/interfaces/ai-provider.interface.ts` — `alreadyStored` 플래그 추가

```typescript
export interface GenerateVideoResult {
  jobId: string;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  videoUrl?: string;
  thumbnailUrl?: string;
  errorMessage?: string;
  estimatedDurationMs?: number;
  alreadyStored?: boolean; // NEW: true이면 Processor가 S3 재업로드를 건너뜀
}
```

`FakeVideoProvider`는 이미 "저장된 것처럼" 가짜 URL을 생성한다.
`alreadyStored: true`를 설정하면 `VideoGenerationProcessor`가
`storageService.uploadFromUrl()` 호출을 건너뛰고 해당 URL을 그대로 사용한다.

---

### 2.2 `src/modules/ai/providers/fake-video.provider.ts` — 신규 (시뮬레이터 핵심)

```typescript
interface FakeJobState {
  videoId: string;
  params: GenerateVideoParams;
  startedAt: number;         // Date.now()
  completionDelayMs: number; // 완료까지 걸리는 시간
}

@Injectable()
export class FakeVideoProvider {
  private readonly jobs = new Map<string, FakeJobState>();
  private readonly DELAY_MS = 5_000; // 기본 5초 (설정 가능)

  submit(videoId: string, params: GenerateVideoParams): GenerateVideoResult
  checkStatus(jobId: string): GenerateVideoResult
}
```

**진행률 계산**:

| 경과 시간 비율 | 반환 상태 | 설명 |
|:-:|---|---|
| < 50% | `processing` | `videoUrl: undefined` — 아직 렌더링 중 |
| ≥ 50% | `processing` | `videoUrl: undefined` — 렌더링 후반부 |
| ≥ 100% | `completed` | `videoUrl: <가짜 URL>`, `alreadyStored: true` |

**가짜 영상 URL 패턴**:
```
https://fake-cdn.example.com/videos/{videoId}/output.mp4
https://fake-cdn.example.com/videos/{videoId}/thumb.jpg
```

---

### 2.3 `src/modules/ai/ai.service.ts` — FakeVideoProvider 주입

```typescript
// Before
async generateVideo(params): Promise<GenerateVideoResult> {
  return { jobId: `mock-job-${Date.now()}`, status: 'processing', estimatedDurationMs: 60000 };
}
async getGenerationStatus(jobId): Promise<GenerateVideoResult> {
  return { jobId, status: 'completed', videoUrl: undefined }; // ← videoUrl이 항상 undefined → 폴링 루프 무한 반복
}

// After
constructor(
  private readonly configService: ConfigService,
  private readonly fakeVideoProvider: FakeVideoProvider,
) {}

async generateVideo(params, videoId): Promise<GenerateVideoResult> {
  return this.fakeVideoProvider.submit(videoId, params);
}
async getGenerationStatus(jobId): Promise<GenerateVideoResult> {
  return this.fakeVideoProvider.checkStatus(jobId);
}
```

**3차 버그 수정**: 기존 `getGenerationStatus()`는 `videoUrl: undefined`를 반환해
Processor의 폴링 루프가 30회를 모두 소진한 후 오류로 종료되었다.
`FakeVideoProvider`가 지정된 딜레이 후 실제 `videoUrl`을 반환하도록 수정했다.

---

### 2.4 `src/modules/ai/ai.module.ts` — FakeVideoProvider 등록

```typescript
@Module({
  providers: [AiService, FakeVideoProvider],
  exports: [AiService],
})
export class AiModule {}
```

---

### 2.5 `src/modules/queue/processors/video-generation.processor.ts` — alreadyStored 처리

```typescript
// Before
if (result.videoUrl) {
  const storedUrl = await this.storageService.uploadFromUrl(
    result.videoUrl,
    `videos/${videoId}/output.mp4`,
  );
  ...
}

// After
if (result.videoUrl) {
  const storedUrl = result.alreadyStored
    ? result.videoUrl  // 이미 저장된 URL (시뮬레이터 또는 프로바이더가 직접 업로드한 경우)
    : await this.storageService.uploadFromUrl(result.videoUrl, `videos/${videoId}/output.mp4`);
  ...
}
```

`generateVideo()` 메서드 시그니처에 `videoId` 파라미터도 추가:
```typescript
// GenerateVideoParams에 videoId 포함하거나 별도 파라미터로 전달
await this.aiService.generateVideo({ ...params }, videoId);
```

---

## 3. 신규 파일 상세 — `FakeVideoProvider`

### 전체 처리 흐름

```
processor.handleVideoGeneration(job)
        │
        ▼
  aiService.generateVideo(params, videoId)
        │
  fakeVideoProvider.submit(videoId, params)
        │  → jobs.set(jobId, { videoId, params, startedAt: Date.now(), completionDelayMs: 5000 })
        │  → return { jobId: 'fake-{uuid}', status: 'processing', estimatedDurationMs: 5000 }
        │
  processor 폴링 루프 (10초마다)
        │
  aiService.getGenerationStatus(jobId)
        │
  fakeVideoProvider.checkStatus(jobId)
        │  elapsed = Date.now() - startedAt
        │
        ├─ elapsed < delay  →  { status: 'processing', videoUrl: undefined }
        │                        폴링 계속
        │
        └─ elapsed >= delay →  { status: 'completed',
                                  videoUrl: 'https://fake-cdn.example.com/videos/{videoId}/output.mp4',
                                  thumbnailUrl: 'https://fake-cdn.example.com/videos/{videoId}/thumb.jpg',
                                  alreadyStored: true }
                                  폴링 루프 종료
                                  processor가 COMPLETED 처리
```

### 타입 정의

```typescript
export interface FakeJobState {
  videoId: string;
  params: GenerateVideoParams;
  startedAt: number;
  completionDelayMs: number;
}
```

### 주요 메서드

| 메서드 | 설명 |
|--------|------|
| `submit(videoId, params)` | 인메모리 잡 등록, 즉시 `processing` 반환 |
| `checkStatus(jobId)` | 경과 시간 계산, 완료 여부 판단 후 상태 반환 |
| `generateFakeUrl(videoId)` | `https://fake-cdn.example.com/videos/{videoId}/output.mp4` |
| `generateFakeThumbnailUrl(videoId)` | `https://fake-cdn.example.com/videos/{videoId}/thumb.jpg` |

---

## 4. 설계 결정 근거

### 4.1 별도 `FakeVideoProvider` 서비스로 분리

`AiService`에 시뮬레이션 코드를 직접 삽입하면 실제 공급자 연동 시 코드 정리가 복잡해진다.
`FakeVideoProvider`를 독립 서비스로 분리하면:
- `AiService`는 의존성만 교체하면 실제 공급자로 전환 가능
- 단위 테스트에서 `FakeVideoProvider`를 mock으로 교체 가능
- 나중에 전략 패턴(`IAiProvider` 인터페이스)으로 확장 용이

### 4.2 `alreadyStored` 플래그로 Processor 분기

`FakeVideoProvider`가 반환하는 URL은 실제 파일이 없는 가짜 URL이므로
`StorageService.uploadFromUrl()`이 다운로드를 시도하면 실패한다.
조건부 플래그로 S3 업로드 단계를 건너뛰면:
- 개발 환경에서 S3 없이 전체 흐름 테스트 가능
- 실제 공급자가 자체 CDN에 직접 업로드하는 경우에도 재사용 가능한 패턴

### 4.3 인메모리 상태 대신 타이머 계산 방식

```typescript
const elapsed = Date.now() - state.startedAt;
const isComplete = elapsed >= state.completionDelayMs;
```

`setTimeout`으로 상태를 변경하는 방식 대신 **조회 시점에 경과 시간을 계산**하는 방식을 선택했다.
- 서버 재시작 시 타이머가 사라지는 문제 없음 (물론 인메모리 Map 자체는 사라지지만, 재시작 시 새 잡으로 재처리됨)
- 테스트에서 `Date.now()`를 mocking하면 시간 진행을 제어 가능
- 코드가 단순하고 부작용 없음

### 4.4 `generateVideo()`에 `videoId` 파라미터 전달

가짜 URL 생성 시 `videoId`가 포함되어야 영상별로 고유한 URL을 만들 수 있다.
`GenerateVideoParams`에 `videoId`를 포함하거나 별도 파라미터로 전달하는 두 가지 방법 중
`GenerateVideoParams`를 확장해 `videoId?`를 추가하는 방식을 선택했다.
기존 `IAiProvider` 인터페이스와 호환성을 유지하면서 선택적 파라미터로 추가할 수 있기 때문이다.

---

## 5. 엔드투엔드 흐름 (시뮬레이션 모드)

```
1. POST /api/v1/videos
   ├─ videosService.createAndQueue()
   ├─ BullMQ에 잡 등록 (queueJobId 저장)
   └─ 응답: { id, status: 'pending', queueJobId }

2. BullMQ Worker (VideoGenerationProcessor) 잡 수신
   ├─ status → PROCESSING (10%)
   ├─ aiService.enhancePrompt() → GPT-4o 또는 원본 반환
   ├─ aiService.generateVideo(params, videoId)
   │   └─ fakeVideoProvider.submit() → 5초 타이머 시작
   ├─ status → PROCESSING (40%, aiJobId 기록)
   └─ 폴링 루프 (10초마다)
       ├─ t=10s: elapsed=10s > delay=5s
       │   fakeVideoProvider.checkStatus() → completed + fakeUrl
       ├─ processor: alreadyStored=true → S3 업로드 스킵
       ├─ videosService.updateStatus(COMPLETED, videoUrl)
       └─ status → COMPLETED (100%)

3. GET /api/v1/videos/:id
   └─ 응답: { status: 'completed', resultReady: true }

4. GET /api/v1/videos/:id/result
   └─ 응답: { downloadUrl: 'presigned-url...', thumbnailUrl: '...' }
   ※ 시뮬레이션 모드: storageService.getPresignedDownloadUrl()이 가짜 URL을 그대로 반환
```

---

## 6. 시뮬레이션 딜레이 설정

`FakeVideoProvider`의 딜레이는 환경 변수로 조정 가능:

```env
# .env
AI_SIMULATION_DELAY_MS=5000   # 기본값: 5초
```

| 환경 | 권장 딜레이 | 용도 |
|------|:-:|------|
| 단위 테스트 | `100` | 빠른 테스트 실행 |
| 로컬 개발 | `3000` | 빠른 피드백 |
| E2E 테스트 | `5000` | 실제 흐름과 유사 |
| 스테이징 | _실제 공급자_ | 실제 AI 공급자 사용 |

---

## 7. 파일 구조 변경 요약

```
src/
├── modules/
│   ├── ai/
│   │   ├── interfaces/
│   │   │   └── ai-provider.interface.ts   ★ 수정 — alreadyStored 필드 추가
│   │   ├── providers/
│   │   │   ├── fake-video.provider.ts     ★ 신규 — 영상 생성 시뮬레이터
│   │   │   └── openai.provider.ts         (변경 없음)
│   │   ├── ai.module.ts                   ★ 수정 — FakeVideoProvider 등록
│   │   └── ai.service.ts                  ★ 수정 — FakeVideoProvider 주입, videoId 전달
│   └── queue/
│       └── processors/
│           └── video-generation.processor.ts  ★ 수정 — alreadyStored 분기 처리

docs/
└── 4차문서-워커_서비스_및_AI_영상_생성_시뮬레이션.md  ★ 신규 (본 문서)
```

---

## 8. 3차 대비 변경점 비교

| 항목 | 3차 완료 시점 | 4차 완료 시점 |
|------|-------------|--------------|
| `generateVideo()` 반환값 | `{ jobId, status: 'processing' }` — videoUrl 없음 | 동일 (시뮬레이터 등록 + 타이머 시작) |
| `getGenerationStatus()` | 항상 `{ status: 'completed', videoUrl: undefined }` ← **버그** | 경과 시간에 따라 `processing` 또는 `completed + fakeUrl` 반환 |
| S3 업로드 | 항상 `storageService.uploadFromUrl()` 호출 | `alreadyStored: true`이면 스킵 |
| 개발 환경 테스트 | S3 / 실제 공급자 없이는 FAILED로 끝남 | S3 없이 COMPLETED까지 완전한 흐름 가능 |
| 시뮬레이션 딜레이 | 없음 (즉시 완료 → 버그로 미작동) | `AI_SIMULATION_DELAY_MS` 환경변수로 설정 |
| `AiService` 의존성 | `ConfigService`만 | `ConfigService` + `FakeVideoProvider` |

---

## 9. 다음 작업

- [x] BullMQ 워커 서비스 구현 _(본 4차 작업)_
- [x] 영상 생성 시뮬레이션 (`FakeVideoProvider`) _(본 4차 작업)_
- [ ] **실제 AI 영상 공급자 연동** — RunwayML / Stability AI API 클라이언트 구현
  - `FakeVideoProvider`를 `IAiProvider` 인터페이스 기반 실제 공급자로 교체
- [ ] **TypeORM 마이그레이션** — `queueJobId` 컬럼 추가 반영
  ```bash
  npm run migration:generate -- -n AddQueueJobIdToVideos
  npm run migration:run
  ```
- [ ] Webhook 수신 엔드포인트 — AI 공급자가 완료 시 push 방식으로 알리는 경우
- [ ] 단위 테스트 작성 — `FakeVideoProvider`, `VideoGenerationProcessor` 테스트
- [ ] 인증(Auth) 모듈 고도화
