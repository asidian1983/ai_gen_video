# 6차 문서 — 잡 상태 시스템: Redis 일관성 및 확장성 설계

> Race condition · Idempotency · Consistency 문제 해결
> 작성일: 2026-03-18

---

## 1. 문제 진단

### 기존 구조의 한계

```
VideoGenerationProcessor
  └─ videosService.updateStatus(videoId, status, extra)
       └─ videoRepository.update(id, { status, ...extra })
```

| 문제 | 현상 |
|------|------|
| **Race condition** | BullMQ가 동일 job을 두 번 dispatch하거나 재시도 도중 이전 attempt와 새 attempt가 겹칠 때 두 워커가 동시에 `UPDATE videos SET status=...`를 실행 |
| **Idempotency 없음** | 같은 progress update가 두 번 실행되면 덮어쓰기 → 순서 보장 없음 |
| **종료 상태 오염** | COMPLETED 전환 후 지연된 progress update가 도착해서 `status=COMPLETED`를 `metadata.progressPercent=45`로 덮을 수 있음 |
| **DB 부하** | 클라이언트가 5~10초마다 폴링 → 동시 사용자 증가 시 DB SELECT 급증 |

---

## 2. 해결 전략

### 핵심 원칙 3가지

| 원칙 | 구현 방법 |
|------|----------|
| **Optimistic Locking** | `UPDATE ... WHERE id = ? AND status = ?` — 예상 상태가 맞을 때만 전환 |
| **State Machine** | 허용된 전환만 실행, 나머지는 조용히 거부 |
| **Redis Cache** | 읽기는 Redis 우선, Miss 시 DB fallback + 캐시 backfill |

---

## 3. 아키텍처

```
VideoGenerationProcessor
       │
       ▼
 JobStatusService
  ├─ transitionStatus()   ─── WHERE status = expectedStatus ──▶ PostgreSQL
  ├─ updateProgress()     ─── WHERE status = 'processing'   ──▶ PostgreSQL
  ├─ markFailed()         ─── unconditional UPDATE           ──▶ PostgreSQL
  └─ getCachedStatus()    ─── Redis GET → DB fallback        ──▶ Redis / PostgreSQL

Redis Cache: video:status:{videoId}  TTL=300s
```

---

## 4. 신규 파일 목록

```
src/modules/queue/
├── redis.provider.ts          # ioredis 클라이언트 DI 프로바이더 (신규)
├── job-status.service.ts      # 상태 전환 · 캐시 · 잠금 서비스 (신규)
├── queue.module.ts            # RedisProvider + JobStatusService 등록 (수정)
└── processors/
    └── video-generation.processor.ts  # JobStatusService 사용으로 전환 (수정)
```

---

## 5. 상태 머신 (State Machine)

```
         ┌──────────────────────────────────────┐
         │                                      │
  PENDING ──► PROCESSING ──────────────► COMPLETED
      │            │
      │            └──► PROCESSING (재시도 재진입)
      │                       │
      └────────────────────► FAILED
```

**유효 전환 테이블:**

| From | To | 조건 |
|------|-----|------|
| PENDING | PROCESSING | 최초 시작 |
| PROCESSING | PROCESSING | 재시도 재진입 (retry restart) |
| PROCESSING | COMPLETED | AI 결과 수신 + S3 업로드 완료 |
| PROCESSING | FAILED | 최종 실패 (final attempt) |
| PENDING | FAILED | 첫 전환 전 즉시 실패 |

**무효 전환 (자동 거부):**
- COMPLETED → 어떤 상태든
- FAILED → 어떤 상태든
- PENDING → COMPLETED (직접 건너뜀)

---

## 6. Race Condition 해결

### 문제 시나리오

```
[Worker A - Attempt 1]       [Worker B - Attempt 2 (중복)]
   UPDATE SET status='processing'
                                  UPDATE SET status='processing'
   ... 처리 중 ...
                                  UPDATE SET status='completed'   ← 잘못된 완료
   UPDATE SET status='completed'  ← 이미 completed이므로 충돌
```

### 해결: Optimistic Locking

```typescript
const result = await this.videoRepository
  .createQueryBuilder()
  .update(Video)
  .set({ status: newStatus, ...fields })
  .where('id = :id AND status = :expectedStatus', { id: videoId, expectedStatus })
  .execute();

if (result.affected === 0) {
  // 다른 워커가 이미 상태를 바꿔버렸음 → 이 업데이트는 무시
  this.logger.warn('Optimistic lock miss — transition skipped');
  return false;
}
```

**동작 원리:**
- PostgreSQL `UPDATE WHERE` 는 row-level lock을 자동으로 획득
- 두 워커가 동시에 같은 WHERE를 실행 → 한 쪽만 `affected=1`, 나머지는 `affected=0`
- `affected=0`을 받은 워커는 즉시 종료 (데이터 손상 없음)

---

## 7. Idempotency 보장

### Progress Update Guard

```typescript
// WHERE status = 'processing' 조건으로 guard
await this.videoRepository
  .createQueryBuilder()
  .update(Video)
  .set({ metadata })
  .where('id = :id AND status = :status', { id: videoId, status: VideoStatus.PROCESSING })
  .execute();
```

