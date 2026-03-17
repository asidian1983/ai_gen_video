# 1차 작업 문서 — AI 영상 생성 플랫폼 NestJS 백엔드 아키텍처 설계

> **작성일**: 2026-03-17
> **작업 단계**: 1차 (백엔드 기반 구축)
> **기술 스택**: NestJS · TypeScript · PostgreSQL · Redis · Bull · AWS S3

---

## 1. 개요

AI 영상 생성 플랫폼의 백엔드 서비스를 NestJS 기반으로 구축한다.
사용자가 텍스트 프롬프트를 입력하면 AI 영상 생성 작업이 비동기 큐를 통해 처리되고, 완성된 영상은 S3 스토리지에 저장된다.

### 핵심 목표

| 항목 | 내용 |
|------|------|
| 아키텍처 | 클린 아키텍처 + 모듈형 설계 |
| 인증 | JWT 기반 (Access Token + Refresh Token) |
| 비동기 처리 | Bull Queue (Redis 기반) |
| 스토리지 | AWS S3 호환 스토리지 |
| 문서화 | Swagger (개발 환경 자동 노출) |
| 컨테이너화 | Docker + Docker Compose |

---

## 2. 디렉터리 구조

```
ai_gen_video/
├── Dockerfile
├── docker-compose.yml
├── .env.example
├── package.json
├── tsconfig.json
├── tsconfig.build.json
├── nest-cli.json
├── .eslintrc.js
├── .prettierrc
├── docs/
│   └── 1차문서-NestJS_백엔드_아키텍처_설계.md
└── src/
    ├── main.ts
    ├── app.module.ts
    ├── config/
    │   ├── configuration.ts
    │   ├── database.config.ts
    │   ├── jwt.config.ts
    │   ├── redis.config.ts
    │   └── storage.config.ts
    ├── common/
    │   ├── filters/
    │   │   └── http-exception.filter.ts
    │   ├── interceptors/
    │   │   ├── logging.interceptor.ts
    │   │   └── transform.interceptor.ts
    │   ├── guards/
    │   │   ├── jwt-auth.guard.ts
    │   │   └── roles.guard.ts
    │   ├── decorators/
    │   │   ├── current-user.decorator.ts
    │   │   ├── roles.decorator.ts
    │   │   └── public.decorator.ts
    │   ├── middleware/
    │   │   └── logger.middleware.ts
    │   └── pipes/
    │       └── validation.pipe.ts
    └── modules/
        ├── auth/
        ├── users/
        ├── videos/
        ├── ai/
        ├── queue/
        └── storage/
```

---

## 3. 레이어별 설계

### 3.1 Config Layer (`src/config/`)

환경변수를 타입 안전하게 관리한다.
`ConfigModule.forRoot()`에 `configuration.ts`를 로드하여 전체 모듈에서 `ConfigService`로 접근한다.

| 파일 | 역할 |
|------|------|
| `configuration.ts` | 전체 환경변수 집계 및 기본값 설정 |
| `database.config.ts` | TypeORM PostgreSQL 연결 옵션 팩토리 |
| `jwt.config.ts` | JWT 서명 옵션 팩토리 |
| `redis.config.ts` | Redis 연결 옵션 팩토리 |
| `storage.config.ts` | AWS S3Client 인스턴스 팩토리 |

### 3.2 Common Layer (`src/common/`)

전역 횡단 관심사(Cross-Cutting Concerns)를 담당한다.

| 구성 요소 | 파일 | 설명 |
|-----------|------|------|
| 예외 필터 | `http-exception.filter.ts` | 모든 예외를 일관된 JSON 형식으로 반환, 5xx는 error 로깅 |
| 응답 변환 인터셉터 | `transform.interceptor.ts` | 모든 응답을 `{ success, data, timestamp }` 구조로 래핑 |
| 로깅 인터셉터 | `logging.interceptor.ts` | HTTP 메서드·경로·상태코드·응답시간 기록 |
| JWT 인증 가드 | `jwt-auth.guard.ts` | `@Public()` 데코레이터가 없는 모든 엔드포인트에 적용 |
| 역할 가드 | `roles.guard.ts` | `@Roles(UserRole.ADMIN)` 데코레이터 기반 권한 검사 |
| 커스텀 데코레이터 | `current-user.decorator.ts` | Request에서 인증된 사용자 객체 추출 |
| Public 데코레이터 | `public.decorator.ts` | JWT 인증 우회 마킹 |

