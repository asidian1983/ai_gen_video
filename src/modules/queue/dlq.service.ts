import {
  Injectable,
  Logger,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { OnEvent } from '@nestjs/event-emitter';
import { FailedJob } from './entities/failed-job.entity';
import { Video } from '../videos/entities/video.entity';
import { VideoStatus } from '../videos/enums/video-status.enum';
import { VIDEO_EVENTS, VideoFailedEvent } from '../../shared/events/video.events';
import { VIDEO_GENERATION_QUEUE, VideoJobName } from './constants/queue.constants';
import {
  FailedJobDto,
  PaginatedFailedJobsDto,
  RetryFailedJobDto,
} from './dto/failed-job.dto';

@Injectable()
export class DlqService {
  private readonly logger = new Logger(DlqService.name);

  constructor(
    @InjectRepository(FailedJob)
    private readonly failedJobRepo: Repository<FailedJob>,

    @InjectRepository(Video)
    private readonly videoRepo: Repository<Video>,

    @InjectQueue(VIDEO_GENERATION_QUEUE)
    private readonly queue: Queue,
  ) {}

  // ── Domain event listener ─────────────────────────────────────────────────

  /**
   * Captures permanently failed video jobs (all BullMQ retries exhausted)
   * and persists them to the failed_jobs table for inspection and replay.
   */
  @OnEvent(VIDEO_EVENTS.FAILED)
  async onVideoFailed(event: VideoFailedEvent): Promise<void> {
    try {
      // Load video to get queueJobId and original job data snapshot
      const video = await this.videoRepo.findOne({ where: { id: event.videoId } });

      const failedJob = this.failedJobRepo.create({
        videoId: event.videoId,
        queueJobId: video?.queueJobId ?? null,
        errorMessage: event.errorMessage,
        jobName: VideoJobName.GENERATE,
        jobData: { videoId: event.videoId },
        attemptsMade: event.attemptsMade,
        retried: false,
        retriedAt: null,
        retryJobId: null,
      });

      await this.failedJobRepo.save(failedJob);
      this.logger.log(
        `DLQ: captured permanently failed job for video ${event.videoId} (attempts: ${event.attemptsMade})`,
      );
    } catch (err) {
      // Never throw from an event listener — log and continue
      this.logger.error(
        `DLQ: failed to persist failed-job record for video ${event.videoId}: ${String(err)}`,
      );
    }
  }

  // ── Public API ────────────────────────────────────────────────────────────

  /** Returns a paginated list of DLQ records, newest first. */
  async listFailedJobs(page: number, limit: number): Promise<PaginatedFailedJobsDto> {
    const [items, total] = await this.failedJobRepo.findAndCount({
      order: { failedAt: 'DESC' },
      skip: (page - 1) * limit,
      take: limit,
    });

    return {
      items: items.map(this.toDto),
      total,
      page,
      limit,
    };
  }

  /**
   * Manually retries a permanently failed video job:
   * 1. Resets video status → PENDING
   * 2. Enqueues a new BullMQ job
   * 3. Marks the DLQ record as retried
   */
  async retryFailedJob(id: string): Promise<RetryFailedJobDto> {
    const record = await this.failedJobRepo.findOne({ where: { id } });
    if (!record) {
      throw new NotFoundException(`DLQ record ${id} not found`);
    }
    if (record.retried) {
      throw new ConflictException(
        `DLQ record ${id} was already retried at ${record.retriedAt?.toISOString()}`,
      );
    }

    // Reset video status to PENDING so the processor can pick it up
    await this.videoRepo.update(
      { id: record.videoId },
      {
        status: VideoStatus.PENDING,
        errorMessage: null as any,
        metadata: {},
        queueJobId: null as any,
      },
    );

    // Enqueue a fresh BullMQ job
    const job = await this.queue.add(
      VideoJobName.GENERATE,
      { videoId: record.videoId },
      {
        attempts: 3,
        backoff: { type: 'exponential', delay: 5000 },
        removeOnComplete: { count: 100 },
        removeOnFail: { count: 500 },
      },
    );

    const retryJobId = String(job.id);
    const now = new Date();

    // Update the video row with the new queue job ID
    await this.videoRepo.update({ id: record.videoId }, { queueJobId: retryJobId });

    // Mark DLQ record as retried
    await this.failedJobRepo.update(id, {
      retried: true,
      retriedAt: now,
      retryJobId,
    });

    this.logger.log(
      `DLQ: retried video ${record.videoId} — new job ${retryJobId}`,
    );

    return {
      id: record.id,
      retryJobId,
      videoId: record.videoId,
    };
  }

  /** Returns a single DLQ record by its UUID. */
  async getFailedJob(id: string): Promise<FailedJobDto> {
    const record = await this.failedJobRepo.findOne({ where: { id } });
    if (!record) {
      throw new NotFoundException(`DLQ record ${id} not found`);
    }
    return this.toDto(record);
  }

  // ── Utility ───────────────────────────────────────────────────────────────

  private toDto(record: FailedJob): FailedJobDto {
    return {
      id: record.id,
      videoId: record.videoId,
      queueJobId: record.queueJobId,
      errorMessage: record.errorMessage,
      jobName: record.jobName,
      attemptsMade: record.attemptsMade,
      retried: record.retried,
      retriedAt: record.retriedAt?.toISOString() ?? null,
      retryJobId: record.retryJobId,
      failedAt: record.failedAt.toISOString(),
    };
  }
}