**효과:**
1. COMPLETED / FAILED 상태의 video에 지연 도착한 progress update → WHERE 조건 불일치로 자동 무시
2. 동일한 progress update가 두 번 실행되어도 덮어쓸 뿐, 일관성 파괴 없음 (last-writer-wins, acceptable)

### markFailed — 조건 없는 강제 종료

```typescript
// 최종 실패는 무조건 FAILED로 확정
async markFailed(videoId: string, errorMessage: string): Promise<void> {
  await this.videoRepository.update(videoId, {
    status: VideoStatus.FAILED,
    errorMessage,
    metadata: { progressPercent: 0, progressMessage: 'Failed' },
  });
  await this.evictCache(videoId);
}
```

**이유:** BullMQ 최종 attempt에서는 재시도가 없으므로 경쟁 조건 자체가 발생하지 않음. Optimistic lock 불필요.

---

## 8. Redis 캐시 설계

### 캐시 키 구조

```
video:status:{videoId}  →  TTL 300초 (5분)

값 (JSON):
{
  "status": "processing",
  "progress": 65,
  "message": "Rendering... (poll 13/30)",
  "updatedAt": "2026-03-18T09:00:00.000Z"
}
```

### 읽기 전략 (Cache-Aside)

```
getCachedStatus(videoId)
  │
  ├─ Redis GET hit?  ──► return cached value         (< 1ms)
  │
  └─ Redis miss / error
       │
       └─ DB SELECT (status, metadata)
            │
            ├─ Redis SET (backfill, TTL=300s)
            └─ return snapshot
```

### 쓰기 전략 (Write-Behind)

```
transitionStatus() / updateProgress()
  │
  ├─ 1. DB UPDATE (동기, 필수)
  └─ 2. Redis SET  (비동기, fire-and-forget)
         └─ 실패해도 에러 로그만 기록, DB가 source of truth
```

**장점:**
- Redis 장애 시 자동 DB fallback → 서비스 중단 없음
- 캐시 TTL 만료 후 자연 eviction → stale data 최대 5분
- 상태 전환 시 즉시 캐시 갱신 → 대부분 최신 값 제공

---

## 9. 프로세서 변경 전/후

### 이전 (문제 있음)

```typescript
// 상태 검증 없이 직접 update
await this.videosService.updateStatus(videoId, VideoStatus.PROCESSING, {
  metadata: { progressPercent: 10, ... },
});
```

### 이후 (안전)

```typescript
// 첫 번째 전환: 현재 상태를 읽어서 expectedStatus로 사용
const video = await this.videosService.findById(videoId);
const started = await this.jobStatusService.transitionStatus(
  videoId,
  video.status,          // PENDING (최초) 또는 PROCESSING (재시도)
  VideoStatus.PROCESSING,
  { metadata: { progressPercent: 10, progressMessage: 'Starting...' } },
);
if (!started) return; // 다른 워커가 이미 처리 중 — 중복 실행 방지

// 진행률 업데이트: status 전환 없음, PROCESSING guard 적용
await this.jobStatusService.updateProgress(videoId, 20, 'Prompt enhanced...');

// 완료 전환: PROCESSING → COMPLETED optimistic lock
await this.jobStatusService.transitionStatus(
  videoId, VideoStatus.PROCESSING, VideoStatus.COMPLETED,
  { videoUrl, thumbnailUrl, metadata: { progressPercent: 100, ... } },
);

// 최종 실패: 조건 없이 강제 확정
await this.jobStatusService.markFailed(videoId, errorMessage);
```

---

## 10. 확장성 고려사항

### 현재 제약과 개선 방향

| 항목 | 현재 | 향후 확장 |
|------|------|----------|
| 상태 읽기 | Redis cache-aside | Redis Cluster 샤딩 |
| 진행률 push | 없음 (폴링) | Redis Pub/Sub → SSE / WebSocket |
| 워커 수평 확장 | BullMQ 자동 분산 | 멀티 인스턴스 안전 (optimistic lock으로 보장) |
| 캐시 일관성 | TTL 기반 자연 만료 | Event-driven invalidation (Redis keyspace) |
| 분산 락 | 불필요 (DB optimistic lock으로 충분) | Redlock (초고빈도 전환 시) |

### 수평 확장 시 안전성

```
Instance A (Worker)         Instance B (Worker)
      │                           │
      │  UPDATE WHERE status=...  │
      │                           │
      └─────── PostgreSQL ────────┘
                    │
              Row-level lock
              한 쪽만 affected=1
```

여러 인스턴스가 동시에 같은 video를 처리하려 해도 DB optimistic lock이 단 하나의 전환만 허용.

---

## 11. 구현 진행 현황

| 단계 | 내용 | 상태 |
|------|------|------|
| 1단계 | NestJS 백엔드 아키텍처 설계 | 완료 |
| 2단계 | REST API 설계 및 구현 | 완료 |
| 3단계 | BullMQ 잡큐 구현 | 완료 |
| 4단계 | AI 워커 서비스 및 시뮬레이션 | 완료 |
| 5단계 | AWS S3 스토리지 통합 | 완료 |
| **6단계** | **잡 상태 시스템 — Redis 일관성 · Race condition · Idempotency** | **완료** |
