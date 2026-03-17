import { Processor, WorkerHost, OnWorkerActive, OnWorkerCompleted, OnWorkerFailed } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { VideosService } from '../../videos/videos.service';
import { AiService } from '../../ai/ai.service';
import { StorageService } from '../../storage/storage.service';
import { VideoStatus } from '../../videos/enums/video-status.enum';
import { VIDEO_GENERATION_QUEUE, VideoJobName } from '../constants/queue.constants';

interface VideoGenerationJobData {
  videoId: string;
}

@Processor(VIDEO_GENERATION_QUEUE)
export class VideoGenerationProcessor extends WorkerHost {
  private readonly logger = new Logger(VideoGenerationProcessor.name);

  constructor(
    private readonly videosService: VideosService,
    private readonly aiService: AiService,
    private readonly storageService: StorageService,
  ) {
    super();
  }

  async process(job: Job<VideoGenerationJobData>): Promise<void> {
    switch (job.name) {
      case VideoJobName.GENERATE:
        return this.handleVideoGeneration(job);
      default:
        this.logger.warn(`Unknown job name: ${job.name}`);
    }
  }

  private async handleVideoGeneration(job: Job<VideoGenerationJobData>): Promise<void> {
    const { videoId } = job.data;
    this.logger.log(`Processing video generation job ${job.id} for videoId: ${videoId} (attempt ${job.attemptsMade + 1}/${job.opts.attempts ?? 1})`);

    const maxAttempts = job.opts.attempts ?? 1;
    const isFinalAttempt = job.attemptsMade >= maxAttempts - 1;

    try {
      const video = await this.videosService.findById(videoId);

      // Mark as processing and record progress in metadata
      await this.videosService.updateStatus(videoId, VideoStatus.PROCESSING, {
        metadata: { progressPercent: 10, progressMessage: 'Starting generation...' },
      });
      await job.updateProgress(10);

      // Enhance prompt with AI
      const enhancedPrompt = await this.aiService.enhancePrompt(video.prompt);
      await this.videosService.updateStatus(videoId, VideoStatus.PROCESSING, {
        metadata: { progressPercent: 20, progressMessage: 'Prompt enhanced, submitting to AI provider...' },
      });
      await job.updateProgress(20);

      // Submit to AI provider (pass videoId for fake URL generation in simulation mode)
      const generationResult = await this.aiService.generateVideo({
        prompt: enhancedPrompt,
        negativePrompt: video.negativePrompt,
        width: video.width,
        height: video.height,
        fps: video.fps,
        model: video.model,
      }, videoId);
      await this.videosService.updateStatus(videoId, VideoStatus.PROCESSING, {
        metadata: {
          progressPercent: 40,
          progressMessage: 'Job submitted, waiting for AI provider...',
          aiJobId: generationResult.jobId,
          estimatedSecondsRemaining: generationResult.estimatedDurationMs
            ? Math.ceil(generationResult.estimatedDurationMs / 1000)
            : undefined,
        },
      });
      await job.updateProgress(40);

      // Poll AI provider for completion
      let status = generationResult.status;
      let pollAttempts = 0;
      const maxPollAttempts = 30;

      while (status === 'processing' && pollAttempts < maxPollAttempts) {
        await new Promise((resolve) => setTimeout(resolve, 10_000));
        const result = await this.aiService.getGenerationStatus(generationResult.jobId);
        status = result.status;
        pollAttempts++;

        const progressPercent = 40 + Math.min(50, pollAttempts * 2);
        const estimatedSecondsRemaining = Math.max(0, (maxPollAttempts - pollAttempts) * 10);
        await this.videosService.updateStatus(videoId, VideoStatus.PROCESSING, {
          metadata: {
            progressPercent,
            progressMessage: `Rendering... (poll ${pollAttempts}/${maxPollAttempts})`,
            estimatedSecondsRemaining,
          },
        });
        await job.updateProgress(progressPercent);

        if (result.videoUrl) {
          // Skip re-upload if the provider already stored the file (e.g. FakeVideoProvider,
          // or a real provider that uploads to its own CDN and returns a final URL).
          const storedUrl = result.alreadyStored
            ? result.videoUrl
            : await this.storageService.uploadFromUrl(
                result.videoUrl,
                `videos/${videoId}/output.mp4`,
              );
          await this.videosService.updateStatus(videoId, VideoStatus.COMPLETED, {
            videoUrl: storedUrl,
            thumbnailUrl: result.thumbnailUrl,
            metadata: { progressPercent: 100, progressMessage: 'Completed' },
          });
          await job.updateProgress(100);
          return;
        }
      }

      throw new Error(`AI provider did not return a video after ${pollAttempts} polling attempts`);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.logger.error(
        `Video generation failed for ${videoId} (attempt ${job.attemptsMade + 1}): ${errorMessage}`,
      );

      // Only persist FAILED status on the last attempt; keep PROCESSING on intermediate failures
      // so the status reflects that a retry is coming.
      if (isFinalAttempt) {
        await this.videosService.updateStatus(videoId, VideoStatus.FAILED, { errorMessage });
      }

      throw error; // BullMQ will retry if attempts remain
    }
  }

  @OnWorkerActive()
  onActive(job: Job) {
    this.logger.log(`Job ${job.id} (${job.name}) became active`);
  }

  @OnWorkerCompleted()
  onCompleted(job: Job) {
    this.logger.log(`Job ${job.id} (${job.name}) completed successfully`);
  }

  @OnWorkerFailed()
  onFailed(job: Job | undefined, error: Error) {
    this.logger.error(
      `Job ${job?.id ?? 'unknown'} (${job?.name ?? '?'}) failed: ${error.message}`,
    );
  }
}
