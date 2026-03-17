import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  OneToMany,
} from 'typeorm';
import { Exclude } from 'class-transformer';
import { UserRole } from '../enums/user-role.enum';
import { Video } from '../../videos/entities/video.entity';

@Entity('users')
export class User {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ length: 50 })
  firstName: string;

  @Column({ length: 50 })
  lastName: string;

  @Column({ unique: true, length: 255 })
  email: string;

  @Column({ nullable: true, unique: true, length: 30 })
  username: string;

  @Column()
  @Exclude()
  password: string;

  @Column({ type: 'enum', enum: UserRole, default: UserRole.USER })
  role: UserRole;

  @Column({ default: true })
  isActive: boolean;

  @OneToMany(() => Video, (video) => video.user)
  videos: Video[];

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
