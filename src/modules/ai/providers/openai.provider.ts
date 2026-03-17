import { Provider } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import OpenAI from 'openai';

export const OPENAI_CLIENT = 'OPENAI_CLIENT';

export const OpenAiProvider: Provider = {
  provide: OPENAI_CLIENT,
  inject: [ConfigService],
  useFactory: (configService: ConfigService) =>
    new OpenAI({ apiKey: configService.get<string>('ai.openaiApiKey') }),
};
