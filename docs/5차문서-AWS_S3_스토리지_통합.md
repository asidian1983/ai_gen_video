# 5차 문서 — AWS S3 스토리지 통합

> NestJS Clean Architecture 기반의 AWS S3 스토리지 레이어 설계 및 구현
> 작성일: 2026-03-17

---

## 1. 개요

### 구현 목표

| 항목 | 내용 |
|------|------|
| 목적 | 영상 버퍼를 AWS S3에 업로드하고 Public URL 반환 |
| SDK | `@aws-sdk/client-s3` v3 (AWS SDK for JavaScript v3) |
| 환경 설정 | 모든 자격증명 환경변수 기반 관리 |
| 아키텍처 | Clean Architecture — Provider / Module / Service 분리 |
| 신뢰성 | 에러 핸들링 + 지수 백오프 재시도 로직 |

---

## 2. 파일 구조

```
src/modules/storage/
├── s3.provider.ts      # S3Client DI 팩토리 프로바이더 (신규)
├── storage.module.ts   # NestJS 모듈 (S3Provider + StorageService 등록)
└── storage.service.ts  # 업로드·삭제·Presigned URL 비즈니스 로직
```

---

## 3. 구현 상세

### 3.1 `s3.provider.ts` — S3 클라이언트 프로바이더

```typescript
export const S3_CLIENT = 'S3_CLIENT';

export const S3Provider: Provider = {
  provide: S3_CLIENT,
  inject: [ConfigService],
  useFactory: (config: ConfigService): S3Client => {
    const endpoint = config.get<string>('storage.endpoint');
    return new S3Client({
      region: config.get<string>('storage.region', 'us-east-1'),
      credentials: {
        accessKeyId: config.get<string>('storage.accessKeyId') ?? '',
        secretAccessKey: config.get<string>('storage.secretAccessKey') ?? '',
      },
      ...(endpoint ? { endpoint, forcePathStyle: true } : {}),
    });
  },
};
```

**설계 포인트:**
- `S3_CLIENT` 토큰으로 의존성 주입 — 테스트 시 모킹 가능
- `endpoint` 옵션: MinIO / LocalStack 등 S3 호환 스토리지 지원
- `forcePathStyle: true`: 커스텀 엔드포인트 사용 시 Path-style URL 강제 적용

---

### 3.2 `storage.module.ts` — NestJS 모듈

```typescript
@Module({
  providers: [S3Provider, StorageService],
  exports: [StorageService],
})
export class StorageModule {}
```

**변경 사항:**
- 기존: `storage.config.ts`의 `createS3Client` 함수를 모듈 내 인라인으로 사용
- 개선: `S3Provider`를 독립 파일로 분리 → 단일 책임 원칙 준수

---

### 3.3 `storage.service.ts` — 스토리지 서비스

#### 주요 메서드

| 메서드 | 설명 | 재시도 |
|--------|------|--------|
| `uploadBuffer(buffer, key, contentType)` | Buffer → S3 업로드, Public URL 반환 | O (3회) |
| `uploadFromUrl(sourceUrl, key)` | URL에서 다운로드 후 S3 업로드 | O (업로드 단계) |
| `getPresignedUploadUrl(key, expiresIn)` | 업로드용 서명 URL 생성 | X (로컬 서명) |
| `getPresignedDownloadUrl(key, expiresIn)` | 다운로드용 서명 URL 생성 | X (로컬 서명) |
| `deleteObject(key)` | S3 객체 삭제 | O (3회) |

#### Public URL 생성 로직

