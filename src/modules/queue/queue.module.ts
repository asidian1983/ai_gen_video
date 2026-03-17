import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bull';
import { VideoGenerationProcessor } from './processors/video-generation.processor';
import { VIDEO_GENERATION_QUEUE } from './constants/queue.constants';
import { VideosModule } from '../videos/videos.module';
import { AiModule } from '../ai/ai.module';
import { StorageModule } from '../storage/storage.module';

@Module({
  imports: [
    BullModule.registerQueue({ name: VIDEO_GENERATION_QUEUE }),
    VideosModule,
    AiModule,
    StorageModule,
  ],
  providers: [VideoGenerationProcessor],
})
export class QueueModule {}
