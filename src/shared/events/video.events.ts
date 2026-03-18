/**
 * Video Domain Events
 *
 * Events are the MSA communication primitive — services publish facts about
 * what happened; other services react without being directly coupled.
 *
 * In the current monolith, these are handled in-process via EventEmitter2.
 * When services are extracted to separate processes, the same event contracts
 * can be published over a Redis Pub/Sub or Kafka topic with zero contract change.
 */

export const VIDEO_EVENTS = {
  CREATED: 'video.created',
  PROCESSING_STARTED: 'video.processing.started',
  PROGRESS_UPDATED: 'video.progress.updated',
  COMPLETED: 'video.completed',
  FAILED: 'video.failed',
} as const;

export type VideoEventName = (typeof VIDEO_EVENTS)[keyof typeof VIDEO_EVENTS];

export class VideoCreatedEvent {
  constructor(
    public readonly videoId: string,
    public readonly userId: string,
    public readonly prompt: string,
    public readonly queueJobId: string,
  ) {}
}

export class VideoProcessingStartedEvent {
  constructor(
    public readonly videoId: string,
    public readonly jobAttempt: number,
  ) {}
}

export class VideoProgressUpdatedEvent {
  constructor(
    public readonly videoId: string,
    public readonly percent: number,
    public readonly message: string,
  ) {}
}

export class VideoCompletedEvent {
  constructor(
    public readonly videoId: string,
    public readonly videoUrl: string,
    public readonly thumbnailUrl?: string,
  ) {}
}

export class VideoFailedEvent {
  constructor(
    public readonly videoId: string,
    public readonly errorMessage: string,
    public readonly attemptsMade: number,
  ) {}
}
