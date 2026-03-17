import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class VideoFileMetaDto {
  @ApiProperty({ example: 'video/mp4' })
  contentType: string;

  @ApiProperty({ example: 104857600, description: 'File size in bytes' })
  sizeBytes: number;

  @ApiProperty({ example: 8, description: 'Duration in seconds' })
  durationSeconds: number;

  @ApiProperty({ example: 1024 })
  width: number;

  @ApiProperty({ example: 576 })
  height: number;

  @ApiProperty({ example: 24 })
  fps: number;
}

export class VideoResultDto {
  @ApiProperty({ example: '550e8400-e29b-41d4-a716-446655440000' })
  videoId: string;

  @ApiProperty({
    example:
      'https://bucket.s3.us-east-1.amazonaws.com/videos/550e8400/output.mp4?X-Amz-Signature=...',
    description: 'Pre-signed URL for direct download. Valid for `expiresInSeconds`.',
  })
  downloadUrl: string;

  @ApiPropertyOptional({
    example:
      'https://bucket.s3.us-east-1.amazonaws.com/videos/550e8400/thumb.jpg?X-Amz-Signature=...',
    description: 'Pre-signed URL for thumbnail download.',
  })
  thumbnailUrl?: string;

  @ApiProperty({ example: 3600, description: 'Seconds until the URLs expire' })
  expiresInSeconds: number;

  @ApiProperty({ example: '2026-03-17T13:00:00.000Z' })
  expiresAt: string;

  @ApiProperty({ type: () => VideoFileMetaDto })
  file: VideoFileMetaDto;
}
