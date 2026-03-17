import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ThrottlerModule } from '@nestjs/throttler';
import { BullModule } from '@nestjs/bull';
import { WinstonModule } from 'nest-winston';
import * as winston from 'winston';
import configuration from './config/configuration';
import { AuthModule } from './modules/auth/auth.module';
import { UsersModule } from './modules/users/users.module';
import { VideosModule } from './modules/videos/videos.module';
import { AiModule } from './modules/ai/ai.module';
import { QueueModule } from './modules/queue/queue.module';
import { StorageModule } from './modules/storage/storage.module';

@Module({
  imports: [
    // Config
    ConfigModule.forRoot({
      isGlobal: true,
      load: [configuration],
      envFilePath: ['.env.local', '.env'],
    }),

    // Logger
    WinstonModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        transports: [
          new winston.transports.Console({
            format: winston.format.combine(
              winston.format.timestamp(),
              winston.format.colorize(),
              winston.format.printf(({ timestamp, level, message, context }) =>
                `${timestamp} [${context ?? 'App'}] ${level}: ${message}`,
              ),
            ),
            silent: config.get('app.nodeEnv') === 'test',
          }),
          new winston.transports.File({
            filename: 'logs/error.log',
            level: 'error',
            format: winston.format.combine(
              winston.format.timestamp(),
              winston.format.json(),
            ),
          }),
          new winston.transports.File({
            filename: 'logs/combined.log',
            format: winston.format.combine(
              winston.format.timestamp(),
              winston.format.json(),
            ),
          }),
        ],
      }),
    }),

    // Database
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        type: 'postgres',
        host: config.get('database.host'),
        port: config.get<number>('database.port'),
        username: config.get('database.username'),
        password: config.get('database.password'),
        database: config.get('database.database'),
        entities: [__dirname + '/**/*.entity{.ts,.js}'],
        migrations: [__dirname + '/migrations/*{.ts,.js}'],
        synchronize: config.get<boolean>('database.synchronize'),
        logging: config.get<boolean>('database.logging'),
        ssl: config.get('app.nodeEnv') === 'production'
          ? { rejectUnauthorized: false }
          : false,
      }),
    }),

    // Rate limiting
    ThrottlerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => [
        {
          ttl: config.get<number>('app.throttleTtl', 60) * 1000,
          limit: config.get<number>('app.throttleLimit', 100),
        },
      ],
    }),

    // Queue
    BullModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        redis: {
          host: config.get('redis.host'),
          port: config.get<number>('redis.port'),
          password: config.get('redis.password') || undefined,
        },
        defaultJobOptions: {
          attempts: 3,
          backoff: { type: 'exponential', delay: 5000 },
          removeOnComplete: 100,
          removeOnFail: 500,
        },
      }),
    }),

    // Feature modules
    AuthModule,
    UsersModule,
    VideosModule,
    AiModule,
    QueueModule,
    StorageModule,
  ],
})
export class AppModule {}
