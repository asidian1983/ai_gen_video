import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { VideoStatus } from '../enums/video-status.enum';

export class VideoGenerationParamsDto {
  @ApiProperty({ example: 1024 })
  width: number;

  @ApiProperty({ example: 576 })
  height: number;

  @ApiProperty({ example: 24 })
  fps: number;

  @ApiPropertyOptional({ example: 'runway-gen3' })
  model?: string;
}

export class VideoResponseDto {
  @ApiProperty({ example: '550e8400-e29b-41d4-a716-446655440000' })
  id: string;

  @ApiProperty({ example: 'Sunset over the ocean' })
  title: string;

  @ApiProperty({ example: 'A cinematic sunset over calm ocean waves, golden hour, 4K' })
  prompt: string;

  @ApiPropertyOptional({ example: 'blurry, low quality, distorted' })
  negativePrompt?: string;

  @ApiProperty({ enum: VideoStatus, example: VideoStatus.PENDING })
  status: VideoStatus;

  @ApiPropertyOptional({
    example: '42',
    description: 'BullMQ job ID. Use with GET /queue/jobs/:jobId for raw queue state.',
  })
  queueJobId?: string;

  @ApiPropertyOptional({
    example: 'https://bucket.s3.us-east-1.amazonaws.com/videos/550e8400/output.mp4',
  })
  videoUrl?: string;

  @ApiPropertyOptional({
    example: 'https://bucket.s3.us-east-1.amazonaws.com/videos/550e8400/thumb.jpg',
  })
  thumbnailUrl?: string;

  @ApiPropertyOptional({ example: 8 })
  durationSeconds?: number;

  @ApiProperty({ type: () => VideoGenerationParamsDto })
  generationParams: VideoGenerationParamsDto;

  @ApiPropertyOptional({ example: 'Provider timeout after 300s' })
  errorMessage?: string;

  @ApiProperty({ example: '2026-03-17T12:00:00.000Z' })
  createdAt: Date;

  @ApiProperty({ example: '2026-03-17T12:01:30.000Z' })
  updatedAt: Date;

  static from(video: any): VideoResponseDto {
    const dto = new VideoResponseDto();
    dto.id = video.id;
    dto.title = video.title;
    dto.prompt = video.prompt;
    dto.negativePrompt = video.negativePrompt ?? undefined;
    dto.status = video.status;
    dto.queueJobId = video.queueJobId ?? undefined;
    dto.videoUrl = video.videoUrl ?? undefined;
    dto.thumbnailUrl = video.thumbnailUrl ?? undefined;
    dto.durationSeconds = video.durationSeconds ?? undefined;
    dto.errorMessage = video.errorMessage ?? undefined;
    dto.createdAt = video.createdAt;
    dto.updatedAt = video.updatedAt;
    dto.generationParams = {
      width: video.width,
      height: video.height,
      fps: video.fps,
      model: video.model ?? undefined,
    };
    return dto;
  }
}
