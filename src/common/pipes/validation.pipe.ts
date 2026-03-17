import { ValidationPipe as NestValidationPipe } from '@nestjs/common';

export const createValidationPipe = () =>
  new NestValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
    transformOptions: { enableImplicitConversion: true },
  });
