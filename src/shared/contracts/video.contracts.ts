/**
 * Video Service Contract
 *
 * Defines the public interface that any Video Service implementation must satisfy.
 * Consuming services (Queue, Worker) depend on this interface — not on the concrete
 * VideosService class — enforcing loose coupling and enabling independent deployment.
 */

import { VideoStatus } from '../../modules/videos/enums/video-status.enum';

export interface VideoStatusUpdate {
  videoUrl?: string;
  thumbnailUrl?: string;
  errorMessage?: string;
  metadata?: Record<string, any>;
}

export interface IVideoService {
  findById(id: string): Promise<VideoRecord>;
  updateStatus(
    id: string,
    status: VideoStatus,
    extra?: VideoStatusUpdate,
  ): Promise<VideoRecord>;
}

export interface VideoRecord {
  id: string;
  title: string;
  prompt: string;
  negativePrompt?: string;
  status: VideoStatus;
  videoUrl?: string;
  thumbnailUrl?: string;
  errorMessage?: string;
  width: number;
  height: number;
  fps: number;
  model?: string;
  queueJobId?: string;
  metadata?: Record<string, any>;
  userId: string;
}
