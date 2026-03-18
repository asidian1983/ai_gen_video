import { Injectable, Logger, Inject } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import Redis from 'ioredis';
import { Video } from '../videos/entities/video.entity';
import { VideoStatus } from '../videos/enums/video-status.enum';
import { REDIS_CLIENT } from './redis.provider';

const CACHE_TTL_SECONDS = 300; // 5 minutes

const statusKey = (videoId: string) => `video:status:${videoId}`;

interface StatusSnapshot {
  status: VideoStatus;
  progress: number;
  message: string;
  updatedAt: string;
}

// State machine: which target statuses are reachable from each source status
const VALID_TRANSITIONS: Partial<Record<VideoStatus, VideoStatus[]>> = {
  [VideoStatus.PENDING]: [VideoStatus.PROCESSING, VideoStatus.FAILED],
  [VideoStatus.PROCESSING]: [VideoStatus.PROCESSING, VideoStatus.COMPLETED, VideoStatus.FAILED],
};

@Injectable()
export class JobStatusService {
  private readonly logger = new Logger(JobStatusService.name);

  constructor(
    @InjectRepository(Video)
    private readonly videoRepository: Repository<Video>,
    @Inject(REDIS_CLIENT)
    private readonly redis: Redis,
  ) {}

  /**
   * Atomically transition to a new status with optimistic locking.
   *
   * Uses `UPDATE ... WHERE status = :expectedStatus` to ensure only one
   * concurrent worker can win the transition — idempotent and race-safe.
   *
   * Returns true if applied; false if the DB row was already in a different
   * state (stale worker, duplicate delivery, or invalid transition).
   */
  async transitionStatus(
    videoId: string,
    expectedStatus: VideoStatus,
    newStatus: VideoStatus,
    extra?: Partial<Pick<Video, 'videoUrl' | 'thumbnailUrl' | 'metadata'>>,
  ): Promise<boolean> {
    const allowed = VALID_TRANSITIONS[expectedStatus];
    if (!allowed?.includes(newStatus)) {
      this.logger.warn(
        `Rejected invalid transition ${expectedStatus} → ${newStatus} for video ${videoId}`,
      );
      return false;
    }

    const fields: Partial<Video> = { status: newStatus };
    if (extra?.videoUrl !== undefined) fields.videoUrl = extra.videoUrl;
    if (extra?.thumbnailUrl !== undefined) fields.thumbnailUrl = extra.thumbnailUrl;
    if (extra?.metadata !== undefined) fields.metadata = extra.metadata;

    const result = await this.videoRepository
      .createQueryBuilder()
      .update(Video)
      .set(fields)
      .where('id = :id AND status = :expectedStatus', { id: videoId, expectedStatus })
      .execute();

    if (result.affected === 0) {
      this.logger.warn(
        `Optimistic lock miss: video ${videoId} was not '${expectedStatus}' — transition skipped`,
      );
      return false;
    }

    this.logger.log(`Video ${videoId}: ${expectedStatus} → ${newStatus}`);

    const progress = (extra?.metadata?.progressPercent as number) ?? 0;
    const message = (extra?.metadata?.progressMessage as string) ?? '';
    this.writeCache(videoId, newStatus, progress, message).catch((err) =>
      this.logger.warn(`Cache write failed for ${videoId}: ${(err as Error).message}`),
    );

    return true;
  }

  /**
   * Update progress metadata only — no status transition.
   *
   * Guarded to PROCESSING rows so a stale progress update from a previous
   * attempt can never overwrite a terminal state (COMPLETED/FAILED).
   * Last-writer-wins within the PROCESSING window is acceptable.
   */
  async updateProgress(
    videoId: string,
    percent: number,
    message: string,
    additionalMeta?: Record<string, any>,
  ): Promise<void> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const metadata: Record<string, any> = {
      progressPercent: percent,
      progressMessage: message,
      ...additionalMeta,
    };

    await this.videoRepository
      .createQueryBuilder()
      .update(Video)
      .set({ metadata })
      .where('id = :id AND status = :status', { id: videoId, status: VideoStatus.PROCESSING })
      .execute();

    this.writeCache(videoId, VideoStatus.PROCESSING, percent, message).catch((err) =>
      this.logger.warn(`Progress cache write failed for ${videoId}: ${(err as Error).message}`),
    );
  }

  /**
   * Force-write FAILED status with no optimistic guard.
   *
   * Used only on the final BullMQ retry attempt, where the status must
   * always become FAILED regardless of any intermediate race.
   */
  async markFailed(videoId: string, errorMessage: string): Promise<void> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await this.videoRepository.update(videoId, {
      status: VideoStatus.FAILED,
      errorMessage,
      metadata: { progressPercent: 0, progressMessage: 'Failed' } as Record<string, any>,
    });
    this.logger.log(`Video ${videoId} marked FAILED: ${errorMessage}`);
    await this.evictCache(videoId);
  }

  /**
   * Fast status read: Redis cache first, DB fallback with cache backfill.
   */
  async getCachedStatus(videoId: string): Promise<StatusSnapshot | null> {
    try {
      const raw = await this.redis.get(statusKey(videoId));
      if (raw) return JSON.parse(raw) as StatusSnapshot;
    } catch (err) {
      this.logger.warn(`Cache read error for ${videoId}: ${(err as Error).message}`);
    }
    return this.loadFromDb(videoId);
  }

  async evictCache(videoId: string): Promise<void> {
    try {
      await this.redis.del(statusKey(videoId));
    } catch (err) {
      this.logger.warn(`Cache eviction error for ${videoId}: ${(err as Error).message}`);
    }
  }

  private async writeCache(
    videoId: string,
    status: VideoStatus,
    progress: number,
    message: string,
  ): Promise<void> {
    const snapshot: StatusSnapshot = {
      status,
      progress,
      message,
      updatedAt: new Date().toISOString(),
    };
    await this.redis.set(statusKey(videoId), JSON.stringify(snapshot), 'EX', CACHE_TTL_SECONDS);
  }

  private async loadFromDb(videoId: string): Promise<StatusSnapshot | null> {
    try {
      const video = await this.videoRepository.findOne({
        where: { id: videoId },
        select: ['id', 'status', 'metadata'],
      });
      if (!video) return null;

      const snapshot: StatusSnapshot = {
        status: video.status,
        progress: (video.metadata?.progressPercent as number) ?? 0,
        message: (video.metadata?.progressMessage as string) ?? '',
        updatedAt: new Date().toISOString(),
      };
      await this.redis.set(
        statusKey(videoId),
        JSON.stringify(snapshot),
        'EX',
        CACHE_TTL_SECONDS,
      );
      return snapshot;
    } catch (err) {
      this.logger.warn(`DB fallback failed for ${videoId}: ${(err as Error).message}`);
      return null;
    }
  }
}
