import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class JobStatusDto {
  @ApiProperty({ example: '42' })
  jobId: string;

  @ApiProperty({
    example: 'active',
    description: 'BullMQ job state: waiting | active | completed | failed | delayed | unknown',
  })
  state: string;

  @ApiProperty({ example: 65, description: 'Progress percentage 0–100' })
  progress: number;

  @ApiProperty({ example: 1, description: 'Number of attempts made so far' })
  attemptsMade: number;

  @ApiProperty({ example: 3, description: 'Maximum retry attempts configured' })
  maxAttempts: number;

  @ApiPropertyOptional({ example: 'AI provider timeout', description: 'Reason for last failure' })
  failedReason?: string;

  @ApiPropertyOptional({ example: '2026-03-17T12:00:01.000Z' })
  processedOn?: string;

  @ApiPropertyOptional({ example: '2026-03-17T12:01:30.000Z' })
  finishedOn?: string;
}
