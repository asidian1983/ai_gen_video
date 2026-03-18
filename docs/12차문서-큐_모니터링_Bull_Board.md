# 12차 문서 — 큐 모니터링 (Bull Board)

> Bull Board UI를 통한 BullMQ 큐 실시간 시각화
> 작성일: 2026-03-18

---

## 1. Bull Board란?

BullMQ 큐의 상태를 웹 UI로 시각화하는 오픈소스 대시보드.

| 기능 | 설명 |
|------|------|
| 잡 목록 | waiting / active / completed / failed / delayed 상태별 조회 |
| 진행률 | 실시간 progress 확인 |
| 잡 재시도 | UI에서 직접 failed 잡 retry |
| 잡 삭제 | 완료/실패 잡 수동 정리 |
| 큐 일시정지 | 큐 pause/resume |

---

## 2. 아키텍처

```
NestJS App
  └─ MonitoringModule
       ├─ BullBoardModule.forRoot({ route: '/admin/queues', adapter: ExpressAdapter })
       └─ BullBoardModule.forFeature({ name: 'video-generation', adapter: BullMQAdapter })

HTTP 요청: GET /admin/queues
  └─ MonitoringAuthMiddleware (Basic Auth)
       └─ Bull Board Express 핸들러 (UI + API)
```

---

## 3. 보안

Bull Board UI는 **HTTP Basic Auth**로 보호:

```
Authorization: Basic base64(user:password)
```

| 환경변수 | 설명 | 기본값 |
|----------|------|--------|
| `MONITORING_USER` | 대시보드 사용자명 | `admin` |
| `MONITORING_PASSWORD` | 대시보드 비밀번호 | `admin` |

> **프로덕션**: 반드시 기본값 변경 필요

---

## 4. 접속 방법

```
http://localhost:3000/admin/queues
```

브라우저 Basic Auth 프롬프트 또는 curl:

```bash
curl -u admin:admin http://localhost:3000/admin/queues
```

---

## 5. 미들웨어 흐름

```
MonitoringAuthMiddleware
  ├─ Authorization 헤더 없음 → 401 + WWW-Authenticate
  ├─ 잘못된 credentials → 401
  └─ 검증 성공 → next() → Bull Board 핸들러
```

`forRoutes({ path: '/admin/queues*', method: ALL })` 로 UI 하위 경로 전체 보호.

---

## 6. 큐 연동

`BullBoardModule.forFeature()`로 `video-generation` 큐를 등록:

```typescript
BullBoardModule.forFeature({
  name: VIDEO_GENERATION_QUEUE,  // 'video-generation'
  adapter: BullMQAdapter,
})
```

큐 추가 시 `BullBoardModule.forFeature()` 블록을 추가하면 됨.

---

## 7. 설정 추가 사항

`src/config/configuration.ts`:
```
app.monitoringUser    ← MONITORING_USER env var
app.monitoringPassword ← MONITORING_PASSWORD env var
```

`.env.example` 추가 권장:
```env
MONITORING_USER=admin
MONITORING_PASSWORD=change-me-in-production
```

---

## 8. 변경된 파일

| 파일 | 변경 내용 |
|------|---------|
| `src/modules/monitoring/monitoring.middleware.ts` | 신규 — Basic Auth 미들웨어 |
| `src/modules/monitoring/monitoring.module.ts` | 신규 — BullBoardModule 설정 |
| `src/config/configuration.ts` | 수정 — monitoringUser/monitoringPassword 추가 |
| `src/app.module.ts` | 수정 — MonitoringModule 임포트 |
