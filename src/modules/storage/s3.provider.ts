import { Provider } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { S3Client } from '@aws-sdk/client-s3';

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
