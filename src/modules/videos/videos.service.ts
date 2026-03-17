import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  ConflictException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { Video } from './entities/video.entity';
import { CreateVideoDto } from './dto/create-video.dto';
import { UpdateVideoDto } from './dto/update-video.dto';
import { VideoResultDto } from './dto/video-result.dto';
import { PaginatedVideosDto } from './dto/paginated-videos.dto';
import { VideoResponseDto } from './dto/video-response.dto';
import { VideoStatus } from './enums/video-status.enum';
import { User } from '../users/entities/user.entity';
import { StorageService } from '../storage/storage.service';
import { VIDEO_GENERATION_QUEUE, VIDEO_GENERATION_JOB } from '../queue/constants/queue.constants';

const MAX_PRESIGN_TTL = 86400; // 24 hours

@Injectable()
export class VideosService {
  constructor(
    @InjectRepository(Video)
    private readonly videoRepository: Repository<Video>,
    @InjectQueue(VIDEO_GENERATION_QUEUE)
    private readonly videoQueue: Queue,
    private readonly storageService: StorageService,
  ) {}

  async createAndQueue(user: User, dto: CreateVideoDto): Promise<Video> {
    const video = this.videoRepository.create({
      ...dto,
      user,
      userId: user.id,
      status: VideoStatus.PENDING,
    });
    const saved = await this.videoRepository.save(video);
    const job = await this.videoQueue.add(VIDEO_GENERATION_JOB, { videoId: saved.id });
    await this.videoRepository.update(saved.id, { queueJobId: String(job.id) });
    saved.queueJobId = String(job.id);
    return saved;
  }

  async findAllForUser(
    userId: string,
    options: { status?: VideoStatus; page: number; limit: number },
  ): Promise<PaginatedVideosDto> {
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

    const [videos, total] = await query.getManyAndCount();
    const totalPages = Math.ceil(total / limit);

    return {
      items: videos.map(VideoResponseDto.from),
      meta: {
        total,
        page,
        limit,
        totalPages,
        hasNextPage: page < totalPages,
        hasPreviousPage: page > 1,
      },
    };
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

  async getVideoResult(id: string, userId: string, expiresIn: number): Promise<VideoResultDto> {
    const video = await this.findOneForUser(id, userId);

    if (video.status !== VideoStatus.COMPLETED || !video.videoUrl) {
      throw new ConflictException(
        `Video is not yet completed. Current status: ${video.status}`,
      );
    }

    const ttl = Math.min(Math.max(expiresIn, 60), MAX_PRESIGN_TTL);
    const videoKey = this.extractS3Key(video.videoUrl);
    const downloadUrl = await this.storageService.getPresignedDownloadUrl(videoKey, ttl);

    let thumbnailUrl: string | undefined;
    if (video.thumbnailUrl) {
      const thumbKey = this.extractS3Key(video.thumbnailUrl);
      thumbnailUrl = await this.storageService.getPresignedDownloadUrl(thumbKey, ttl);
    }

    return {
      videoId: video.id,
      downloadUrl,
      thumbnailUrl,
      expiresInSeconds: ttl,
      expiresAt: new Date(Date.now() + ttl * 1000).toISOString(),
      file: {
        contentType: 'video/mp4',
        sizeBytes: video.metadata?.sizeBytes ?? 0,
        durationSeconds: video.durationSeconds ?? 0,
        width: video.width,
        height: video.height,
        fps: video.fps,
      },
    };
  }

  async update(id: string, userId: string, dto: UpdateVideoDto): Promise<Video> {
    const video = await this.findOneForUser(id, userId);
    Object.assign(video, dto);
    return this.videoRepository.save(video);
  }

  async updateStatus(
    id: string,
    status: VideoStatus,
    extra?: Partial<Pick<Video, 'videoUrl' | 'thumbnailUrl' | 'errorMessage' | 'durationSeconds' | 'metadata'>>,
  ): Promise<Video> {
    await this.videoRepository.update(id, { status, ...extra });
    return this.findById(id);
  }

  async remove(id: string, userId: string): Promise<void> {
    const video = await this.findOneForUser(id, userId);
    await this.videoRepository.remove(video);
  }

  // Extracts the S3 object key from a full URL
  private extractS3Key(url: string): string {
    try {
      return new URL(url).pathname.replace(/^\/[^/]+\//, ''); // strip /bucket-name/
    } catch {
      return url;
    }
  }
}