```typescript
private getPublicUrl(key: string): string {
  const endpoint = this.configService.get<string>('storage.endpoint');
  if (endpoint) {
    // MinIO / LocalStack: http://localhost:9000/bucket/key
    return `${endpoint}/${this.bucket}/${key}`;
  }
  // AWS S3 표준: https://bucket.s3.region.amazonaws.com/key
  return `https://${this.bucket}.s3.${region}.amazonaws.com/${key}`;
}
```

---

## 4. 에러 핸들링

모든 public 메서드에 `try/catch` 적용:

```typescript
async uploadBuffer(buffer: Buffer, key: string, contentType = 'application/octet-stream'): Promise<string> {
  try {
    await this.withRetry(() => this.s3Client.send(new PutObjectCommand({ ... })));
    return this.getPublicUrl(key);
  } catch (error) {
    this.logger.error(`Failed to upload ${key} to S3`, error.stack);
    throw new InternalServerErrorException(`S3 upload failed for key: ${key}`);
  }
}
```

**에러 처리 원칙:**
- AWS SDK 내부 에러(`S3ServiceException` 등)는 클라이언트에 직접 노출하지 않음
- `InternalServerErrorException`으로 래핑하여 표준 HTTP 500 응답 반환
- 원본 스택 트레이스는 Winston 로거로 서버 사이드에만 기록

**HTTP 다운로드 에러 처리 강화:**
```typescript
// 기존: 4xx/5xx 상태코드를 무시하고 빈 버퍼 반환
// 개선: 4xx/5xx 감지 즉시 reject
if (response.statusCode && response.statusCode >= 400) {
  reject(new Error(`HTTP ${response.statusCode} downloading ${url}`));
  return;
}
```

---

## 5. 재시도 로직 (지수 백오프)

```typescript
private async withRetry<T>(
  operation: () => Promise<T>,
  maxAttempts = 3,
): Promise<T> {
  let lastError: Error = new Error('S3 operation failed after all retry attempts');
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await operation();
    } catch (error) {
      lastError = error as Error;
      if (attempt < maxAttempts) {
        const delayMs = BASE_RETRY_DELAY_MS * Math.pow(2, attempt - 1);
        this.logger.warn(
          `S3 operation failed (attempt ${attempt}/${maxAttempts}), retrying in ${delayMs}ms — ${lastError.message}`,
        );
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
    }
  }
  throw lastError;
}
```

**재시도 스케줄:**

| 시도 | 지연 시간 |
|------|----------|
| 1차 실패 | 200ms 후 재시도 |
| 2차 실패 | 400ms 후 재시도 |
| 3차 실패 | 예외 상위 전파 |

**재시도 적용 범위:**
- `uploadBuffer` — 네트워크 일시 장애 대응
- `deleteObject` — S3 일시 오류 대응
- `getPresignedUploadUrl` / `getPresignedDownloadUrl` — 제외 (로컬 서명, 네트워크 불필요)

---

## 6. 환경변수

```env
# AWS 자격증명
AWS_REGION=us-east-1
AWS_ACCESS_KEY_ID=your-access-key-id
AWS_SECRET_ACCESS_KEY=your-secret-access-key

# S3 버킷
AWS_S3_BUCKET=ai-gen-video-storage

# 커스텀 엔드포인트 (MinIO / LocalStack 사용 시)
AWS_S3_ENDPOINT=http://localhost:9000
```

설정 매핑 (`src/config/configuration.ts`):

```typescript
storage: {
  region:          process.env.AWS_REGION            ?? 'us-east-1',
  accessKeyId:     process.env.AWS_ACCESS_KEY_ID     ?? '',
  secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY ?? '',
  bucket:          process.env.AWS_S3_BUCKET         ?? 'ai-gen-video-storage',
  endpoint:        process.env.AWS_S3_ENDPOINT       ?? undefined,
},
```

---

## 7. 로컬 개발 (MinIO)

`AWS_S3_ENDPOINT`를 설정하면 MinIO를 AWS S3 대신 사용할 수 있습니다.

```yaml
# docker-compose.yml 예시
minio:
  image: minio/minio
  ports:
    - "9000:9000"
    - "9001:9001"
  environment:
    MINIO_ROOT_USER: minioadmin
    MINIO_ROOT_PASSWORD: minioadmin
  command: server /data --console-address ":9001"
```

```env
AWS_S3_ENDPOINT=http://localhost:9000
AWS_ACCESS_KEY_ID=minioadmin
AWS_SECRET_ACCESS_KEY=minioadmin
AWS_S3_BUCKET=ai-gen-video-storage
```

---

## 8. 의존성

```json
"@aws-sdk/client-s3": "^3.490.0",
"@aws-sdk/s3-request-presigner": "^3.x"
```

---

## 9. 전체 구현 진행 현황

| 단계 | 내용 | 상태 |
|------|------|------|
| 1단계 | NestJS 백엔드 아키텍처 설계 | 완료 |
| 2단계 | REST API 설계 및 구현 | 완료 |
| 3단계 | BullMQ 잡큐 구현 | 완료 |
| 4단계 | AI 워커 서비스 및 시뮬레이션 | 완료 |
| **5단계** | **AWS S3 스토리지 통합** | **완료** |
