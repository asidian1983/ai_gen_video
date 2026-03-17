import { Module } from '@nestjs/common';
import { BullMQModule } from '@nestjs/bullmq';
import { VideoGenerationProcessor } from './processors/video-generation.processor';
import { QueueService } from './queue.service';
import { QueueController } from './queue.controller';
import { VIDEO_GENERATION_QUEUE } from './constants/queue.constants';
import { VideosModule } from '../videos/videos.module';
import { AiModule } from '../ai/ai.module';
import { StorageModule } from '../storage/storage.module';

@Module({
  imports: [
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
  providers: [VideoGenerationProcessor, QueueService],
  exports: [QueueService],
})
export class QueueModule {}
