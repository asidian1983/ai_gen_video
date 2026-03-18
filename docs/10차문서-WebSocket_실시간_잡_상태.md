# 10차 문서 — WebSocket 실시간 잡 상태

> Socket.IO 기반 실시간 push — 폴링 제거
> 작성일: 2026-03-18

---

## 1. 폴링 vs WebSocket

| | 기존 폴링 | WebSocket |
|--|----------|----------|
| 클라이언트 부하 | 5-10초마다 요청 | 연결 유지 |
| 서버 부하 | DB SELECT 반복 | 이벤트 emit만 |
| 지연 | 최대 10초 | < 100ms |
| 구현 복잡도 | 낮음 | 중간 |

---

## 2. 아키텍처

```
VideoGenerationProcessor
  └─ EventEmitter2.emit('video.progress.updated', event)
                │
                ▼
         VideoGateway (@OnEvent)
                │
                ▼
     Socket.IO Room: video:{videoId}
                │
      ┌─────────┴──────────┐
      ▼                    ▼
  Client A             Client B
(같은 videoId를 구독한 모든 클라이언트)
```

---

## 3. 도메인 이벤트 → WebSocket 브리지

`VideoGateway`는 `@OnEvent(VIDEO_EVENTS.*)` 데코레이터로 `EventEmitter2` 이벤트를 구독하여 Socket.IO room으로 전달합니다. 추가 의존성 없이 8차에서 구현한 도메인 이벤트 시스템을 재활용.

---

## 4. 클라이언트 프로토콜

```javascript
const socket = io('http://localhost:3000/video-status');

// 특정 video 구독
socket.emit('subscribe', { videoId: 'uuid-here' });

// 이벤트 수신
socket.on('video.progress.updated', ({ videoId, percent, message }) => {
  console.log(`${percent}% — ${message}`);
});

socket.on('video.completed', ({ videoId, videoUrl }) => {
  console.log('Done:', videoUrl);
  socket.emit('unsubscribe', { videoId });
});

socket.on('video.failed', ({ videoId, errorMessage }) => {
  console.error('Failed:', errorMessage);
});
```

---

## 5. 서버 이벤트 목록

| 서버 → 클라이언트 | payload |
|-----------------|---------|
| `video.created` | `{ videoId, queueJobId }` |
| `video.processing.started` | `{ videoId, attempt }` |
| `video.progress.updated` | `{ videoId, percent, message }` |
| `video.completed` | `{ videoId, videoUrl, thumbnailUrl }` |
| `video.failed` | `{ videoId, errorMessage, attemptsMade }` |

---

## 6. Room 기반 격리

```
video:uuid-1  →  해당 video 구독자만 수신
video:uuid-2  →  완전히 분리된 room
```

`video:${videoId}` 네이밍으로 사용자 간 크로스 이벤트 없음.

---

## 7. 엔드포인트

- WebSocket: `ws://localhost:3000/video-status`
- Namespace: `/video-status`
