import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class FailedJobDto {
  @ApiProperty({ description: 'DLQ record UUID', example: 'a1b2c3d4-...' })
  id: string;

  @ApiProperty({ description: 'Video ID that failed', example: 'uuid' })
  videoId: string;

  @ApiPropertyOptional({ description: 'Original BullMQ job ID', example: '42' })
  queueJobId: string | null;

  @ApiProperty({ description: 'Final error message' })
  errorMessage: string;

  @ApiProperty({ description: 'BullMQ job name', example: 'generate' })
  jobName: string;

  @ApiProperty({ description: 'Total attempts made', example: 3 })
  attemptsMade: number;

  @ApiProperty({ description: 'Whether a manual retry was requested', example: false })
  retried: boolean;

  @ApiPropertyOptional({ description: 'Timestamp of the retry request' })
  retriedAt: string | null;

  @ApiPropertyOptional({ description: 'New BullMQ job ID from retry' })
  retryJobId: string | null;

  @ApiProperty({ description: 'When the job permanently failed' })
  failedAt: string;
}

export class PaginatedFailedJobsDto {
  @ApiProperty({ type: [FailedJobDto] })
  items: FailedJobDto[];

  @ApiProperty({ example: 10 })
  total: number;

  @ApiProperty({ example: 1 })
  page: number;

  @ApiProperty({ example: 20 })
  limit: number;
}

export class RetryFailedJobDto {
  @ApiProperty({ description: 'DLQ record UUID', example: 'a1b2c3d4-...' })
  id: string;

  @ApiProperty({ description: 'New BullMQ job ID enqueued for retry', example: '99' })
  retryJobId: string;

  @ApiProperty({ description: 'Video ID being retried', example: 'uuid' })
  videoId: string;
}
