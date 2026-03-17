import { ConfigService } from '@nestjs/config';

export const getRedisConfig = (config: ConfigService) => ({
  host: config.get<string>('redis.host'),
  port: config.get<number>('redis.port'),
  password: config.get<string>('redis.password') || undefined,
});
