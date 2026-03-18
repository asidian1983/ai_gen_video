import { NestFactory } from '@nestjs/core';
import { WorkerAppModule } from './worker-app.module';
import { WINSTON_MODULE_NEST_PROVIDER } from 'nest-winston';

async function bootstrapWorker() {
  // createApplicationContext starts no HTTP server — BullMQ workers are event-driven
  const app = await NestFactory.createApplicationContext(WorkerAppModule, {
    bufferLogs: true,
  });

  const logger = app.get(WINSTON_MODULE_NEST_PROVIDER);
  app.useLogger(logger);

  // Graceful shutdown on SIGTERM / SIGINT (Docker stop)
  const shutdown = async (signal: string) => {
    logger.log(`Received ${signal}, shutting down worker gracefully...`, 'WorkerBootstrap');
    await app.close();
    process.exit(0);
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

  logger.log('Worker process started — listening for video generation jobs', 'WorkerBootstrap');
}

bootstrapWorker();
