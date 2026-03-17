# 2차 작업 문서 — AI 영상 생성 플랫폼 REST API 설계 및 구현

> **작성일**: 2026-03-17
> **작업 단계**: 2차 (REST API 설계 및 영상 관련 모듈 고도화)
> **기준 브랜치**: `feature/nestjs-backend-v1`
> **관련 커밋**: `55a46e9`

---

## 1. 작업 개요

1차에서 구축한 NestJS 백엔드 기반 위에 AI 영상 생성 서비스의 핵심 REST API를 설계하고 구현했다.
비동기 영상 생성 흐름(제출 → 상태 폴링 → 결과 다운로드)을 완전히 처리할 수 있도록
컨트롤러·서비스·DTO를 체계적으로 정비했다.

### 2차 작업 범위 요약

| 분류 | 항목 |
|------|------|
| API 엔드포인트 | 핵심 3개 설계 + 기존 엔드포인트 정비 |
| 신규 DTO | 4개 (Response / Status / Result / Paginated) |
| 수정 파일 | `videos.controller.ts`, `videos.service.ts`, `videos.module.ts` |
| 신규 문서 | `REST_API_Design-Video_Generation.md`, 본 2차 문서 |

---

## 2. 설계한 핵심 API

### 2.1 전체 엔드포인트 목록

| 메서드 | 경로 | 설명 |
|--------|------|------|
| **POST** | `/api/v1/videos` | 영상 생성 작업 제출 |
| **GET** | `/api/v1/videos/:id` | 작업 상태 조회 (폴링) |
| **GET** | `/api/v1/videos/:id/result` | 완성 영상 다운로드 URL 발급 |
| GET | `/api/v1/videos` | 내 영상 목록 (페이지네이션) |
| PATCH | `/api/v1/videos/:id` | 영상 제목 수정 |
| DELETE | `/api/v1/videos/:id` | 영상 삭제 |

---

### 2.2 POST /videos — 영상 생성 작업 제출

비동기 AI 영상 생성 잡을 큐에 등록한다.
요청 즉시 `201 Created`와 함께 잡 ID를 반환하고, 실제 생성은 Bull Queue 워커가 처리한다.

#### Request

```http
POST /api/v1/videos
Authorization: Bearer {access_token}
Content-Type: application/json
```

```json
{
  "title": "Sunset over the ocean",
  "prompt": "A cinematic sunset over calm ocean waves, golden hour lighting, aerial view, 4K ultra HD, slow motion",
  "negativePrompt": "blurry, low quality, distorted, watermark, text",
  "width": 1280,
  "height": 720,
  "fps": 30,
  "model": "runway-gen3"
}
```

#### 필수 필드 최소 요청

```json
{
  "title": "Quick test",
  "prompt": "A red ball bouncing on a white surface"
}
```

#### Response `201 Created`

```json
{
  "success": true,
  "data": {
    "id": "550e8400-e29b-41d4-a716-446655440000",
    "title": "Sunset over the ocean",
    "prompt": "A cinematic sunset over calm ocean waves...",
    "negativePrompt": "blurry, low quality, distorted, watermark, text",
    "status": "pending",
    "videoUrl": null,
    "thumbnailUrl": null,
    "durationSeconds": null,
    "errorMessage": null,
    "generationParams": {
      "width": 1280,
      "height": 720,
      "fps": 30,
      "model": "runway-gen3"
    },
    "createdAt": "2026-03-17T12:00:00.000Z",
    "updatedAt": "2026-03-17T12:00:00.000Z"
  },
  "timestamp": "2026-03-17T12:00:00.123Z"
}
```

#### 필드 검증 규칙