### 3.3 Feature Modules (`src/modules/`)

각 도메인을 독립적인 NestJS 모듈로 분리한다.

---

## 4. 모듈 상세

### 4.1 Auth Module

**경로**: `src/modules/auth/`

| 파일 | 역할 |
|------|------|
| `auth.controller.ts` | register / login / refresh / logout / profile 엔드포인트 |
| `auth.service.ts` | 회원가입, 로그인 검증, 토큰 생성/갱신 로직 |
| `strategies/jwt.strategy.ts` | Bearer 토큰 검증 및 사용자 조회 |
| `strategies/local.strategy.ts` | email + password 기반 Passport 로컬 전략 |
| `dto/login.dto.ts` | 로그인 요청 DTO |
| `dto/register.dto.ts` | 회원가입 요청 DTO |
| `interfaces/jwt-payload.interface.ts` | JWT 페이로드 타입 정의 |

**인증 흐름**:
```
회원가입: POST /auth/register
  → 이메일 중복 확인 → bcrypt 해싱 → DB 저장 → 토큰 발급

로그인: POST /auth/login (LocalStrategy)
  → email/password 검증 → Access Token + Refresh Token 반환

토큰 갱신: POST /auth/refresh
  → Refresh Token 검증 → 새 토큰 쌍 발급
```

**보안 포인트**:
- 비밀번호는 bcrypt `saltRounds=12`로 해싱
- Access Token: `JWT_EXPIRES_IN` (기본 7d)
- Refresh Token: `JWT_REFRESH_EXPIRES_IN` (기본 30d), 별도 secret 사용
- 응답에서 `password` 필드 자동 제거

---

### 4.2 Users Module

**경로**: `src/modules/users/`

| 엔드포인트 | 권한 | 설명 |
|-----------|------|------|
| `GET /users/me` | 인증된 사용자 | 내 프로필 조회 |
| `PATCH /users/me` | 인증된 사용자 | 내 프로필 수정 |
| `GET /users` | ADMIN | 전체 사용자 목록 |
| `GET /users/:id` | ADMIN | 특정 사용자 조회 |
| `DELETE /users/:id` | ADMIN | 사용자 삭제 |

**User Entity 주요 필드**:
```typescript
id: uuid (PK)
firstName, lastName: string
email: string (unique)
username: string (unique, nullable)
password: string (excluded from select)
role: enum (user | admin)
isActive: boolean
createdAt, updatedAt: Date
```

---

### 4.3 Videos Module

**경로**: `src/modules/videos/`

| 엔드포인트 | 메서드 | 설명 |
|-----------|--------|------|
| `POST /videos/generate` | 인증 | 영상 생성 작업 제출 |
| `GET /videos` | 인증 | 내 영상 목록 (페이지네이션, 상태 필터) |
| `GET /videos/:id` | 인증 | 영상 상세 조회 |
| `PATCH /videos/:id` | 인증 | 영상 메타데이터 수정 |
| `DELETE /videos/:id` | 인증 | 영상 삭제 |

**Video Status Lifecycle**:
```
PENDING → PROCESSING → COMPLETED
                     ↘ FAILED
                     ↘ CANCELLED
```

**Video Entity 주요 필드**:
```typescript
id: uuid (PK)
title: string
prompt: string (text)
negativePrompt: string (text, nullable)
status: enum (VideoStatus)
videoUrl: string (nullable)
thumbnailUrl: string (nullable)
errorMessage: string (nullable)
durationSeconds: number (nullable)
width, height, fps: number
model: string (nullable)
metadata: jsonb
userId: uuid (FK → users)
```

