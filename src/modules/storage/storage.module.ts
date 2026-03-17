import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { StorageService } from './storage.service';
import { S3Client } from '@aws-sdk/client-s3';
import { createS3Client } from '../../config/storage.config';

export const S3_CLIENT = 'S3_CLIENT';

@Module({
  providers: [
    {
      provide: S3_CLIENT,
      inject: [ConfigService],
      useFactory: (config: ConfigService): S3Client => createS3Client(config),
    },
    StorageService,
  ],
  exports: [StorageService],
})
export class StorageModule {}
