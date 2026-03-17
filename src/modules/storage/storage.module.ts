import { Module } from '@nestjs/common';
import { StorageService } from './storage.service';
import { S3Provider } from './s3.provider';

@Module({
  providers: [S3Provider, StorageService],
  exports: [StorageService],
})
export class StorageModule {}
