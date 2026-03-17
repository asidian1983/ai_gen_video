export interface GenerateVideoParams {
  prompt: string;
  negativePrompt?: string;
  width?: number;
  height?: number;
  fps?: number;
  durationSeconds?: number;
  model?: string;
}

export interface GenerateVideoResult {
  jobId: string;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  videoUrl?: string;
  thumbnailUrl?: string;
  errorMessage?: string;
  estimatedDurationMs?: number;
  /**
   * When true, the videoUrl is already stored at its final destination.
   * The processor should skip the S3 re-upload step and use videoUrl directly.
   * Used by FakeVideoProvider and providers that manage their own storage.
   */
  alreadyStored?: boolean;
}

export interface IAiProvider {
  generateVideo(params: GenerateVideoParams): Promise<GenerateVideoResult>;
  getGenerationStatus(jobId: string): Promise<GenerateVideoResult>;
}
