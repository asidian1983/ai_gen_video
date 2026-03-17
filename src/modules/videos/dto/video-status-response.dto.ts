import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { VideoStatus } from '../enums/video-status.enum';

export class VideoProgressDto {
  @ApiProperty({ example: 65, description: 'Percentage 0–100' })
  percent: number;

  @ApiProperty({ example: 'Rendering frames 1560/2400' })
  message: string;

  @ApiPropertyOptional({ example: 42, description: 'Estimated seconds remaining' })
  estimatedSecondsRemaining?: number;
}

export class VideoStatusResponseDto {
  @ApiProperty({ example: '550e8400-e29b-41d4-a716-446655440000' })
  id: string;

  @ApiProperty({ enum: VideoStatus, example: VideoStatus.PROCESSING })
  status: VideoStatus;

  @ApiPropertyOptional({
    example: '42',
    description: 'BullMQ job ID. Use with GET /queue/jobs/:jobId for raw queue state.',
  })
  queueJobId?: string;

  @ApiProperty({ example: '2026-03-17T12:00:00.000Z' })
  createdAt: Date;

  @ApiProperty({ example: '2026-03-17T12:00:45.000Z' })
  updatedAt: Date;

  @ApiPropertyOptional({ type: () => VideoProgressDto })
  progress?: VideoProgressDto;

  @ApiPropertyOptional({ example: 'Provider timeout after 300s' })
  errorMessage?: string;

  @ApiProperty({
    example: true,
    description: 'Whether GET /videos/:id/result is now available',
  })
  resultReady: boolean;

  static from(video: any): VideoStatusResponseDto {
    const dto = new VideoStatusResponseDto();
    dto.id = video.id;
    dto.status = video.status;
    dto.queueJobId = video.queueJobId ?? undefined;
    dto.createdAt = video.createdAt;
    dto.updatedAt = video.updatedAt;
    dto.errorMessage = video.errorMessage ?? undefined;
    dto.resultReady = video.status === VideoStatus.COMPLETED;

    if (video.status === VideoStatus.PROCESSING) {
      dto.progress = {
        percent: video.metadata?.progressPercent ?? 0,
        message: video.metadata?.progressMessage ?? 'Processing…',
        estimatedSecondsRemaining: video.metadata?.estimatedSecondsRemaining,
      };
    }

    return dto;
  }
}