---

### 4.4 AI Module

**경로**: `src/modules/ai/`

AI 영상 생성 공급자(Provider)와의 통신을 추상화한다.

| 파일 | 역할 |
|------|------|
| `ai.service.ts` | 영상 생성 요청, 상태 폴링, 프롬프트 강화 |
| `providers/openai.provider.ts` | OpenAI 클라이언트 NestJS Provider 팩토리 |
| `interfaces/ai-provider.interface.ts` | `IAiProvider` 인터페이스 (공급자 교체 가능) |

**프롬프트 강화 기능** (`enhancePrompt`):
- GPT-4o를 사용하여 사용자 프롬프트를 더 영화적이고 상세한 영상 생성 프롬프트로 자동 개선
- 원본 의도를 유지하면서 300단어 이내로 강화

**공급자 교체 방법**:
`IAiProvider` 인터페이스를 구현한 새 서비스를 작성하고 `AiModule`에 등록하면 된다.
현재 지원 예정 공급자: RunwayML, Stability AI, Pika Labs 등

---

### 4.5 Queue Module

**경로**: `src/modules/queue/`

Bull + Redis를 사용한 비동기 영상 생성 파이프라인이다.

**Queue 이름**: `video-generation`
**Job 이름**: `generate`

**처리 흐름** (`VideoGenerationProcessor`):

```
1. 영상 상태 → PROCESSING 업데이트
2. AI 서비스로 프롬프트 강화 (GPT-4o)
3. AI 영상 생성 API 호출 → jobId 반환
4. 상태 폴링 (최대 30회, 10초 간격)
5. 영상 URL 확인 시 → S3에 업로드
6. 영상 상태 → COMPLETED 업데이트
7. 실패 시 → FAILED + errorMessage 기록
```

**Bull 옵션**:
- `attempts: 3` — 실패 시 최대 3회 재시도
- `backoff: exponential(5000ms)` — 지수 백오프
- `removeOnComplete: 100` — 완료된 Job 최대 100개 보존
- `removeOnFail: 500` — 실패한 Job 최대 500개 보존

---

### 4.6 Storage Module

**경로**: `src/modules/storage/`

AWS S3 호환 스토리지 추상화 레이어.

| 메서드 | 설명 |
|--------|------|
| `uploadBuffer(buffer, key, contentType)` | 버퍼를 S3에 업로드 |
| `uploadFromUrl(url, key)` | 외부 URL에서 다운로드 후 S3 재업로드 |
| `getPresignedUploadUrl(key, expiresIn)` | 클라이언트 직접 업로드용 서명 URL 생성 |
| `getPresignedDownloadUrl(key, expiresIn)` | 클라이언트 직접 다운로드용 서명 URL 생성 |
| `deleteObject(key)` | S3 객체 삭제 |

MinIO 등 S3 호환 스토리지 사용 시 `.env`의 `AWS_S3_ENDPOINT` 설정으로 전환 가능.

---

## 5. API 엔드포인트 전체 목록

| 메서드 | 경로 | 인증 | 설명 |
|--------|------|------|------|
| POST | `/api/v1/auth/register` | 없음 | 회원가입 |
| POST | `/api/v1/auth/login` | 없음 | 로그인 |
| POST | `/api/v1/auth/refresh` | 없음 | 토큰 갱신 |
| GET | `/api/v1/auth/profile` | JWT | 내 프로필 |
| POST | `/api/v1/auth/logout` | JWT | 로그아웃 |
| GET | `/api/v1/users/me` | JWT | 내 정보 조회 |
| PATCH | `/api/v1/users/me` | JWT | 내 정보 수정 |
| GET | `/api/v1/users` | ADMIN | 전체 사용자 목록 |
| GET | `/api/v1/users/:id` | ADMIN | 사용자 조회 |
| DELETE | `/api/v1/users/:id` | ADMIN | 사용자 삭제 |
| POST | `/api/v1/videos/generate` | JWT | 영상 생성 요청 |
| GET | `/api/v1/videos` | JWT | 내 영상 목록 |
| GET | `/api/v1/videos/:id` | JWT | 영상 상세 조회 |
| PATCH | `/api/v1/videos/:id` | JWT | 영상 제목 수정 |
| DELETE | `/api/v1/videos/:id` | JWT | 영상 삭제 |

