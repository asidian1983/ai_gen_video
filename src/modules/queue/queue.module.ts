import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BullMQModule } from '@nestjs/bullmq';
import { VideoGenerationProcessor } from './processors/video-generation.processor';
import { QueueService } from './queue.service';
import { QueueController } from './queue.controller';
import { JobStatusService } from './job-status.service';
import { DlqService } from './dlq.service';
import { RedisProvider } from './redis.provider';
import { VIDEO_GENERATION_QUEUE } from './constants/queue.constants';
import { VideosModule } from '../videos/videos.module';
import { AiModule } from '../ai/ai.module';
import { StorageModule } from '../storage/storage.module';
import { Video } from '../videos/entities/video.entity';
import { FailedJob } from './entities/failed-job.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([Video, FailedJob]),
    BullMQModule.registerQueue({
      name: VIDEO_GENERATION_QUEUE,
      defaultJobOptions: {
        attempts: 3,
        backoff: { type: 'exponential', delay: 5000 },
        removeOnComplete: { count: 100 },
        removeOnFail: { count: 500 },
      },
    }),
    VideosModule,
    AiModule,
    StorageModule,
  ],
  controllers: [QueueController],
  providers: [RedisProvider, JobStatusService, DlqService, VideoGenerationProcessor, QueueService],
  exports: [QueueService, JobStatusService, DlqService],
})
export class QueueModule {}
