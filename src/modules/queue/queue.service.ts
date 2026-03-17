import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { VIDEO_GENERATION_QUEUE } from './constants/queue.constants';
import { JobStatusDto } from './dto/job-status.dto';

@Injectable()
export class QueueService {
  constructor(
    @InjectQueue(VIDEO_GENERATION_QUEUE)
    private readonly queue: Queue,
  ) {}

  async getJobStatus(jobId: string): Promise<JobStatusDto> {
    const job = await this.queue.getJob(jobId);
    if (!job) {
      throw new NotFoundException(`Queue job ${jobId} not found`);
    }

    const state = await job.getState();
    const progress = typeof job.progress === 'number' ? job.progress : 0;

    return {
      jobId: String(job.id),
      state,
      progress,
      attemptsMade: job.attemptsMade,
      maxAttempts: job.opts.attempts ?? 1,
      failedReason: job.failedReason || undefined,
      processedOn: job.processedOn ? new Date(job.processedOn).toISOString() : undefined,
      finishedOn: job.finishedOn ? new Date(job.finishedOn).toISOString() : undefined,
    };
  }
}
