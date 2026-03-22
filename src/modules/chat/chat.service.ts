import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Message } from './entities/message.entity';

@Injectable()
export class ChatService {
  constructor(
    @InjectRepository(Message)
    private readonly messageRepo: Repository<Message>,
  ) {}

  async saveMessage(
    senderId: string,
    senderEmail: string,
    room: string,
    content: string,
  ): Promise<Message> {
    const message = this.messageRepo.create({ senderId, senderEmail, room, content });
    return this.messageRepo.save(message);
  }

  async getRoomHistory(room: string, limit = 50): Promise<Message[]> {
    return this.messageRepo.find({
      where: { room },
      order: { createdAt: 'DESC' },
      take: limit,
    });
  }
}
