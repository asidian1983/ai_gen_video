import {
  Injectable,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { InjectQueue } from '@nestjs/bull';
import { Queue } from 'bull';
import { Video } from './entities/video.entity';
import { CreateVideoDto } from './dto/create-video.dto';
import { UpdateVideoDto } from './dto/update-video.dto';
import { VideoStatus } from './enums/video-status.enum';
import { User } from '../users/entities/user.entity';
import { VIDEO_GENERATION_QUEUE, VIDEO_GENERATION_JOB } from '../queue/constants/queue.constants';

@Injectable()
export class VideosService {
  constructor(
    @InjectRepository(Video)
    private readonly videoRepository: Repository<Video>,
    @InjectQueue(VIDEO_GENERATION_QUEUE)
    private readonly videoQueue: Queue,
  ) {}

  async createAndQueue(user: User, dto: CreateVideoDto): Promise<Video> {
    const video = this.videoRepository.create({
      ...dto,
      user,
      userId: user.id,
      status: VideoStatus.PENDING,
    });
    const saved = await this.videoRepository.save(video);

    await this.videoQueue.add(VIDEO_GENERATION_JOB, { videoId: saved.id });

    return saved;
  }

  async findAllForUser(
    userId: string,
    options: { status?: VideoStatus; page: number; limit: number },
  ) {
    const { status, page, limit } = options;
    const query = this.videoRepository
      .createQueryBuilder('video')
      .where('video.userId = :userId', { userId })
      .orderBy('video.createdAt', 'DESC')
      .skip((page - 1) * limit)
      .take(limit);

    if (status) {
      query.andWhere('video.status = :status', { status });
    }

    const [items, total] = await query.getManyAndCount();
    return { items, total, page, limit, totalPages: Math.ceil(total / limit) };
  }

  async findOneForUser(id: string, userId: string): Promise<Video> {
    const video = await this.videoRepository.findOne({ where: { id } });
    if (!video) throw new NotFoundException(`Video ${id} not found`);
    if (video.userId !== userId) throw new ForbiddenException();
    return video;
  }

  async findById(id: string): Promise<Video> {
    const video = await this.videoRepository.findOne({ where: { id } });
    if (!video) throw new NotFoundException(`Video ${id} not found`);
    return video;
  }

  async update(id: string, userId: string, dto: UpdateVideoDto): Promise<Video> {
    const video = await this.findOneForUser(id, userId);
    Object.assign(video, dto);
    return this.videoRepository.save(video);
  }

  async updateStatus(
    id: string,
    status: VideoStatus,
    extra?: Partial<Pick<Video, 'videoUrl' | 'thumbnailUrl' | 'errorMessage' | 'durationSeconds'>>,
  ): Promise<Video> {
    await this.videoRepository.update(id, { status, ...extra });
    return this.findById(id);
  }

  async remove(id: string, userId: string): Promise<void> {
    const video = await this.findOneForUser(id, userId);
    await this.videoRepository.remove(video);
  }
}
