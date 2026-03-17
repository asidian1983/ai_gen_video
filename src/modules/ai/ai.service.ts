import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import OpenAI from 'openai';
import { GenerateVideoParams, GenerateVideoResult } from './interfaces/ai-provider.interface';

@Injectable()
export class AiService {
  private readonly logger = new Logger(AiService.name);
  private readonly openai: OpenAI;

  constructor(private readonly configService: ConfigService) {
    this.openai = new OpenAI({
      apiKey: this.configService.get<string>('ai.openaiApiKey'),
    });
  }

  async generateVideo(params: GenerateVideoParams): Promise<GenerateVideoResult> {
    this.logger.log(`Starting video generation for prompt: "${params.prompt.slice(0, 80)}..."`);

    // NOTE: OpenAI does not yet have a video generation API.
    // This is a placeholder that demonstrates the pattern.
    // Replace with your actual AI video provider (RunwayML, Stability AI, etc.)
    try {
      const provider = this.configService.get<string>('ai.videoProvider');
      this.logger.log(`Using AI video provider: ${provider}`);

      // Simulate async generation job submission
      // In production, replace with actual API call:
      //   const response = await this.runwayClient.generate({ prompt: params.prompt });
      //   return { jobId: response.taskId, status: 'processing' };

      return {
        jobId: `mock-job-${Date.now()}`,
        status: 'processing',
        estimatedDurationMs: 60000,
      };
    } catch (error) {
      this.logger.error('AI video generation failed', error);
      throw error;
    }
  }

  async getGenerationStatus(jobId: string): Promise<GenerateVideoResult> {
    // Poll the AI provider for status
    // Replace with actual provider status check
    this.logger.log(`Polling status for job: ${jobId}`);
    return { jobId, status: 'completed', videoUrl: undefined };
  }

  async enhancePrompt(prompt: string): Promise<string> {
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
  }
}
