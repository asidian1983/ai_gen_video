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
}

export interface IAiProvider {
  generateVideo(params: GenerateVideoParams): Promise<GenerateVideoResult>;
  getGenerationStatus(jobId: string): Promise<GenerateVideoResult>;
}
