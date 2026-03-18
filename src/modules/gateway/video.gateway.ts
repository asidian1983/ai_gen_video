import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  MessageBody,
  ConnectedSocket,
  OnGatewayConnection,
  OnGatewayDisconnect,
} from '@nestjs/websockets';
import { Logger, UseGuards } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { Server, Socket } from 'socket.io';
import {
  VIDEO_EVENTS,
  VideoCreatedEvent,
  VideoProcessingStartedEvent,
  VideoProgressUpdatedEvent,
  VideoCompletedEvent,
  VideoFailedEvent,
} from '../../shared/events/video.events';

/**
 * WebSocket Gateway — real-time video job status push.
 *
 * Clients subscribe to a specific video room and receive progress events
 * without polling. Events originate from VideoGenerationProcessor via
 * EventEmitter2 and are forwarded to the relevant Socket.IO room.
 *
 * Protocol:
 *   client → server  : 'subscribe'   { videoId }
 *   client → server  : 'unsubscribe' { videoId }
 *   server → client  : 'video.created'           VideoCreatedPayload
 *   server → client  : 'video.processing.started' VideoProcessingStartedPayload
 *   server → client  : 'video.progress.updated'  VideoProgressPayload
 *   server → client  : 'video.completed'         VideoCompletedPayload
 *   server → client  : 'video.failed'            VideoFailedPayload
 */
@WebSocketGateway({
  cors: { origin: '*', credentials: true },
  namespace: '/video-status',
})
export class VideoGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  private readonly server: Server;

  private readonly logger = new Logger(VideoGateway.name);

  handleConnection(client: Socket) {
    this.logger.log(`Client connected: ${client.id}`);
  }

  handleDisconnect(client: Socket) {
    this.logger.log(`Client disconnected: ${client.id}`);
  }

  /** Join the room for a specific videoId to receive its status events. */
  @SubscribeMessage('subscribe')
  handleSubscribe(
    @MessageBody() data: { videoId: string },
    @ConnectedSocket() client: Socket,
  ) {
    const room = this.roomName(data.videoId);
    void client.join(room);
    this.logger.log(`Client ${client.id} subscribed to ${room}`);
    return { event: 'subscribed', data: { videoId: data.videoId } };
  }

  /** Leave the room for a specific videoId. */
  @SubscribeMessage('unsubscribe')
  handleUnsubscribe(
    @MessageBody() data: { videoId: string },
    @ConnectedSocket() client: Socket,
  ) {
    const room = this.roomName(data.videoId);
    void client.leave(room);
    return { event: 'unsubscribed', data: { videoId: data.videoId } };
  }

  // ── Domain event listeners ─────────────────────────────────────────────────

  @OnEvent(VIDEO_EVENTS.CREATED)
  onVideoCreated(event: VideoCreatedEvent) {
    this.server.to(this.roomName(event.videoId)).emit(VIDEO_EVENTS.CREATED, {
      videoId: event.videoId,
      queueJobId: event.queueJobId,
    });
  }

  @OnEvent(VIDEO_EVENTS.PROCESSING_STARTED)
  onProcessingStarted(event: VideoProcessingStartedEvent) {
    this.server.to(this.roomName(event.videoId)).emit(VIDEO_EVENTS.PROCESSING_STARTED, {
      videoId: event.videoId,
      attempt: event.jobAttempt,
    });
  }

  @OnEvent(VIDEO_EVENTS.PROGRESS_UPDATED)
  onProgressUpdated(event: VideoProgressUpdatedEvent) {
    this.server.to(this.roomName(event.videoId)).emit(VIDEO_EVENTS.PROGRESS_UPDATED, {
      videoId: event.videoId,
      percent: event.percent,
      message: event.message,
    });
  }

  @OnEvent(VIDEO_EVENTS.COMPLETED)
  onVideoCompleted(event: VideoCompletedEvent) {
    this.server.to(this.roomName(event.videoId)).emit(VIDEO_EVENTS.COMPLETED, {
      videoId: event.videoId,
      videoUrl: event.videoUrl,
      thumbnailUrl: event.thumbnailUrl,
    });
  }

  @OnEvent(VIDEO_EVENTS.FAILED)
  onVideoFailed(event: VideoFailedEvent) {
    this.server.to(this.roomName(event.videoId)).emit(VIDEO_EVENTS.FAILED, {
      videoId: event.videoId,
      errorMessage: event.errorMessage,
      attemptsMade: event.attemptsMade,
    });
  }

  // ── Utility ───────────────────────────────────────────────────────────────

  /** Broadcast to all subscribers of a video — usable by other services. */
  broadcastToVideo(videoId: string, event: string, payload: Record<string, unknown>) {
    this.server.to(this.roomName(videoId)).emit(event, payload);
  }

  private roomName(videoId: string): string {
    return `video:${videoId}`;
  }
}