| 필드 | 타입 | 필수 여부 | 제약 조건 |
|------|------|-----------|-----------|
| `title` | string | 필수 | 최대 255자 |
| `prompt` | string | 필수 | 최대 2000자, 비어있으면 안 됨 |
| `negativePrompt` | string | 선택 | 최대 1000자 |
| `width` | integer | 선택 | 양수, 기본값 1024 |
| `height` | integer | 선택 | 양수, 기본값 576 |
| `fps` | integer | 선택 | 8~60 범위, 기본값 24 |
| `model` | string | 선택 | AI 공급자 모델 식별자 |

---

### 2.3 GET /videos/:id — 작업 상태 조회

비동기 생성 잡의 현재 상태와 진행률을 반환한다.
`status`가 `completed` 또는 `failed`가 될 때까지 폴링한다.

#### Request

```http
GET /api/v1/videos/550e8400-e29b-41d4-a716-446655440000
Authorization: Bearer {access_token}
```

#### Response 예시 — `pending`

```json
{
  "success": true,
  "data": {
    "id": "550e8400-e29b-41d4-a716-446655440000",
    "status": "pending",
    "resultReady": false,
    "createdAt": "2026-03-17T12:00:00.000Z",
    "updatedAt": "2026-03-17T12:00:00.000Z"
  }
}
```

#### Response 예시 — `processing`

```json
{
  "success": true,
  "data": {
    "id": "550e8400-e29b-41d4-a716-446655440000",
    "status": "processing",
    "resultReady": false,
    "progress": {
      "percent": 65,
      "message": "Rendering frames 1560 / 2400",
      "estimatedSecondsRemaining": 42
    },
    "createdAt": "2026-03-17T12:00:00.000Z",
    "updatedAt": "2026-03-17T12:01:10.000Z"
  }
}
```

#### Response 예시 — `completed`

```json
{
  "success": true,
  "data": {
    "id": "550e8400-e29b-41d4-a716-446655440000",
    "status": "completed",
    "resultReady": true,
    "createdAt": "2026-03-17T12:00:00.000Z",
    "updatedAt": "2026-03-17T12:02:30.000Z"
  }
}
```

#### Response 예시 — `failed`

```json
{
  "success": true,
  "data": {
    "id": "550e8400-e29b-41d4-a716-446655440000",
    "status": "failed",
    "resultReady": false,
    "errorMessage": "AI provider timeout after 300 seconds",
    "createdAt": "2026-03-17T12:00:00.000Z",
    "updatedAt": "2026-03-17T12:05:00.000Z"
  }
}
```

---

### 2.4 GET /videos/:id/result — 다운로드 URL 발급

완성된 영상에 대한 S3 Presigned URL을 반환한다.
`resultReady: true`인 경우에만 유효하며, 그 전에 호출하면 `409 Conflict`를 반환한다.

#### Request

```http
GET /api/v1/videos/550e8400-e29b-41d4-a716-446655440000/result?expiresIn=7200
Authorization: Bearer {access_token}
```

| 쿼리 파라미터 | 타입 | 기본값 | 최대값 | 설명 |
|--------------|------|--------|--------|------|
| `expiresIn` | integer | 3600 | 86400 | URL 유효 시간 (초) |

#### Response `200 OK`

```json
{
  "success": true,
  "data": {
    "videoId": "550e8400-e29b-41d4-a716-446655440000",
    "downloadUrl": "https://ai-gen-video.s3.us-east-1.amazonaws.com/videos/550e8400/output.mp4?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Signature=abc123...",
    "thumbnailUrl": "https://ai-gen-video.s3.us-east-1.amazonaws.com/videos/550e8400/thumb.jpg?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Signature=def456...",
    "expiresInSeconds": 7200,
    "expiresAt": "2026-03-17T14:02:30.000Z",
    "file": {
      "contentType": "video/mp4",
      "sizeBytes": 104857600,
      "durationSeconds": 8,
      "width": 1280,
      "height": 720,
      "fps": 30
    }
  }
}
```

#### Response `409 Conflict` — 아직 완성되지 않은 경우

```json
{
  "statusCode": 409,
  "message": "Video is not yet completed. Current status: processing",
  "timestamp": "2026-03-17T12:01:00.000Z",
  "path": "/api/v1/videos/550e8400/result"
}
```

