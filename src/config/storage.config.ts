import { S3Client } from '@aws-sdk/client-s3';
import { ConfigService } from '@nestjs/config';

export const createS3Client = (config: ConfigService): S3Client => {
  const endpoint = config.get<string>('storage.endpoint');
  return new S3Client({
    region: config.get<string>('storage.region'),
    credentials: {
      accessKeyId: config.get<string>('storage.accessKeyId'),
      secretAccessKey: config.get<string>('storage.secretAccessKey'),
    },
    ...(endpoint ? { endpoint, forcePathStyle: true } : {}),
  });
};
