import {
  Controller,
  Get,
  Post,
  Param,
  Query,
  ParseIntPipe,
  DefaultValuePipe,
} from '@nestjs/common';
import {
  ApiTags,
  ApiBearerAuth,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiResponse,
} from '@nestjs/swagger';
import { QueueService } from './queue.service';
import { DlqService } from './dlq.service';
import { JobStatusDto } from './dto/job-status.dto';
import {
  FailedJobDto,
  PaginatedFailedJobsDto,
  RetryFailedJobDto,
} from './dto/failed-job.dto';

@ApiTags('queue')
@ApiBearerAuth('access-token')
@Controller('queue')
export class QueueController {
  constructor(
    private readonly queueService: QueueService,
    private readonly dlqService: DlqService,
  ) {}

  /**
   * GET /queue/jobs/:jobId
   * Returns the raw BullMQ job state for a given job ID.
   * The jobId is returned in the video response as `queueJobId`.
   */
  @Get('jobs/:jobId')
  @ApiOperation({
    summary: 'Get queue job status',
    description:
      'Returns the raw BullMQ queue state for a job. ' +
      'Use the `queueJobId` field from POST /videos or GET /videos/:id to look up the job. ' +
      'State values: waiting | active | completed | failed | delayed | unknown.',
  })
  @ApiParam({ name: 'jobId', description: 'BullMQ job ID', example: '42' })
  @ApiResponse({ status: 200, description: 'Job status', type: JobStatusDto })
  @ApiResponse({ status: 404, description: 'Job not found' })
  async getJobStatus(@Param('jobId') jobId: string): Promise<JobStatusDto> {
    return this.queueService.getJobStatus(jobId);
  }

  // ── Dead Letter Queue ─────────────────────────────────────────────────────

  /**
   * GET /queue/failed-jobs
   * Lists permanently failed video jobs captured by the DLQ.
   */
  @Get('failed-jobs')
  @ApiOperation({
    summary: 'List DLQ (permanently failed jobs)',
    description:
      'Returns video generation jobs that exhausted all BullMQ retry attempts. ' +
      'Use POST /queue/failed-jobs/:id/retry to re-enqueue a job.',
  })
  @ApiQuery({ name: 'page', required: false, example: 1, description: 'Page number (1-based)' })
  @ApiQuery({ name: 'limit', required: false, example: 20, description: 'Items per page (max 100)' })
  @ApiResponse({ status: 200, description: 'Paginated DLQ records', type: PaginatedFailedJobsDto })
  async listFailedJobs(
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number,
    @Query('limit', new DefaultValuePipe(20), ParseIntPipe) limit: number,
  ): Promise<PaginatedFailedJobsDto> {
    const safeLimit = Math.min(limit, 100);
    return this.dlqService.listFailedJobs(page, safeLimit);
  }

  /**
   * POST /queue/failed-jobs/:id/retry
   * Resets the video to PENDING and re-enqueues a fresh BullMQ job.
   */
  @Post('failed-jobs/:id/retry')
  @ApiOperation({
    summary: 'Retry a permanently failed job from DLQ',
    description:
      'Resets the associated video status to PENDING and enqueues a new BullMQ job. ' +
      'Can only be called once per DLQ record — use the returned retryJobId to track progress.',
  })
  @ApiParam({ name: 'id', description: 'DLQ record UUID' })
  @ApiResponse({ status: 201, description: 'Job re-enqueued', type: RetryFailedJobDto })
  @ApiResponse({ status: 404, description: 'DLQ record not found' })
  @ApiResponse({ status: 409, description: 'Already retried' })
  async retryFailedJob(@Param('id') id: string): Promise<RetryFailedJobDto> {
    return this.dlqService.retryFailedJob(id);
  }

  /**
   * GET /queue/failed-jobs/:id
   * Returns a single DLQ record by ID.
   */
  @Get('failed-jobs/:id')
  @ApiOperation({ summary: 'Get a single DLQ record' })
  @ApiParam({ name: 'id', description: 'DLQ record UUID' })
  @ApiResponse({ status: 200, description: 'DLQ record', type: FailedJobDto })
  @ApiResponse({ status: 404, description: 'Not found' })
  async getFailedJob(@Param('id') id: string): Promise<FailedJobDto> {
    return this.dlqService.getFailedJob(id);
  }
}
