# AI Video Generation Backend Platform

> AI 모델을 실제 서비스처럼 운영할 수 있는 백엔드 시스템 — Job Queue 기반 비동기 처리, JWT 인증, AWS S3 스토리지를 갖춘 프로덕션 수준의 NestJS 플랫폼

---

## 시스템 아키텍처

```
Client
  │
  ▼
API Gateway (NestJS + Helmet + Rate Limiter)
  │
  ▼
Video Generation Service
  ├─ JWT 인증 / 권한 검사
  ├─ DTO 유효성 검사
  └─ Video 레코드 생성
  │
  ▼
Job Queue (BullMQ + Redis)
  │  - 최대 3회 재시도 (지수 백오프: 5s → 25s → 125s)
  │
  ▼
AI Worker (VideoGenerationProcessor)
  ├─ Prompt 향상 (OpenAI GPT-4o)
  ├─ AI Provider 호출 (FakeVideoProvider / OpenAI)
  └─ 진행률 폴링 (10초 간격, 최대 30회)
  │
  ▼
Storage (AWS S3 / MinIO)
  └─ Presigned URL 발급 (다운로드)
  │
  ▼
PostgreSQL (작업 상태 영속화)
```

---

## 주요 기능

| 기능 | 설명 |
|------|------|
| AI 영상 생성 요청 | 프롬프트 기반 영상 생성 작업 생성 및 큐 등록 |
| 비동기 Job Queue | BullMQ 기반 워커가 백그라운드에서 영상 처리 |
| 작업 상태 조회 | PENDING → PROCESSING → COMPLETED / FAILED 폴링 |
| 결과 다운로드 URL | S3 Presigned URL 발급으로 안전한 영상 다운로드 |
| JWT 인증 | 액세스 토큰 + 리프레시 토큰 이중 인증 구조 |
| Prompt 향상 | GPT-4o를 통한 프롬프트 자동 개선 |

---

## 기술 스택

| 분류 | 기술 |
|------|------|
| 프레임워크 | NestJS 10, TypeScript 5 |
| 데이터베이스 | PostgreSQL 16 + TypeORM |
| 큐 / 캐시 | Redis 7 + BullMQ 5 |
| 스토리지 | AWS S3 (MinIO 호환) |
| 인증 | JWT (Passport.js) + bcryptjs |
| AI | OpenAI GPT-4o (Prompt 향상), FakeVideoProvider (시뮬레이션) |
| 문서화 | Swagger / OpenAPI 3.0 |
| 인프라 | Docker, Docker Compose |
| 로깅 | Winston + nest-winston |
| 보안 | Helmet, CORS, ThrottlerGuard |

---

## 모듈 구성

```
src/
├── main.ts                    # 앱 부트스트랩 (Swagger, Security, Versioning)
├── app.module.ts              # 루트 모듈
├── config/                    # 환경변수 기반 설정 (DB, JWT, Redis, S3)
├── common/                    # 공통 계층
│   ├── decorators/            # @CurrentUser, @Public, @Roles
│   ├── filters/               # HttpExceptionFilter (전역 예외 처리)
│   ├── guards/                # JwtAuthGuard, RolesGuard
│   ├── interceptors/          # TransformInterceptor (응답 표준화), LoggingInterceptor
│   └── pipes/                 # ValidationPipe (DTO 유효성 검사)
└── modules/
    ├── auth/                  # 회원가입, 로그인, 토큰 갱신
    ├── users/                 # 사용자 엔티티 및 CRUD
    ├── videos/                # 영상 생성 요청, 상태 조회, 결과 조회
    ├── ai/                    # AI Provider 추상화 계층
    │   └── providers/
    │       ├── fake-video.provider.ts   # 개발/테스트용 인메모리 시뮬레이터
    │       └── openai.provider.ts       # 실제 AI 연동 (확장 가능)
    ├── queue/                 # BullMQ 큐 설정, 워커 프로세서, 잡 상태 조회
    └── storage/               # S3 업로드, Presigned URL 생성
```

---

## API 엔드포인트

### 인증 (`/api/v1/auth`)

| Method | Endpoint | 설명 | 인증 |
|--------|----------|------|------|
| POST | `/auth/register` | 회원가입 | Public |
| POST | `/auth/login` | 로그인 (토큰 발급) | Public |
| POST | `/auth/refresh` | 액세스 토큰 갱신 | Public |
| GET | `/auth/profile` | 내 프로필 조회 | JWT |
| POST | `/auth/logout` | 로그아웃 | JWT |

### 영상 (`/api/v1/videos`)

| Method | Endpoint | 설명 | 인증 |
|--------|----------|------|------|
| POST | `/videos` | 영상 생성 요청 (큐 등록) | JWT |
| GET | `/videos` | 내 영상 목록 (페이지네이션 + 상태 필터) | JWT |
| GET | `/videos/:id` | 작업 상태 폴링 (진행률 포함) | JWT |
| GET | `/videos/:id/result` | Presigned 다운로드 URL 발급 | JWT |
| PATCH | `/videos/:id` | 제목/메타데이터 수정 | JWT |
| DELETE | `/videos/:id` | 영상 삭제 | JWT |

### 큐 디버깅 (`/api/v1/queue`)

| Method | Endpoint | 설명 | 인증 |
|--------|----------|------|------|
| GET | `/queue/jobs/:jobId` | BullMQ 잡 상태 조회 | JWT |

---

## 비동기 처리 파이프라인

영상 생성 요청부터 완료까지의 전체 흐름:

