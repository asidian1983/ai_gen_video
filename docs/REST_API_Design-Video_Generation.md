# REST API Design — AI Video Generation Service

> **Base URL**: `https://api.example.com/api/v1`
> **Auth**: All endpoints require `Authorization: Bearer <access_token>` unless marked Public.
> **Content-Type**: `application/json`
> **Envelope**: Every response is wrapped in `{ "success": true, "data": ..., "timestamp": "..." }`

---

## Table of Contents

1. [Data Models & DTOs](#1-data-models--dtos)
2. [POST /videos — Create Job](#2-post-videos--create-job)
3. [GET /videos/:id — Status Check](#3-get-videosid--status-check)
4. [GET /videos/:id/result — Download](#4-get-videosidresult--download)
5. [Supporting Endpoints](#5-supporting-endpoints)
6. [Error Responses](#6-error-responses)
7. [State Machine & Polling Guide](#7-state-machine--polling-guide)

---

## 1. Data Models & DTOs

### 1.1 VideoStatus Enum

```typescript
enum VideoStatus {
  PENDING     = 'pending'      // Accepted, waiting in queue
  PROCESSING  = 'processing'   // AI provider is generating
  COMPLETED   = 'completed'    // Ready for download
  FAILED      = 'failed'       // Generation failed
  CANCELLED   = 'cancelled'    // Cancelled by user
}
```

### 1.2 CreateVideoDto (Request)

```typescript
class CreateVideoDto {
  title: string          // required | max 255 chars
  prompt: string         // required | max 2000 chars
  negativePrompt?: string  // optional | max 1000 chars
  width?: number         // optional | default 1024 | positive integer
  height?: number        // optional | default 576  | positive integer
  fps?: number           // optional | default 24   | range: 8–60
  model?: string         // optional | AI model identifier
}
```

### 1.3 VideoResponseDto (Full Video Object)

```typescript
class VideoResponseDto {
  id: string                      // UUID
  title: string
  prompt: string
  negativePrompt?: string
  status: VideoStatus
  videoUrl?: string               // Public S3 URL (set when completed)
  thumbnailUrl?: string
  durationSeconds?: number
  errorMessage?: string
  generationParams: {
    width: number
    height: number
    fps: number
    model?: string
  }
  createdAt: string               // ISO 8601
  updatedAt: string
}
```

### 1.4 VideoStatusResponseDto (Status Poll Object)

```typescript
class VideoStatusResponseDto {
  id: string
  status: VideoStatus
  createdAt: string
  updatedAt: string
  resultReady: boolean            // true when GET /result is available
  progress?: {                    // only present when status = 'processing'
    percent: number               // 0–100
    message: string
    estimatedSecondsRemaining?: number
  }
  errorMessage?: string           // only present when status = 'failed'
}
```

### 1.5 VideoResultDto (Download Response)

```typescript
class VideoResultDto {
  videoId: string
  downloadUrl: string             // Pre-signed S3 URL
  thumbnailUrl?: string           // Pre-signed S3 URL
  expiresInSeconds: number        // TTL of the URLs
  expiresAt: string               // ISO 8601 expiry timestamp
  file: {
    contentType: string           // 'video/mp4'
    sizeBytes: number
    durationSeconds: number
    width: number
    height: number
    fps: number
  }
}
```

### 1.6 PaginatedVideosDto (List Response)

```typescript
class PaginatedVideosDto {
  items: VideoResponseDto[]
  meta: {
    total: number
    page: number
    limit: number
    totalPages: number
    hasNextPage: boolean
    hasPreviousPage: boolean
  }
}
```

---

## 2. POST /videos — Create Job

Submits a new AI video generation job. The job is queued immediately and processed asynchronously.

### Request

```
POST /api/v1/videos
Authorization: Bearer eyJhbGciOiJIUzI1NiJ9...
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

#### Minimal Request (only required fields)

```json
{
  "title": "Quick test",
  "prompt": "A red ball bouncing on a white surface"
}
```

### Response `201 Created`

```json
{
  "success": true,
  "data": {
    "id": "550e8400-e29b-41d4-a716-446655440000",
    "title": "Sunset over the ocean",
    "prompt": "A cinematic sunset over calm ocean waves, golden hour lighting, aerial view, 4K ultra HD, slow motion",
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

### Field Validation Rules

| Field | Type | Required | Constraints |
|-------|------|----------|-------------|
| `title` | string | Yes | max 255 chars |
| `prompt` | string | Yes | max 2000 chars, non-empty |
| `negativePrompt` | string | No | max 1000 chars |
| `width` | integer | No | positive, default 1024 |
| `height` | integer | No | positive, default 576 |
| `fps` | integer | No | 8–60, default 24 |
| `model` | string | No | provider-specific identifier |

### Error Responses

#### 400 Bad Request — Validation failure

```json
{
  "success": false,
  "statusCode": 400,
  "message": ["prompt must be shorter than or equal to 2000 characters", "fps must be a number conforming to the specified constraints"],
  "timestamp": "2026-03-17T12:00:00.123Z",
  "path": "/api/v1/videos"
}
```

#### 429 Too Many Requests — Rate limit exceeded

```json
{
  "success": false,
  "statusCode": 429,
  "message": "ThrottlerException: Too Many Requests",
  "timestamp": "2026-03-17T12:00:00.123Z",
  "path": "/api/v1/videos"
}
```

---

## 3. GET /videos/:id — Status Check

Returns the current processing status of a video job.
Poll this endpoint until `status` is `completed` or `failed`.

### Request

```
GET /api/v1/videos/550e8400-e29b-41d4-a716-446655440000
Authorization: Bearer eyJhbGciOiJIUzI1NiJ9...
```

### Response Examples by Status

#### `pending` — In queue, not yet started

```json
{
  "success": true,
  "data": {
    "id": "550e8400-e29b-41d4-a716-446655440000",
    "status": "pending",
    "resultReady": false,
    "createdAt": "2026-03-17T12:00:00.000Z",
    "updatedAt": "2026-03-17T12:00:00.000Z"
  },
  "timestamp": "2026-03-17T12:00:05.000Z"
}
```

#### `processing` — AI provider is generating

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
  },
  "timestamp": "2026-03-17T12:01:10.500Z"
}
```

#### `completed` — Ready for download

```json
{
  "success": true,
  "data": {
    "id": "550e8400-e29b-41d4-a716-446655440000",
    "status": "completed",
    "resultReady": true,
    "createdAt": "2026-03-17T12:00:00.000Z",
    "updatedAt": "2026-03-17T12:02:30.000Z"
  },
  "timestamp": "2026-03-17T12:02:31.000Z"
}
```

#### `failed` — Generation failed

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
  },
  "timestamp": "2026-03-17T12:05:01.000Z"
}
```

### Error Responses

#### 404 Not Found

```json
{
  "statusCode": 404,
  "message": "Video 550e8400-e29b-41d4-a716-446655440000 not found",
  "timestamp": "2026-03-17T12:00:00.000Z",
  "path": "/api/v1/videos/550e8400-e29b-41d4-a716-446655440000"
}
```

#### 403 Forbidden — Accessing another user's video

```json
{
  "statusCode": 403,
  "message": "Forbidden resource",
  "timestamp": "2026-03-17T12:00:00.000Z",
  "path": "/api/v1/videos/550e8400-e29b-41d4-a716-446655440000"
}
```

---

## 4. GET /videos/:id/result — Download

Returns pre-signed S3 URLs to download the completed video and thumbnail.
Call this only after `GET /videos/:id` returns `resultReady: true`.

### Request

```
GET /api/v1/videos/550e8400-e29b-41d4-a716-446655440000/result
Authorization: Bearer eyJhbGciOiJIUzI1NiJ9...
```

#### Optional Query Parameters

| Parameter | Type | Default | Max | Description |
|-----------|------|---------|-----|-------------|
| `expiresIn` | integer | 3600 | 86400 | URL TTL in seconds |

```
GET /api/v1/videos/550e8400-e29b-41d4-a716-446655440000/result?expiresIn=7200
```

### Response `200 OK`

```json
{
  "success": true,
  "data": {
    "videoId": "550e8400-e29b-41d4-a716-446655440000",
    "downloadUrl": "https://ai-gen-video.s3.us-east-1.amazonaws.com/videos/550e8400/output.mp4?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Credential=...&X-Amz-Date=20260317T120000Z&X-Amz-Expires=3600&X-Amz-Signature=abc123...",
    "thumbnailUrl": "https://ai-gen-video.s3.us-east-1.amazonaws.com/videos/550e8400/thumb.jpg?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Credential=...&X-Amz-Date=20260317T120000Z&X-Amz-Expires=3600&X-Amz-Signature=def456...",
    "expiresInSeconds": 3600,
    "expiresAt": "2026-03-17T13:02:30.000Z",
    "file": {
      "contentType": "video/mp4",
      "sizeBytes": 104857600,
      "durationSeconds": 8,
      "width": 1280,
      "height": 720,
      "fps": 30
    }
  },
  "timestamp": "2026-03-17T12:02:35.000Z"
}
```

### Error Responses

#### 409 Conflict — Video not yet completed

```json
{
  "statusCode": 409,
  "message": "Video is not yet completed. Current status: processing",
  "timestamp": "2026-03-17T12:01:00.000Z",
  "path": "/api/v1/videos/550e8400-e29b-41d4-a716-446655440000/result"
}
```

#### Usage Pattern

```typescript
// Client-side polling pattern
async function generateAndDownload(dto: CreateVideoDto): Promise<string> {
  // 1. Submit job
  const { data: video } = await api.post('/videos', dto);
  const videoId = video.id;

  // 2. Poll until done
  while (true) {
    await sleep(5000); // 5 second interval
    const { data: status } = await api.get(`/videos/${videoId}`);

    if (status.status === 'failed') {
      throw new Error(`Generation failed: ${status.errorMessage}`);
    }

    if (status.resultReady) {
      // 3. Fetch download URL
      const { data: result } = await api.get(`/videos/${videoId}/result`);
      return result.downloadUrl;
    }
  }
}
```

---

## 5. Supporting Endpoints

### GET /videos — List my videos

```
GET /api/v1/videos?status=completed&page=1&limit=10
Authorization: Bearer eyJhbGciOiJIUzI1NiJ9...
```

#### Response `200 OK`

```json
{
  "success": true,
  "data": {
    "items": [
      {
        "id": "550e8400-e29b-41d4-a716-446655440000",
        "title": "Sunset over the ocean",
        "prompt": "A cinematic sunset...",
        "status": "completed",
        "videoUrl": "https://ai-gen-video.s3.us-east-1.amazonaws.com/videos/550e8400/output.mp4",
        "thumbnailUrl": "https://ai-gen-video.s3.us-east-1.amazonaws.com/videos/550e8400/thumb.jpg",
        "durationSeconds": 8,
        "generationParams": { "width": 1280, "height": 720, "fps": 30, "model": "runway-gen3" },
        "createdAt": "2026-03-17T12:00:00.000Z",
        "updatedAt": "2026-03-17T12:02:30.000Z"
      }
    ],
    "meta": {
      "total": 42,
      "page": 1,
      "limit": 10,
      "totalPages": 5,
      "hasNextPage": true,
      "hasPreviousPage": false
    }
  },
  "timestamp": "2026-03-17T12:05:00.000Z"
}
```

### PATCH /videos/:id — Update title

```
PATCH /api/v1/videos/550e8400-e29b-41d4-a716-446655440000
Authorization: Bearer eyJhbGciOiJIUzI1NiJ9...
Content-Type: application/json
```

```json
{ "title": "Golden Hour — Ocean View" }
```

Response: `200 OK` with updated `VideoResponseDto`.

### DELETE /videos/:id

```
DELETE /api/v1/videos/550e8400-e29b-41d4-a716-446655440000
Authorization: Bearer eyJhbGciOiJIUzI1NiJ9...
```

Response: `204 No Content`

---

## 6. Error Responses

All errors follow this shape (stripped from the envelope for brevity):

```json
{
  "statusCode": 400,
  "timestamp": "2026-03-17T12:00:00.000Z",
  "path": "/api/v1/videos",
  "method": "POST",
  "message": "Human-readable description or validation error array"
}
```

### HTTP Status Code Reference

| Code | Meaning | When Used |
|------|---------|-----------|
| 200 | OK | Successful GET / PATCH |
| 201 | Created | Job successfully queued |
| 204 | No Content | DELETE successful |
| 400 | Bad Request | Validation failure |
| 401 | Unauthorized | Missing / invalid token |
| 403 | Forbidden | Accessing another user's resource |
| 404 | Not Found | Video ID does not exist |
| 409 | Conflict | Result requested before completion |
| 422 | Unprocessable Entity | Business rule violation |
| 429 | Too Many Requests | Rate limit (100 req / 60s) |
| 500 | Internal Server Error | Unexpected server failure |

---

## 7. State Machine & Polling Guide

### Video Job State Machine

```
                  ┌─────────┐
      POST /videos │ PENDING │ ──────────────────────────┐
                  └────┬────┘                            │
                       │ Queue worker picks up job       │
                       ▼                                 │
               ┌────────────┐                            │
               │ PROCESSING │                            │ (user cancels)
               └─────┬──────┘                            │
              ┌──────┴───────┐                           │
              │              │                           ▼
              ▼              ▼                    ┌───────────┐
        ┌──────────┐   ┌────────┐                │ CANCELLED │
        │COMPLETED │   │ FAILED │                └───────────┘
        └──────────┘   └────────┘
              │
              ▼
   GET /videos/:id/result
   (pre-signed download URL)
```

### Polling Strategy

| Phase | Interval | When to stop |
|-------|----------|-------------|
| First 30s | 3 seconds | status changes from `pending` |
| Next 5 min | 5 seconds | status reaches terminal state |
| After 5 min | 10 seconds | `completed` or `failed` |
| Timeout | — | Give up after 15 minutes |

### Typical Job Timeline

```
T+0s    POST /videos                → 201, status: pending
T+2s    GET /videos/:id             → 200, status: pending
T+8s    GET /videos/:id             → 200, status: processing, progress: 10%
T+30s   GET /videos/:id             → 200, status: processing, progress: 45%
T+75s   GET /videos/:id             → 200, status: processing, progress: 90%
T+90s   GET /videos/:id             → 200, status: completed, resultReady: true
T+91s   GET /videos/:id/result      → 200, downloadUrl: https://...
```

---

## 8. DTO Implementation Files

| DTO | File |
|-----|------|
| `CreateVideoDto` | `src/modules/videos/dto/create-video.dto.ts` |
| `UpdateVideoDto` | `src/modules/videos/dto/update-video.dto.ts` |
| `VideoResponseDto` | `src/modules/videos/dto/video-response.dto.ts` |
| `VideoStatusResponseDto` | `src/modules/videos/dto/video-status-response.dto.ts` |
| `VideoResultDto` | `src/modules/videos/dto/video-result.dto.ts` |
| `PaginatedVideosDto` | `src/modules/videos/dto/paginated-videos.dto.ts` |

All DTOs use `class-validator` decorators and are auto-documented via `@nestjs/swagger`.
Swagger UI is available at `http://localhost:3000/docs` in development.

---

*Document version: 1.0 | Corresponds to backend v1 (branch: feature/nestjs-backend-v1)*
