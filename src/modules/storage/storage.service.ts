import {
  Injectable,
  Logger,
  Inject,
  InternalServerErrorException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  S3Client,
  PutObjectCommand,
  DeleteObjectCommand,
  GetObjectCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { S3_CLIENT } from './s3.provider';
import * as https from 'https';

const MAX_RETRY_ATTEMPTS = 3;
const BASE_RETRY_DELAY_MS = 200;

@Injectable()
export class StorageService {
  private readonly logger = new Logger(StorageService.name);
  private readonly bucket: string;

  constructor(
    @Inject(S3_CLIENT) private readonly s3Client: S3Client,
    private readonly configService: ConfigService,
  ) {
    this.bucket = this.configService.get<string>(
      'storage.bucket',
      'ai-gen-video-storage',
    );
  }

  async uploadBuffer(
    buffer: Buffer,
    key: string,
    contentType = 'application/octet-stream',
  ): Promise<string> {
    try {
      await this.withRetry(() =>
        this.s3Client.send(
          new PutObjectCommand({
            Bucket: this.bucket,
            Key: key,
            Body: buffer,
            ContentType: contentType,
          }),
        ),
      );
      this.logger.log(`Uploaded ${key} to S3`);
      return this.getPublicUrl(key);
    } catch (error) {
      this.logger.error(`Failed to upload ${key} to S3`, (error as Error).stack);
      throw new InternalServerErrorException(`S3 upload failed for key: ${key}`);
    }
  }

  async uploadFromUrl(sourceUrl: string, key: string): Promise<string> {
    let buffer: Buffer;
    try {
      buffer = await this.downloadToBuffer(sourceUrl);
    } catch (error) {
      this.logger.error(`Failed to download from URL: ${sourceUrl}`, (error as Error).stack);
      throw new InternalServerErrorException('Failed to fetch video from source URL');
    }
    return this.uploadBuffer(buffer, key, 'video/mp4');
  }

  async getPresignedUploadUrl(key: string, expiresIn = 3600): Promise<string> {
    try {
      return await getSignedUrl(
        this.s3Client,
        new PutObjectCommand({ Bucket: this.bucket, Key: key }),
        { expiresIn },
      );
    } catch (error) {
      this.logger.error(`Failed to generate presigned upload URL for ${key}`, (error as Error).stack);
      throw new InternalServerErrorException('Failed to generate upload URL');
    }
  }

  async getPresignedDownloadUrl(key: string, expiresIn = 3600): Promise<string> {
    const clampedExpiry = Math.min(Math.max(expiresIn, 60), 86400);
    try {
      return await getSignedUrl(
        this.s3Client,
        new GetObjectCommand({ Bucket: this.bucket, Key: key }),
        { expiresIn: clampedExpiry },
      );
    } catch (error) {
      this.logger.error(`Failed to generate presigned download URL for ${key}`, (error as Error).stack);
      throw new InternalServerErrorException('Failed to generate download URL');
    }
  }

  async deleteObject(key: string): Promise<void> {
    try {
      await this.withRetry(() =>
        this.s3Client.send(
          new DeleteObjectCommand({ Bucket: this.bucket, Key: key }),
        ),
      );
      this.logger.log(`Deleted ${key} from S3`);
    } catch (error) {
      this.logger.error(`Failed to delete ${key} from S3`, (error as Error).stack);
      throw new InternalServerErrorException(`S3 delete failed for key: ${key}`);
    }
  }

  private getPublicUrl(key: string): string {
    const endpoint = this.configService.get<string>('storage.endpoint');
    if (endpoint) {
      return `${endpoint}/${this.bucket}/${key}`;
    }
    const region = this.configService.get<string>('storage.region', 'us-east-1');
    return `https://${this.bucket}.s3.${region}.amazonaws.com/${key}`;
  }

  private downloadToBuffer(url: string): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      https
        .get(url, (response) => {
          if (response.statusCode && response.statusCode >= 400) {
            reject(new Error(`HTTP ${response.statusCode} downloading ${url}`));
            return;
          }
          const chunks: Buffer[] = [];
          response.on('data', (chunk: Buffer) => chunks.push(chunk));
          response.on('end', () => resolve(Buffer.concat(chunks)));
          response.on('error', reject);
        })
        .on('error', reject);
    });
  }

  private async withRetry<T>(
    operation: () => Promise<T>,
    maxAttempts = MAX_RETRY_ATTEMPTS,
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
}
