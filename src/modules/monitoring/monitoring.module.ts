import { MiddlewareConsumer, Module, NestModule, RequestMethod } from '@nestjs/common';
import { BullBoardModule } from '@bull-board/nestjs';
import { BullMQAdapter } from '@bull-board/api/bullMQAdapter';
import { ExpressAdapter } from '@bull-board/express';
import { VIDEO_GENERATION_QUEUE } from '../queue/constants/queue.constants';
import { MonitoringAuthMiddleware } from './monitoring.middleware';

export const BULL_BOARD_ROUTE = '/admin/queues';

/**
 * Serves the Bull Board UI at /admin/queues.
 *
 * The UI is protected by Basic Auth (MONITORING_USER / MONITORING_PASSWORD).
 * Only available in non-production environments by default; gate this import
 * in AppModule with a NODE_ENV check if needed.
 *
 * Access: http://localhost:3000/admin/queues
 */
@Module({
  imports: [
    BullBoardModule.forRoot({
      route: BULL_BOARD_ROUTE,
      adapter: ExpressAdapter,
    }),
    BullBoardModule.forFeature({
      name: VIDEO_GENERATION_QUEUE,
      adapter: BullMQAdapter as any,
    }),
  ],
})
export class MonitoringModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer
      .apply(MonitoringAuthMiddleware)
      .forRoutes({ path: `${BULL_BOARD_ROUTE}*`, method: RequestMethod.ALL });
  }
}