---

## 6. 환경변수

`.env.example` 파일 기반 — 로컬 실행 전 `.env`로 복사 후 값 입력 필요.

```
# Application
NODE_ENV=development
PORT=3000
API_PREFIX=api/v1

# Database (PostgreSQL)
DB_HOST, DB_PORT, DB_USERNAME, DB_PASSWORD, DB_DATABASE
DB_SYNCHRONIZE=false  ← 프로덕션에서 반드시 false

# JWT
JWT_SECRET, JWT_EXPIRES_IN=7d
JWT_REFRESH_SECRET, JWT_REFRESH_EXPIRES_IN=30d

# Redis
REDIS_HOST, REDIS_PORT, REDIS_PASSWORD

# AWS S3
AWS_REGION, AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY
AWS_S3_BUCKET, AWS_S3_ENDPOINT (optional, for MinIO)

# AI
OPENAI_API_KEY
AI_VIDEO_PROVIDER, AI_VIDEO_API_KEY, AI_VIDEO_API_URL

# Rate Limiting
THROTTLE_TTL=60, THROTTLE_LIMIT=100

# CORS
CORS_ORIGIN=http://localhost:3001
```

---

## 7. 인프라 구성 (Docker)

### docker-compose 서비스

| 서비스 | 이미지 | 포트 | 역할 |
|--------|--------|------|------|
| `app` | 로컬 빌드 | 3000 | NestJS API 서버 |
| `postgres` | postgres:16-alpine | 5432 | 메인 데이터베이스 |
| `redis` | redis:7-alpine | 6379 | 큐 및 캐시 |

### Dockerfile 최적화
- **Multi-stage build**: `builder` → `production` 단계 분리로 이미지 크기 최소화
- **Non-root user**: `nestjs:nodejs` 사용자로 실행
- **Health check**: `/health` 엔드포인트 30초 간격 확인

---

## 8. 보안 체크리스트

| 항목 | 구현 여부 | 비고 |
|------|-----------|------|
| Helmet (HTTP 헤더 보안) | ✅ | `main.ts` |
| CORS 화이트리스트 | ✅ | `CORS_ORIGIN` 환경변수 |
| Rate Limiting | ✅ | Throttler (100req/60s 기본) |
| JWT 인증 전역 적용 | ✅ | `JwtAuthGuard` 전역 등록 |
| 역할 기반 접근 제어 | ✅ | `RolesGuard` + `@Roles()` |
| 비밀번호 bcrypt 해싱 | ✅ | saltRounds=12 |
| DTO Whitelist 검증 | ✅ | `ValidationPipe(whitelist: true)` |
| SQL Injection 방지 | ✅ | TypeORM QueryBuilder 파라미터 바인딩 |
| 환경변수 시크릿 분리 | ✅ | `.env` gitignore 처리 |

---

## 9. 다음 작업 (2차 예정)

- [ ] TypeORM 마이그레이션 스크립트 작성
- [ ] 실제 AI 영상 생성 공급자(RunwayML / Stability AI) 연동
- [ ] Webhook 기반 영상 완료 알림 (폴링 대체)
- [ ] 영상 썸네일 자동 생성
- [ ] 사용자별 사용량(Usage) 제한 및 크레딧 시스템
- [ ] E2E 테스트 작성
- [ ] CI/CD 파이프라인 구성 (GitHub Actions)
- [ ] 모니터링 연동 (Prometheus + Grafana)

---

*이 문서는 1차 백엔드 기반 구축 완료 시점의 스냅샷입니다.*
