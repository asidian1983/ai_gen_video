import { Controller, Get, Param } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiParam, ApiResponse } from '@nestjs/swagger';
import { QueueService } from './queue.service';
import { JobStatusDto } from './dto/job-status.dto';

@ApiTags('queue')
@ApiBearerAuth('access-token')
@Controller('queue')
export class QueueController {
  constructor(private readonly queueService: QueueService) {}

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
}
