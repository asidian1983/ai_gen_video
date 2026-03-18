# 14차 문서 — 프로덕션 Docker 전략

> tini PID 1, 멀티플랫폼 빌드, 로컬/프로덕션 Compose 완전 분리
> 작성일: 2026-03-18

---

## 1. 개선 사항 요약

| 항목 | 이전 | 이후 |
|------|------|------|
| PID 1 프로세스 | `node dist/main` (신호 처리 불안정) | `tini → node dist/main` |
| SIGTERM 전달 | Node에 직접 전달 안 될 수 있음 | tini가 정확히 포워딩 |
| 좀비 프로세스 | 자식 프로세스 reap 없음 | tini가 자동 reap |
| Docker HEALTHCHECK | 없음 | `/health` 엔드포인트 내장 |
| EXPOSE | 없음 | `EXPOSE 3000` |
| 멀티플랫폼 | amd64만 빌드 | amd64 + arm64 동시 빌드 |
| 로컬 dev | `docker-compose.yml` 직접 사용 | `docker-compose.override.yml` 자동 적용 |

---

## 2. tini — 왜 필요한가?

Docker 컨테이너에서 `node dist/main`이 PID 1로 실행되면:

```
문제 1: SIGTERM 처리
  docker stop → SIGTERM → PID 1 (node)
  → Node가 자체 신호 처리기가 없으면 15초 후 SIGKILL
  → 진행 중인 요청 강제 종료

문제 2: 좀비 프로세스
  Node가 자식 프로세스를 spawn하고 종료 시 wait() 호출 안 하면
  좀비 프로세스가 쌓임
```

tini 적용 후:
```dockerfile
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "dist/main"]
# tini(PID 1) → SIGTERM 수신 → node에 정확히 포워딩
# NestJS가 enableShutdownHooks()로 graceful shutdown 수행
```

---

## 3. 멀티플랫폼 빌드 (amd64 + arm64)

OCI Free Tier Ampere A1 VM은 **ARM64** 아키텍처. amd64 이미지를 ARM64 VM에서 실행하면:
- QEMU 에뮬레이션으로 동작은 하지만 성능 저하
- 네이티브 ARM64 이미지 대비 약 2~3배 느림

GitHub Actions에서 QEMU로 교차 컴파일:
```yaml
- uses: docker/setup-qemu-action@v3
  with:
    platforms: arm64

- uses: docker/build-push-action@v5
  with:
    platforms: linux/amd64,linux/arm64
```

OCIR에 멀티 아키텍처 매니페스트로 push → VM이 자신의 아키텍처에 맞는 이미지를 자동 선택.

---

## 4. Compose 파일 역할 분리

```
docker-compose.yml          ← 공통 인프라 (postgres, redis, volumes, networks)
docker-compose.override.yml ← 로컬 개발 자동 적용 (builder 스테이지 + hot-reload)
docker-compose.prod.yml     ← 프로덕션 전용 (OCIR 이미지, 로그 로테이션)
```

### 로컬 개발
```bash
docker compose up -d
# docker-compose.yml + docker-compose.override.yml 자동 병합
# → builder 스테이지 빌드 + npm run start:dev (hot-reload)
```

### 프로덕션 (OCI VM)
```bash
docker compose -f docker-compose.prod.yml up -d
# docker-compose.override.yml 무시 → OCIR 이미지 사용
```

### override.yml 핵심
```yaml
services:
  api:
    build:
      context: .
      target: builder    # devDeps 포함 스테이지에서 멈춤
    command: npm run start:dev
    volumes:
      - .:/app           # 소스코드 마운트 (hot-reload)
      - /app/node_modules # 컨테이너 내부 node_modules 보호
```

`/app/node_modules` 익명 볼륨: 호스트의 `node_modules`가 컨테이너 내부를 덮어쓰는 것 방지. macOS/Windows에서 발생하는 심볼릭 링크 문제 해결.

---

## 5. Dockerfile HEALTHCHECK

```dockerfile
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -qO- http://localhost:${PORT}/health || exit 1
```

- `start_period=20s`: NestJS 기동 + DB 연결 시간 확보
- `docker ps`에서 `(healthy)` / `(unhealthy)` 상태 확인 가능
- docker-compose `depends_on: condition: service_healthy`에서 활용 가능

---

## 6. 변경된 파일

| 파일 | 변경 내용 |
|------|---------|
| `Dockerfile` | tini 추가, EXPOSE 3000, HEALTHCHECK, ENTRYPOINT 변경 |
| `docker-compose.override.yml` | 신규 — 로컬 개발 자동 오버라이드 |
| `.github/workflows/cd.yml` | QEMU + `platforms: linux/amd64,linux/arm64` 추가 |
