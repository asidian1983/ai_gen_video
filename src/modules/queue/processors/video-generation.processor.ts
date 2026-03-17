import {
  Processor,
  Process,
  OnQueueActive,
  OnQueueCompleted,
  OnQueueFailed,
} from '@nestjs/bull';
import { Logger } from '@nestjs/common';
import { Job } from 'bull';
import { VideosService } from '../../videos/videos.service';
import { AiService } from '../../ai/ai.service';
import { StorageService } from '../../storage/storage.service';
import { VideoStatus } from '../../videos/enums/video-status.enum';
import { VIDEO_GENERATION_QUEUE, VIDEO_GENERATION_JOB } from '../constants/queue.constants';

interface VideoGenerationJobData {
  videoId: string;
}

@Processor(VIDEO_GENERATION_QUEUE)
export class VideoGenerationProcessor {
  private readonly logger = new Logger(VideoGenerationProcessor.name);

  constructor(
    private readonly videosService: VideosService,
    private readonly aiService: AiService,
    private readonly storageService: StorageService,
  ) {}

  @Process(VIDEO_GENERATION_JOB)
  async handleVideoGeneration(job: Job<VideoGenerationJobData>): Promise<void> {
    const { videoId } = job.data;
    this.logger.log(`Processing video generation job for videoId: ${videoId}`);

    try {
      const video = await this.videosService.findById(videoId);

      // Mark as processing
      await this.videosService.updateStatus(videoId, VideoStatus.PROCESSING);
      await job.progress(10);

      // Optionally enhance prompt with AI
      const enhancedPrompt = await this.aiService.enhancePrompt(video.prompt);
      await job.progress(20);

      // Submit to AI provider
      const generationResult = await this.aiService.generateVideo({
        prompt: enhancedPrompt,
        negativePrompt: video.negativePrompt,
        width: video.width,
        height: video.height,
        fps: video.fps,
        model: video.model,
      });
      await job.progress(40);

      // Poll for completion (simplified; use webhooks in production)
      let status = generationResult.status;
      let attempts = 0;
      const maxAttempts = 30;

      while (status === 'processing' && attempts < maxAttempts) {
        await new Promise((resolve) => setTimeout(resolve, 10000));
        const result = await this.aiService.getGenerationStatus(generationResult.jobId);
        status = result.status;
        attempts++;

        const progress = 40 + Math.min(50, attempts * 2);
        await job.progress(progress);

        if (result.videoUrl) {
          // Upload to our storage
          const storedUrl = await this.storageService.uploadFromUrl(
            result.videoUrl,
            `videos/${videoId}/output.mp4`,
          );

          await this.videosService.updateStatus(videoId, VideoStatus.COMPLETED, {
            videoUrl: storedUrl,
            thumbnailUrl: result.thumbnailUrl,
          });
          await job.progress(100);
          return;
        }
      }

      if (status !== 'completed') {
        throw new Error(`Generation timed out or failed after ${attempts} attempts`);
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.logger.error(`Video generation failed for ${videoId}: ${errorMessage}`);
      await this.videosService.updateStatus(videoId, VideoStatus.FAILED, {
        errorMessage,
      });
      throw error;
    }
  }

  @OnQueueActive()
  onActive(job: Job) {
    this.logger.log(`Job ${job.id} (${job.name}) started`);
  }

  @OnQueueCompleted()
  onCompleted(job: Job) {
    this.logger.log(`Job ${job.id} (${job.name}) completed`);
  }

  @OnQueueFailed()
  onFailed(job: Job, error: Error) {
    this.logger.error(`Job ${job.id} (${job.name}) failed: ${error.message}`);
  }
}
