import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { GenerateVideoParams, GenerateVideoResult } from '../interfaces/ai-provider.interface';

interface FakeJobState {
  videoId: string;
  params: GenerateVideoParams;
  startedAt: number;
  completionDelayMs: number;
}

/**
 * FakeVideoProvider — in-memory AI video generation simulator.
 *
 * Simulates the async lifecycle of a real AI video provider:
 *   submit() → job starts (status: 'processing')
 *   checkStatus() → returns 'processing' until delay elapses, then 'completed' + fake URL
 *
 * Configure delay via AI_SIMULATION_DELAY_MS (default: 5000 ms).
 * Set alreadyStored: true so the processor skips the S3 re-upload step.
 */
@Injectable()
export class FakeVideoProvider {
  private readonly logger = new Logger(FakeVideoProvider.name);
  private readonly jobs = new Map<string, FakeJobState>();
  private readonly defaultDelayMs: number;

  constructor(private readonly configService: ConfigService) {
    this.defaultDelayMs = this.configService.get<number>('ai.simulationDelayMs') ?? 5_000;
  }

  /**
   * Register a new fake job and immediately return a 'processing' result.
   * The job will be "completed" once checkStatus() is called after the delay elapses.
   */
  submit(videoId: string, params: GenerateVideoParams): GenerateVideoResult {
    const jobId = `fake-${videoId}-${Date.now()}`;
    this.jobs.set(jobId, {
      videoId,
      params,
      startedAt: Date.now(),
      completionDelayMs: this.defaultDelayMs,
    });

    this.logger.log(
      `[FakeVideoProvider] Job ${jobId} submitted. Will complete in ${this.defaultDelayMs}ms.`,
    );

    return {
      jobId,
      status: 'processing',
      estimatedDurationMs: this.defaultDelayMs,
    };
  }

  /**
   * Check the status of a fake job.
   * Returns 'processing' until the configured delay has elapsed,
   * then returns 'completed' with a fake video URL.
   */
  checkStatus(jobId: string): GenerateVideoResult {
    const state = this.jobs.get(jobId);

    if (!state) {
      this.logger.warn(`[FakeVideoProvider] Job ${jobId} not found in memory.`);
      return { jobId, status: 'failed', errorMessage: 'Job not found in simulator' };
    }

    const elapsed = Date.now() - state.startedAt;
    const isComplete = elapsed >= state.completionDelayMs;

    this.logger.log(
      `[FakeVideoProvider] Job ${jobId} — elapsed: ${elapsed}ms / delay: ${state.completionDelayMs}ms — complete: ${isComplete}`,
    );

    if (!isComplete) {
      return { jobId, status: 'processing' };
    }

    // Clean up after completion
    this.jobs.delete(jobId);

    return {
      jobId,
      status: 'completed',
      videoUrl: this.buildVideoUrl(state.videoId),
      thumbnailUrl: this.buildThumbnailUrl(state.videoId),
      alreadyStored: true, // Tell the processor to skip S3 re-upload
    };
  }

  private buildVideoUrl(videoId: string): string {
    return `https://fake-cdn.example.com/videos/${videoId}/output.mp4`;
  }

  private buildThumbnailUrl(videoId: string): string {
    return `https://fake-cdn.example.com/videos/${videoId}/thumb.jpg`;
  }
}
