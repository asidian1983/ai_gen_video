import { Module } from '@nestjs/common';
import { AiService } from './ai.service';
import { FakeVideoProvider } from './providers/fake-video.provider';

@Module({
  providers: [AiService, FakeVideoProvider],
  exports: [AiService],
})
export class AiModule {}
