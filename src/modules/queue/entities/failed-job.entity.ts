import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
} from 'typeorm';

/**
 * Persists permanently failed BullMQ video-generation jobs (all retries exhausted).
 * Enables post-mortem inspection and manual reprocessing via DLQ endpoints.
 */
@Entity('failed_jobs')
export class FailedJob {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /** Foreign key to videos.id — not a DB constraint to survive cascaded video deletes. */
  @Index()
  @Column({ type: 'varchar' })
  videoId: string;

  /** BullMQ job ID at time of final failure (may have been removed from Redis). */
  @Column({ type: 'varchar', nullable: true })
  queueJobId: string | null;

  /** Full error message from the final failure. */
  @Column({ type: 'text' })
  errorMessage: string;

  /** Original BullMQ job data snapshot — used to re-enqueue on retry. */
  @Column({ type: 'jsonb', default: {} })
  jobData: Record<string, unknown>;

  /** BullMQ job name (e.g. 'generate'). */
  @Column({ type: 'varchar', default: 'generate' })
  jobName: string;

  /** Total attempts made before permanent failure. */
  @Column({ type: 'int' })
  attemptsMade: number;

  /** Whether this failed job has been manually retried. */
  @Column({ type: 'boolean', default: false })
  retried: boolean;

  /** Timestamp of the manual retry, if performed. */
  @Column({ type: 'timestamptz', nullable: true })
  retriedAt: Date | null;

  /** New BullMQ job ID created when retried, for traceability. */
  @Column({ type: 'varchar', nullable: true })
  retryJobId: string | null;

  @CreateDateColumn()
  failedAt: Date;
}
