import { Module } from '@nestjs/common';
import { VideoGateway } from './video.gateway';

@Module({
  providers: [VideoGateway],
  exports: [VideoGateway],
})
export class GatewayModule {}