```
1. POST /videos
   └─ Video 레코드 생성 (status: PENDING)
   └─ BullMQ 잡 등록, queueJobId 저장

2. VideoGenerationProcessor (Worker)
   ├─ status → PROCESSING, progress: 10%
   ├─ GPT-4o로 프롬프트 향상 (progress: 20%)
   ├─ AI Provider에 영상 생성 제출 (progress: 40%)
   ├─ 10초 간격 폴링 (최대 30회 = 5분)
   │    └─ metadata에 진행률, 예상 잔여 시간 업데이트
   ├─ 완료 시 S3 업로드 (또는 alreadyStored=true 시 URL 직접 사용)
   └─ status → COMPLETED, videoUrl 저장

3. GET /videos/:id  →  status / progress 확인
4. GET /videos/:id/result  →  Presigned URL 발급 (최대 24시간)
```

---

## 영상 상태 머신

```
PENDING → PROCESSING → COMPLETED
                    └→ FAILED
PENDING → CANCELLED
```

상태별 의미:

| 상태 | 설명 |
|------|------|
| `PENDING` | 큐 대기 중 |
| `PROCESSING` | 워커가 처리 중 (진행률 포함) |
| `COMPLETED` | 영상 생성 완료, S3 URL 사용 가능 |
| `FAILED` | 최종 실패 (3회 재시도 소진) |
| `CANCELLED` | 사용자 취소 |

---

## BullMQ 재시도 전략

```
1차 실패 → 5초 후 재시도
2차 실패 → 25초 후 재시도
3차 실패 → 영상 상태 FAILED 처리
```

- 완료 잡: 최근 100개 보관
- 실패 잡: 최근 500개 보관 (디버깅용)

---

## 데이터베이스 스키마

### users
| 컬럼 | 타입 | 설명 |
|------|------|------|
| id | UUID PK | 사용자 ID |
| email | VARCHAR UNIQUE | 이메일 |
| username | VARCHAR UNIQUE | 사용자명 |
| password | VARCHAR | bcryptjs 해시 (salt=12) |
| role | ENUM | ADMIN / USER |
| isActive | BOOLEAN | 계정 활성 여부 |

### videos
| 컬럼 | 타입 | 설명 |
|------|------|------|
| id | UUID PK | 영상 ID |
| title | VARCHAR | 제목 |
| prompt | TEXT | 생성 프롬프트 |
| status | ENUM | 작업 상태 |
| videoUrl | VARCHAR | S3 영상 URL |
| width / height / fps | INTEGER | 영상 해상도/프레임 |
| metadata | JSONB | 진행률, aiJobId 등 |
| queueJobId | VARCHAR | BullMQ 잡 ID |
| userId | UUID FK | 소유자 (cascade delete) |

---

## 로컬 실행

### 사전 요구사항

- Node.js 20+
- Docker & Docker Compose

### 환경변수 설정

```bash
cp .env.example .env
# .env 파일에서 DB, Redis, JWT, S3, OpenAI 키 설정
```

### Docker Compose로 실행

```bash
# 전체 스택 실행 (NestJS + PostgreSQL + Redis)
docker-compose up -d

# 로그 확인
docker-compose logs -f app
```

### 개발 서버 실행

```bash
npm install
npm run start:dev
```

### API 문서 확인

```
http://localhost:3000/api/docs
```

---

## 환경변수 목록

```env
# Application
NODE_ENV=development
PORT=3000

# PostgreSQL
DB_HOST=localhost
DB_PORT=5432
DB_USERNAME=postgres
DB_PASSWORD=postgres
DB_DATABASE=ai_gen_video

# JWT
JWT_SECRET=your-secret-key
JWT_EXPIRES_IN=7d
JWT_REFRESH_SECRET=your-refresh-secret
JWT_REFRESH_EXPIRES_IN=30d

# Redis
REDIS_HOST=localhost
REDIS_PORT=6379

# AWS S3
AWS_REGION=us-east-1
AWS_ACCESS_KEY_ID=your-key
AWS_SECRET_ACCESS_KEY=your-secret
AWS_S3_BUCKET=ai-gen-video-storage

# OpenAI
OPENAI_API_KEY=your-openai-key

# AI Provider (fake = 시뮬레이션, openai = 실제)
AI_VIDEO_PROVIDER=fake
AI_SIMULATION_DELAY_MS=5000

# Rate Limiting
THROTTLE_TTL=60
THROTTLE_LIMIT=100
```

---

## 개발 단계별 구현 내역

| 단계 | 내용 |
|------|------|
| 1단계 | NestJS 백엔드 아키텍처 설계 — 모듈 구조, JWT 인증, TypeORM 연동 |
| 2단계 | REST API 설계 및 구현 — 영상 CRUD, 페이지네이션, Swagger 문서화 |
| 3단계 | BullMQ 잡큐 구현 — Bull → BullMQ 마이그레이션, 재시도 로직, 상태 추적 |
| 4단계 | AI 워커 서비스 — FakeVideoProvider 시뮬레이터, 진행률 폴링, S3 업로드 파이프라인 |

---

## 보안

- **인증**: JWT 액세스 토큰 (7일) + 리프레시 토큰 (30일)
- **비밀번호**: bcryptjs salt=12 해시
- **헤더 보안**: Helmet.js (XSS, CSRF 방어)
- **속도 제한**: ThrottlerGuard (60초당 100 요청)
- **CORS**: 설정된 Origin만 허용
- **S3 접근**: Presigned URL 기반 (직접 버킷 노출 없음)
