# 11차 문서 — Dead Letter Queue (DLQ) 아키텍처

> 영구 실패 잡 캡처 및 수동 재처리
> 작성일: 2026-03-18

---

## 1. DLQ가 필요한 이유

| | BullMQ 기본 | DLQ 추가 후 |
|--|-------------|------------|
| 영구 실패 잡 | Redis에 500개 보관 후 자동 삭제 | PostgreSQL에 영구 보관 |
| 실패 원인 추적 | failedReason 필드만 | errorMessage + jobData + attemptsMade |
| 수동 재처리 | 불가 (Redis 조작 필요) | POST /queue/failed-jobs/:id/retry |
| 감사 로그 | 없음 | retriedAt, retryJobId 기록 |

---

## 2. 아키텍처

```
VideoGenerationProcessor (3회 재시도 소진)
  └─ EventEmitter2.emit('video.failed', event)
                │
                ▼
         DlqService (@OnEvent)
                │
                ├─ video 조회 (queueJobId 획득)
                ├─ failed_jobs 테이블에 저장
                └─ 로그 기록

관리자 API
  ├─ GET  /queue/failed-jobs          → 목록 조회 (페이지네이션)
  ├─ GET  /queue/failed-jobs/:id      → 단건 조회
  └─ POST /queue/failed-jobs/:id/retry → 재처리
                │
                ▼
         retry 흐름:
           1. videos.status → PENDING 리셋
           2. BullMQ 새 잡 등록 (jobId 발급)
           3. videos.queueJobId 갱신
           4. failed_jobs.retried = true, retriedAt, retryJobId 기록
```

---

## 3. 데이터 스키마 (failed_jobs)

| 컬럼 | 타입 | 설명 |
|------|------|------|
| id | UUID PK | DLQ 레코드 ID |
| videoId | VARCHAR | 실패한 영상 ID |
| queueJobId | VARCHAR | 실패 당시 BullMQ 잡 ID |
| errorMessage | TEXT | 최종 에러 메시지 |
| jobData | JSONB | 재처리에 사용할 잡 데이터 스냅샷 |
| jobName | VARCHAR | BullMQ 잡 이름 (generate) |
| attemptsMade | INT | 총 시도 횟수 |
| retried | BOOLEAN | 수동 재처리 여부 |
| retriedAt | TIMESTAMPTZ | 재처리 요청 시각 |
| retryJobId | VARCHAR | 재처리 시 발급된 새 BullMQ 잡 ID |
| failedAt | TIMESTAMPTZ | 영구 실패 시각 |

---

## 4. API 엔드포인트

### GET /queue/failed-jobs
```
Query: ?page=1&limit=20
Response: {
  items: FailedJobDto[],
  total: number,
  page: number,
  limit: number
}
```

### GET /queue/failed-jobs/:id
단건 DLQ 레코드 조회 (404 on not found)

### POST /queue/failed-jobs/:id/retry
```
Response: {
  id: string,        // DLQ 레코드 UUID
  retryJobId: string, // 새로 등록된 BullMQ 잡 ID
  videoId: string
}

Errors:
  404 - DLQ 레코드 없음
  409 - 이미 재처리됨 (idempotency)
```

---

## 5. 재처리 안전성

- **409 Conflict**: 이미 retried=true인 레코드는 재처리 불가 → 중복 재처리 방지
- **status 리셋**: videos.status → PENDING으로 직접 UPDATE (상태 머신 우회는 관리자 작업이므로 허용)
- **추적 가능성**: retryJobId로 새 잡의 진행 상황을 `/queue/jobs/:jobId`로 추적 가능

---

## 6. 이벤트 연동

DLQ는 8차에서 구현한 도메인 이벤트 시스템을 재활용:

```typescript
@OnEvent(VIDEO_EVENTS.FAILED)
async onVideoFailed(event: VideoFailedEvent): Promise<void> {
  // failed_jobs 테이블에 저장
}
```

추가 의존성 없이 EventEmitter2 브릿지를 통해 프로세서와 DLQ를 완전히 분리.

---

## 7. 변경된 파일

| 파일 | 변경 내용 |
|------|---------|
| `src/modules/queue/entities/failed-job.entity.ts` | 신규 — TypeORM 엔티티 |
| `src/modules/queue/dto/failed-job.dto.ts` | 신규 — API 응답 DTO |
| `src/modules/queue/dlq.service.ts` | 신규 — 이벤트 리스너 + 비즈니스 로직 |
| `src/modules/queue/queue.controller.ts` | 수정 — DLQ 엔드포인트 추가 |
| `src/modules/queue/queue.module.ts` | 수정 — FailedJob 엔티티, DlqService 등록 |