---

## 3. 신규 DTO 상세

### 3.1 VideoResponseDto

`src/modules/videos/dto/video-response.dto.ts`

영상의 전체 정보를 담는 응답 객체.
`generationParams` 블록으로 생성 파라미터를 묶어서 응답 구조를 정리했다.

```typescript
class VideoGenerationParamsDto {
  width: number
  height: number
  fps: number
  model?: string
}

class VideoResponseDto {
  id: string
  title: string
  prompt: string
  negativePrompt?: string
  status: VideoStatus
  videoUrl?: string
  thumbnailUrl?: string
  durationSeconds?: number
  errorMessage?: string
  generationParams: VideoGenerationParamsDto
  createdAt: Date
  updatedAt: Date

  static from(video: Video): VideoResponseDto  // Entity → DTO 변환 팩토리 메서드
}
```

**설계 포인트**: `static from()` 팩토리 메서드를 사용해 컨트롤러/서비스에서 `.map(VideoResponseDto.from)` 형태로 간결하게 사용 가능.

---

### 3.2 VideoStatusResponseDto

`src/modules/videos/dto/video-status-response.dto.ts`

상태 폴링 전용 경량 응답 DTO.
`resultReady` 플래그로 클라이언트가 `/result` 호출 가능 여부를 명확히 인지할 수 있도록 했다.

```typescript
class VideoProgressDto {
  percent: number                     // 0–100
  message: string                     // ex) "Rendering frames 1560/2400"
  estimatedSecondsRemaining?: number
}

class VideoStatusResponseDto {
  id: string
  status: VideoStatus
  createdAt: Date
  updatedAt: Date
  resultReady: boolean                // status === 'completed'
  progress?: VideoProgressDto         // processing 상태일 때만 포함
  errorMessage?: string               // failed 상태일 때만 포함

  static from(video: Video): VideoStatusResponseDto
}
```

**설계 포인트**: `progress`와 `errorMessage`는 해당 상태일 때만 응답에 포함되어 불필요한 null 필드를 최소화.

---

### 3.3 VideoResultDto

`src/modules/videos/dto/video-result.dto.ts`

다운로드 URL과 파일 메타데이터를 담는 응답 DTO.

```typescript
class VideoFileMetaDto {
  contentType: string       // 'video/mp4'
  sizeBytes: number
  durationSeconds: number
  width: number
  height: number
  fps: number
}

class VideoResultDto {
  videoId: string
  downloadUrl: string       // Presigned S3 URL (영상)
  thumbnailUrl?: string     // Presigned S3 URL (썸네일)
  expiresInSeconds: number
  expiresAt: string         // ISO 8601 만료 시각
  file: VideoFileMetaDto
}
```

**설계 포인트**: `expiresAt` 필드를 통해 클라이언트가 URL 만료 시점을 명확히 파악하고 갱신 로직을 구현할 수 있다.

---

### 3.4 PaginatedVideosDto

`src/modules/videos/dto/paginated-videos.dto.ts`

목록 조회 응답의 표준 페이지네이션 구조.

```typescript
class PaginationMetaDto {
  total: number
  page: number
  limit: number
  totalPages: number
  hasNextPage: boolean
  hasPreviousPage: boolean
}

class PaginatedVideosDto {
  items: VideoResponseDto[]
  meta: PaginationMetaDto
}
```

**설계 포인트**: `hasNextPage` / `hasPreviousPage` 플래그로 클라이언트에서 페이지 이동 버튼 활성화 여부를 계산할 필요 없이 바로 사용 가능.

---

## 4. 수정된 파일 상세

### 4.1 videos.controller.ts

