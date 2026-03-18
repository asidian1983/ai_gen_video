# 9차 문서 — Rate Limiting 전략

> 3단계 Named Throttler + 엔드포인트별 오버라이드
> 작성일: 2026-03-18

---

## 1. 문제: 설정은 있었지만 미적용

기존 코드의 문제:
```typescript
// app.module.ts — 설정만 있고 ThrottlerGuard가 등록되지 않아 실제로 제한 없음
ThrottlerModule.forRootAsync({ useFactory: () => [{ ttl: 60_000, limit: 100 }] })
// APP_GUARD 없음 → 모든 엔드포인트가 무제한
```

---

## 2. 구현: 3단계 Named Throttler

```typescript
ThrottlerModule.forRootAsync({
  useFactory: (config) => [
    { name: 'burst',     ttl: 10_000,    limit: 20    },  // 20 req / 10초
    { name: 'standard',  ttl: 60_000,    limit: 100   },  // 100 req / 1분 (env 설정)
    { name: 'sustained', ttl: 3_600_000, limit: 1_000 },  // 1,000 req / 1시간
  ],
})

// 전역 활성화
{ provide: APP_GUARD, useClass: ThrottlerGuard }
```

---

## 3. 엔드포인트별 제한 정책

| 엔드포인트 | burst | standard | sustained | 이유 |
|-----------|-------|----------|-----------|------|
| 전체 기본값 | 20/10s | 100/1m | 1,000/1h | 일반 API |
| `POST /auth/register` | 2/10s | 5/1h | (기본) | 계정 생성 스팸 방지 |
| `POST /auth/login` | 5/1m | 10/15m | (기본) | Brute-force 방지 |
| `POST /auth/refresh` | (기본) | 20/15m | (기본) | 토큰 플러딩 방지 |
| `POST /videos` | 3/10s | (기본) | 10/1h | AI 연산 비용 제어 |
| `GET /health` | — | — | — | `@SkipThrottle` |

---

## 4. 동작 원리

```
Request → ThrottlerGuard (APP_GUARD)
  │
  ├─ @SkipThrottle? → pass
  ├─ @Throttle({ ... })? → 오버라이드 값 적용
  └─ 기본값 → burst + standard + sustained 모두 체크
           │
           ├─ 모든 tier 통과 → 요청 처리
           └─ 어느 tier라도 초과 → 429 Too Many Requests
```

**모든 tier를 동시에 통과해야 합니다.** 예: `POST /auth/login`은 burst (5/1m) AND standard (10/15m) 둘 다 만족해야 통과.

---

## 5. 응답 헤더

```
X-RateLimit-Limit:     10
X-RateLimit-Remaining: 7
X-RateLimit-Reset:     1710723600
Retry-After:           42          (429일 때만)
```

---

## 6. 멀티 인스턴스 고려사항

현재 구현은 **인메모리 카운터** — 인스턴스별로 독립 집계. 프로덕션 멀티 인스턴스 배포 시:

```bash
npm install @nest-lab/throttler-storage-redis
```

```typescript
ThrottlerModule.forRootAsync({
  useFactory: (config) => ({
    throttlers: [...],
    storage: new ThrottlerStorageRedisService(redisClient),
  }),
})
```

---

## 7. 환경변수

```env
THROTTLE_TTL=60       # standard tier TTL (초)
THROTTLE_LIMIT=100    # standard tier 제한 횟수
```

burst, sustained tier는 하드코딩 (보안 설정은 코드로 관리).
