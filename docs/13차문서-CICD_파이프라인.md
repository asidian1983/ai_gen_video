# 13차 문서 — CI/CD 파이프라인 (GitHub Actions + Oracle Cloud)

> GitHub Actions 기반 자동 빌드·배포 파이프라인
> 작성일: 2026-03-18

---

## 1. 파이프라인 전체 흐름

```
개발자 push / PR
       │
       ▼
┌─────────────────────────────────────────────────────┐
│  CI Workflow (.github/workflows/ci.yml)              │
│                                                      │
│  PR / feature branch push에 트리거                   │
│  ├─ TypeScript type check (tsc --noEmit)            │
│  ├─ ESLint (--max-warnings 0)                       │
│  └─ Docker build smoke test (push 없음)              │
└─────────────────────────────────────────────────────┘
       │ main branch merge
       ▼
┌─────────────────────────────────────────────────────┐
│  CD Workflow (.github/workflows/cd.yml)              │
│                                                      │
│  main push에 트리거                                   │
│  ├─ Docker 이미지 빌드 (3-stage multi-stage)          │
│  ├─ OCIR(OCI Container Registry) push                │
│  │    {region}.ocir.io/{namespace}/ai-gen-video:latest│
│  └─ SSH → OCI Compute VM                            │
│       ├─ docker login OCIR                          │
│       ├─ docker pull latest                         │
│       ├─ .env 파일 생성 (GitHub Secrets → VM)        │
│       ├─ docker compose up -d (Rolling restart)     │
│       ├─ GET /health 헬스체크 확인                   │
│       └─ docker image prune (구버전 정리)            │
└─────────────────────────────────────────────────────┘
       │
       ▼
   OCI Compute (VM)
   ├─ api container    :3000
   ├─ worker container (headless)
   ├─ postgres container
   └─ redis container
```

---

## 2. GitHub Secrets 설정

GitHub → Settings → Secrets and variables → Actions 에서 아래 Secrets 등록:

### OCI / OCIR Secrets

| Secret | 예시 값 | 설명 |
|--------|---------|------|
| `OCIR_REGISTRY` | `ap-seoul-1.ocir.io` | OCIR 리전 엔드포인트 |
| `OCIR_NAMESPACE` | `axxxxxxxxxxx` | OCI 테넌시 네임스페이스 |
| `OCIR_USERNAME` | `axxxxxxxxxxx/oracleidentitycloudservice/user@example.com` | `{namespace}/{username}` 형식 |
| `OCIR_TOKEN` | (Auth Token) | OCI 콘솔 → 사용자 → Auth Tokens |

### OCI VM Secrets

| Secret | 설명 |
|--------|------|
| `OCI_HOST` | VM 퍼블릭 IP |
| `OCI_USER` | `opc` (기본값) |
| `OCI_SSH_KEY` | SSH 개인키 (PEM 형식 전체) |
| `OCI_SSH_PORT` | `22` |

### 애플리케이션 Secrets

| Secret | 설명 |
|--------|------|
| `DB_USERNAME` | PostgreSQL 사용자명 |
| `DB_PASSWORD` | PostgreSQL 비밀번호 |
| `DB_DATABASE` | 데이터베이스명 |
| `REDIS_PASSWORD` | Redis 비밀번호 (선택) |
| `JWT_SECRET` | JWT 서명 키 |
| `JWT_REFRESH_SECRET` | Refresh Token 서명 키 |
| `AWS_REGION` | S3 리전 |
| `AWS_ACCESS_KEY_ID` | IAM 액세스 키 |
| `AWS_SECRET_ACCESS_KEY` | IAM 시크릿 키 |
| `AWS_S3_BUCKET` | S3 버킷명 |
| `OPENAI_API_KEY` | OpenAI API 키 |
| `AI_VIDEO_PROVIDER` | `fake` 또는 `openai` |
| `MONITORING_USER` | Bull Board 사용자명 |
| `MONITORING_PASSWORD` | Bull Board 비밀번호 |
| `CORS_ORIGIN` | 허용 CORS Origin |

---

## 3. OCI VM 초기 설정

Oracle Cloud Free Tier VM(Ampere A1, ARM)에서 아래 초기화 작업 필요:

```bash
# 1. Docker 설치
sudo dnf install -y docker
sudo systemctl enable --now docker
sudo usermod -aG docker opc

# 2. Docker Compose v2 설치
sudo dnf install -y docker-compose-plugin

# 3. 배포 디렉토리 생성
sudo mkdir -p /opt/ai-gen-video
sudo chown opc:opc /opt/ai-gen-video

# 4. docker-compose.prod.yml 업로드
scp docker-compose.prod.yml opc@{VM_IP}:/opt/ai-gen-video/

# 5. 방화벽 설정 (OCI Security List도 함께 열어야 함)
sudo firewall-cmd --permanent --add-port=3000/tcp
sudo firewall-cmd --reload
```

---

## 4. 워크플로우 세부 설명

### CI — 코드 품질 게이트

```yaml
on:
  push:
    branches-ignore: [main]   # feature/*, docs/*, fix/* 브랜치
  pull_request:
    branches: [main]
```

- `concurrency: cancel-in-progress: true` — 같은 브랜치에 연속 push 시 이전 실행 취소
- lint-and-typecheck → build-image 순서 의존성 (`needs`)
- Docker BuildKit 캐시 (`type=gha`) — 반복 빌드 속도 향상

### CD — 무중단 배포

```yaml
concurrency:
  group: cd-production
  cancel-in-progress: false   # 배포 중 절대 취소 안 함
```

**Rolling restart 원리:**
`docker compose up -d`는 변경된 서비스만 순차적으로 재시작. PostgreSQL/Redis는 이미지가 같으므로 재시작 없음 → **DB 연결 끊김 없음**.

**Health check 대기 (15초):**
NestJS 앱 기동 → DB 연결 → TypeORM 초기화까지 약 10~15초 소요. `/health` 엔드포인트로 실제 DB 연결 상태 확인 후 파이프라인 성공 처리.

---

## 5. 이미지 태깅 전략

```
{region}.ocir.io/{namespace}/ai-gen-video:sha-a1b2c3d  ← 커밋 SHA
{region}.ocir.io/{namespace}/ai-gen-video:latest        ← 항상 최신
```

`docker metadata-action`으로 두 태그를 동시 push. VM은 `latest`를 pull하여 항상 최신 이미지 사용.

---

## 6. 변경된/추가된 파일

| 파일 | 내용 |
|------|------|
| `.github/workflows/ci.yml` | PR · feature branch 자동 lint/typecheck/build |
| `.github/workflows/cd.yml` | main push → OCIR build/push → OCI SSH 배포 |
| `docker-compose.prod.yml` | OCIR 이미지 기반 프로덕션 Compose 설정 |

---

## 7. 배포 후 확인

```bash
# VM에서
docker compose -f docker-compose.prod.yml ps

# 헬스체크
curl http://{VM_IP}:3000/health

# 로그
docker compose -f docker-compose.prod.yml logs -f api
docker compose -f docker-compose.prod.yml logs -f worker
```
