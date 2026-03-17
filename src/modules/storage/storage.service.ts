import { Injectable, Logger, Inject } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  S3Client,
  PutObjectCommand,
  DeleteObjectCommand,
  GetObjectCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { S3_CLIENT } from './storage.module';
import * as https from 'https';

@Injectable()
export class StorageService {
  private readonly logger = new Logger(StorageService.name);
  private readonly bucket: string;

  constructor(
    @Inject(S3_CLIENT) private readonly s3Client: S3Client,
    private readonly configService: ConfigService,
  ) {
    this.bucket = this.configService.get<string>('storage.bucket', 'ai-gen-video');
  }

  async uploadBuffer(
    buffer: Buffer,
    key: string,
    contentType = 'application/octet-stream',
  ): Promise<string> {
    await this.s3Client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: buffer,
        ContentType: contentType,
      }),
    );

    this.logger.log(`Uploaded ${key} to S3`);
    return this.getPublicUrl(key);
  }

  async uploadFromUrl(sourceUrl: string, key: string): Promise<string> {
    const buffer = await this.downloadToBuffer(sourceUrl);
    return this.uploadBuffer(buffer, key, 'video/mp4');
  }

  async getPresignedUploadUrl(key: string, expiresIn = 3600): Promise<string> {
    return getSignedUrl(
      this.s3Client,
      new PutObjectCommand({ Bucket: this.bucket, Key: key }),
      { expiresIn },
    );
  }

  async getPresignedDownloadUrl(key: string, expiresIn = 3600): Promise<string> {
    return getSignedUrl(
      this.s3Client,
      new GetObjectCommand({ Bucket: this.bucket, Key: key }),
      { expiresIn },
    );
  }

  async deleteObject(key: string): Promise<void> {
    await this.s3Client.send(
      new DeleteObjectCommand({ Bucket: this.bucket, Key: key }),
    );
    this.logger.log(`Deleted ${key} from S3`);
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
      const chunks: Buffer[] = [];
      https.get(url, (response) => {
        response.on('data', (chunk: Buffer) => chunks.push(chunk));
        response.on('end', () => resolve(Buffer.concat(chunks)));
        response.on('error', reject);
      });
    });
  }
}
