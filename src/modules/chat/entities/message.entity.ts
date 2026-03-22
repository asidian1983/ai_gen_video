import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
} from 'typeorm';

@Entity('messages')
@Index(['room', 'createdAt'])
export class Message {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /** Content is stored as-is; sanitisation is the client's responsibility. */
  @Column({ length: 1000 })
  content: string;

  /** UUID of the authenticated user who sent the message (from JWT — not client-supplied). */
  @Column('uuid')
  senderId: string;

  /** Sender display email — denormalised from JWT so reads need no join. */
  @Column({ length: 255 })
  senderEmail: string;

  /** Arbitrary room identifier, e.g. "general", "video:uuid", "dm:userA:userB". */
  @Column({ length: 100 })
  room: string;

  @CreateDateColumn()
  createdAt: Date;
}