| 변경 내용 | 이전 | 이후 |
|-----------|------|------|
| 생성 엔드포인트 경로 | `POST /videos/generate` | `POST /videos` |
| 반환 타입 명시 | 없음 | `Promise<VideoResponseDto>` |
| 상태 조회 메서드 | `findOne()` — 전체 정보 반환 | `getStatus()` — 상태 전용 DTO 반환 |
| 다운로드 엔드포인트 | 없음 | `GET /videos/:id/result` 추가 |
| Swagger 어노테이션 | 기본 `@ApiResponse` | `@ApiParam`, `@ApiQuery`, 상세 description 포함 |

---

### 4.2 videos.service.ts

#### 추가된 메서드: `getVideoResult()`

```typescript
async getVideoResult(id: string, userId: string, expiresIn: number): Promise<VideoResultDto>
```

처리 로직:
1. `findOneForUser()` 로 소유권 검증
2. `status !== completed` 이면 `409 ConflictException` 발생
3. `expiresIn`을 60초 ~ 86400초 범위로 클램핑
4. `StorageService.getPresignedDownloadUrl()` 호출 (영상 + 썸네일)
5. `VideoResultDto` 조합 후 반환

#### 수정된 메서드: `findAllForUser()`

반환 타입을 `any` → `PaginatedVideosDto`로 변경.
`hasNextPage / hasPreviousPage` 메타 필드 추가.

#### 추가된 유틸: `extractS3Key()`

```typescript
private extractS3Key(url: string): string
```

S3 공개 URL에서 오브젝트 키를 추출하는 private 헬퍼.
Presigned URL 생성 시 URL 전체가 아닌 키만 전달해야 하는 AWS SDK 요구사항 대응.

---

### 4.3 videos.module.ts

`StorageModule`을 `imports`에 추가해 `VideosService`가 `StorageService`를 주입받을 수 있도록 변경.

```typescript
// 변경 전
imports: [TypeOrmModule.forFeature([Video]), BullModule.registerQueue(...)]

// 변경 후
imports: [TypeOrmModule.forFeature([Video]), BullModule.registerQueue(...), StorageModule]
```

---

## 5. 상태 머신 및 폴링 전략

### 5.1 Video 상태 전이 다이어그램

```
POST /videos 호출
       │
       ▼
  ┌─────────┐
  │ PENDING │ ──── (사용자 취소) ────► CANCELLED
  └────┬────┘
       │ Bull Worker 픽업
       ▼
┌────────────┐
│ PROCESSING │ ──── (사용자 취소) ────► CANCELLED
└─────┬──────┘
      │
 ┌────┴─────┐
 ▼          ▼
┌──────────┐  ┌────────┐
│COMPLETED │  │ FAILED │
└────┬─────┘  └────────┘
     │
     ▼
GET /videos/:id/result
(Presigned Download URL 발급)
```

### 5.2 권장 폴링 전략

| 경과 시간 | 폴링 간격 | 설명 |
|-----------|-----------|------|
| 0 ~ 30초 | 3초 | pending → processing 전환 감지 |
| 30초 ~ 5분 | 5초 | 생성 진행 중 모니터링 |
| 5분 이후 | 10초 | 장시간 생성 작업 대응 |
| 15분 초과 | 포기 처리 | 클라이언트 타임아웃 |

### 5.3 일반적인 작업 타임라인

```
T+0s   POST /videos                → 201, status: pending
T+3s   GET /videos/:id             → 200, status: pending
T+8s   GET /videos/:id             → 200, status: processing, progress: 10%
T+30s  GET /videos/:id             → 200, status: processing, progress: 45%
T+75s  GET /videos/:id             → 200, status: processing, progress: 90%
T+90s  GET /videos/:id             → 200, status: completed, resultReady: true
T+91s  GET /videos/:id/result      → 200, downloadUrl: https://...
```

---

## 6. 에러 응답 규격

모든 에러는 아래 형식을 따른다.

```json
{
  "statusCode": 400,
  "timestamp": "2026-03-17T12:00:00.000Z",
  "path": "/api/v1/videos",
  "method": "POST",
  "message": "에러 메시지 또는 검증 오류 배열"
}
```

