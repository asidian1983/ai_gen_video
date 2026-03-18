/**
 * AI Service Contract
 *
 * Defines the stable interface for the AI generation domain.
 * The Queue/Worker service depends on this contract, not on provider
 * implementations — allows swapping FakeVideoProvider → OpenAI → any future
 * provider without touching the processor.
 */

export interface GenerateVideoParams {
  prompt: string;
  negativePrompt?: string;
  width?: number;
  height?: number;
  fps?: number;
  model?: string;
}

export interface GenerateVideoResult {
  jobId: string;
  status: 'processing' | 'completed' | 'failed';
  videoUrl?: string;
  thumbnailUrl?: string;
  estimatedDurationMs?: number;
  alreadyStored?: boolean;
}

export interface IAiService {
  generateVideo(params: GenerateVideoParams, videoId?: string): Promise<GenerateVideoResult>;
  getGenerationStatus(jobId: string): Promise<GenerateVideoResult>;
  enhancePrompt(prompt: string): Promise<string>;
}
