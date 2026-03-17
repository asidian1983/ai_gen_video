import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import OpenAI from 'openai';
import { GenerateVideoParams, GenerateVideoResult } from './interfaces/ai-provider.interface';
import { FakeVideoProvider } from './providers/fake-video.provider';

@Injectable()
export class AiService {
  private readonly logger = new Logger(AiService.name);
  private readonly openai: OpenAI;

  constructor(
    private readonly configService: ConfigService,
    private readonly fakeVideoProvider: FakeVideoProvider,
  ) {
    this.openai = new OpenAI({
      apiKey: this.configService.get<string>('ai.openaiApiKey'),
    });
  }

  /**
   * Submit a video generation job to the AI provider.
   * videoId is passed so the fake provider can generate a unique URL per video.
   *
   * In production: replace with actual provider API call
   *   e.g. const res = await this.runwayClient.generate({ prompt });
   *        return { jobId: res.taskId, status: 'processing' };
   */
  async generateVideo(params: GenerateVideoParams, videoId: string): Promise<GenerateVideoResult> {
    this.logger.log(`Submitting video generation job for videoId: ${videoId}`);
    const provider = this.configService.get<string>('ai.videoProvider', 'fake');
    this.logger.log(`Using AI video provider: ${provider}`);
    return this.fakeVideoProvider.submit(videoId, params);
  }

  /**
   * Poll the AI provider for the status of a submitted job.
   *
   * In production: replace with actual status check
   *   e.g. const res = await this.runwayClient.getTask(jobId);
   *        return { jobId, status: res.status, videoUrl: res.outputUrl };
   */
  async getGenerationStatus(jobId: string): Promise<GenerateVideoResult> {
    return this.fakeVideoProvider.checkStatus(jobId);
  }

  async enhancePrompt(prompt: string): Promise<string> {
    try {
      const completion = await this.openai.chat.completions.create({
        model: 'gpt-4o',
        messages: [
          {
            role: 'system',
            content:
              'You are an expert at writing cinematic video generation prompts. ' +
              'Enhance the user prompt to be more descriptive and cinematic without changing the core intent. ' +
              'Keep the output under 300 words.',
          },
          { role: 'user', content: prompt },
        ],
        max_tokens: 400,
      });
      return completion.choices[0]?.message?.content ?? prompt;
    } catch (error) {
      // Fallback to original prompt when OpenAI is unavailable (e.g. no API key in dev)
      this.logger.warn(`enhancePrompt failed, using original: ${(error as Error).message}`);
      return prompt;
    }
  }
}