### HTTP 상태 코드 참조표

| 코드 | 의미 | 발생 상황 |
|------|------|-----------|
| 201 | Created | 잡 성공적으로 큐 등록 |
| 200 | OK | GET 성공 |
| 204 | No Content | DELETE 성공 |
| 400 | Bad Request | DTO 검증 실패 |
| 401 | Unauthorized | 토큰 없음 또는 만료 |
| 403 | Forbidden | 다른 사용자의 리소스 접근 |
| 404 | Not Found | 존재하지 않는 Video ID |
| 409 | Conflict | 완성 전 `/result` 호출 |
| 429 | Too Many Requests | 속도 제한 초과 (100req/60s) |
| 500 | Internal Server Error | 서버 내부 오류 |

---

## 7. 파일 구조 변경 요약

```
src/modules/videos/
├── dto/
│   ├── create-video.dto.ts          (기존 유지)
│   ├── update-video.dto.ts          (기존 유지)
│   ├── video-response.dto.ts        ★ NEW — 전체 영상 응답 DTO
│   ├── video-status-response.dto.ts ★ NEW — 상태 폴링 전용 DTO
│   ├── video-result.dto.ts          ★ NEW — Presigned URL 응답 DTO
│   └── paginated-videos.dto.ts      ★ NEW — 페이지네이션 목록 DTO
├── entities/
│   └── video.entity.ts              (기존 유지)
├── enums/
│   └── video-status.enum.ts         (기존 유지)
├── videos.controller.ts             ★ MODIFIED — 엔드포인트 정비 + Swagger 고도화
├── videos.service.ts                ★ MODIFIED — getVideoResult() 추가
└── videos.module.ts                 ★ MODIFIED — StorageModule import 추가

docs/
├── 1차문서-NestJS_백엔드_아키텍처_설계.md       (1차 작업)
├── REST_API_Design-Video_Generation.md         (영문 API 스펙 문서)
└── 2차문서-REST_API_설계_및_구현.md            ★ NEW (본 문서)
```

---

## 8. 1차 대비 변경점 비교

| 항목 | 1차 완료 시점 | 2차 완료 시점 |
|------|--------------|--------------|
| 생성 API 경로 | `POST /videos/generate` | `POST /videos` (RESTful 표준 정렬) |
| 상태 조회 응답 | 전체 Video Entity | 상태 전용 DTO (`resultReady`, `progress` 포함) |
| 다운로드 기능 | 없음 | `GET /videos/:id/result` — Presigned URL 발급 |
| 반환 타입 안전성 | 타입 미지정 (`any`) | 모든 엔드포인트 명시적 반환 타입 |
| 페이지네이션 메타 | `{ items, total, page, limit, totalPages }` | `hasNextPage / hasPreviousPage` 추가 |
| Swagger 문서 품질 | 기본 수준 | `@ApiParam`, `@ApiQuery`, 상세 description |

---

## 9. 다음 작업 (3차 예정)

- [ ] 인증(Auth) 모듈 엔드포인트 고도화 (소셜 로그인, 이메일 인증)
- [ ] TypeORM 마이그레이션 스크립트 작성 (`npm run migration:generate`)
- [ ] 실제 AI 영상 공급자(RunwayML / Stability AI) 연동
- [ ] Webhook 수신 엔드포인트 구현 (폴링 방식 대체)
- [ ] 영상 썸네일 자동 생성 (FFmpeg 또는 공급자 API)
- [ ] 사용자별 크레딧 시스템 및 사용량 제한
- [ ] 단위 테스트 / E2E 테스트 작성
- [ ] CI/CD 파이프라인 구성 (GitHub Actions)

---

*이 문서는 2차 REST API 설계 및 구현 완료 시점의 스냅샷입니다.*
*관련 영문 API 스펙 상세: `docs/REST_API_Design-Video_Generation.md`*
