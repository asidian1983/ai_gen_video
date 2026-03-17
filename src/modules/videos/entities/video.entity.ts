import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { VideoStatus } from '../enums/video-status.enum';
import { User } from '../../users/entities/user.entity';

@Entity('videos')
export class Video {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ length: 255 })
  title: string;

  @Column({ type: 'text' })
  prompt: string;

  @Column({ nullable: true, type: 'text' })
  negativePrompt: string;

  @Column({ type: 'enum', enum: VideoStatus, default: VideoStatus.PENDING })
  status: VideoStatus;

  @Column({ nullable: true, length: 1024 })
  videoUrl: string;

  @Column({ nullable: true, length: 1024 })
  thumbnailUrl: string;

  @Column({ nullable: true, type: 'text' })
  errorMessage: string;

  @Column({ nullable: true })
  durationSeconds: number;

  @Column({ nullable: true, default: 1024 })
  width: number;

  @Column({ nullable: true, default: 576 })
  height: number;

  @Column({ nullable: true, default: 24 })
  fps: number;

  @Column({ nullable: true })
  model: string;

  @Column({ type: 'jsonb', nullable: true, default: {} })
  metadata: Record<string, any>;

  @Column()
  userId: string;

  @ManyToOne(() => User, (user) => user.videos, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'userId' })
  user: User;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
