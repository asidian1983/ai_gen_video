import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  MessageBody,
  ConnectedSocket,
  OnGatewayInit,
  OnGatewayConnection,
  OnGatewayDisconnect,
  WsException,
} from '@nestjs/websockets';
import { Logger, UsePipes, ValidationPipe } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { Server, Socket } from 'socket.io';
import { ChatService } from './chat.service';
import { JoinRoomDto } from './dto/join-room.dto';
import { SendMessageDto } from './dto/send-message.dto';
import { JwtPayload } from '../auth/interfaces/jwt-payload.interface';

/**
 * Secure Chat Gateway — JWT-authenticated Socket.IO namespace.
 *
 * Authentication flow:
 *   1. Client sends token in handshake:  { auth: { token: '<access_token>' } }
 *   2. Server middleware verifies token before the connection is established.
 *   3. Verified payload is attached to socket.data.user for all subsequent handlers.
 *   4. Unauthenticated sockets are disconnected before any event fires.
 *
 * Protocol:
 *   client → server  : 'join_room'    { room }
 *   client → server  : 'leave_room'   { room }
 *   client → server  : 'send_message' { room, content }
 *   server → client  : 'message'      MessagePayload
 *   server → client  : 'history'      MessagePayload[]   (on join)
 *   server → client  : 'error'        { message }
 */
@WebSocketGateway({
  namespace: '/chat',
  cors: { origin: process.env.CORS_ORIGIN ?? '*', credentials: true },
})
export class ChatGateway
  implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect
{
  @WebSocketServer()
  private readonly server: Server;

  private readonly logger = new Logger(ChatGateway.name);

  constructor(
    private readonly chatService: ChatService,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
  ) {}

  // ── Lifecycle ─────────────────────────────────────────────────────────────

  /**
   * Register JWT middleware on the Socket.IO server.
   * Runs once after the gateway initialises — before any client connects.
   * Rejects the handshake (never emits token to client) on invalid/missing token.
   */
  afterInit(server: Server) {
    server.use((socket: Socket, next) => {
      const token = socket.handshake.auth?.token as string | undefined;
      if (!token) {
        next(new Error('Unauthorized'));
        return;
      }

      try {
        const payload = this.jwtService.verify<JwtPayload>(token, {
          secret: this.configService.get<string>('jwt.secret'),
        });
        // Attach verified identity — never trust client-supplied user data
        socket.data.user = payload;
        next();
      } catch {
        // Do NOT forward the underlying error — it may contain token internals
        next(new Error('Unauthorized'));
      }
    });

    this.logger.log('Chat gateway initialised with JWT middleware');
  }

  handleConnection(client: Socket) {
    const user = client.data.user as JwtPayload;
    this.logger.log(`Chat connected: ${client.id} (user: ${user.email})`);
  }

  handleDisconnect(client: Socket) {
    this.logger.log(`Chat disconnected: ${client.id}`);
  }

  // ── Event handlers ────────────────────────────────────────────────────────

  /** Join a room and receive the last 50 messages as history. */
  @UsePipes(new ValidationPipe({ whitelist: true }))
  @SubscribeMessage('join_room')
  async handleJoinRoom(
    @MessageBody() dto: JoinRoomDto,
    @ConnectedSocket() client: Socket,
  ) {
    await client.join(dto.room);

    const history = await this.chatService.getRoomHistory(dto.room, 50);
    // Send history in chronological order (query returns DESC)
    client.emit('history', history.reverse());

    this.logger.log(`${client.id} joined room: ${dto.room}`);
    return { event: 'joined', data: { room: dto.room } };
  }

  /** Leave a room. */
  @UsePipes(new ValidationPipe({ whitelist: true }))
  @SubscribeMessage('leave_room')
  handleLeaveRoom(
    @MessageBody() dto: JoinRoomDto,
    @ConnectedSocket() client: Socket,
  ) {
    void client.leave(dto.room);
    return { event: 'left', data: { room: dto.room } };
  }

  /**
   * Send a message to a room.
   *
   * Security: senderId and senderEmail come from the verified JWT payload,
   * NOT from the client payload — clients cannot impersonate another user.
   * Room membership is checked so clients cannot broadcast to unjoined rooms.
   */
  @UsePipes(new ValidationPipe({ whitelist: true }))
  @SubscribeMessage('send_message')
  async handleSendMessage(
    @MessageBody() dto: SendMessageDto,
    @ConnectedSocket() client: Socket,
  ) {
    const user = client.data.user as JwtPayload;

    // Prevent sending to rooms the client never joined
    if (!client.rooms.has(dto.room)) {
      throw new WsException('You must join the room before sending messages');
    }

    const message = await this.chatService.saveMessage(
      user.sub,
      user.email,
      dto.room,
      dto.content,
    );

    const payload = {
      id: message.id,
      room: message.room,
      content: message.content,
      senderId: message.senderId,
      senderEmail: message.senderEmail,
      createdAt: message.createdAt,
    };

    // Broadcast to everyone in the room (including sender)
    this.server.to(dto.room).emit('message', payload);

    return { event: 'message_sent', data: { id: message.id } };
  }
}
