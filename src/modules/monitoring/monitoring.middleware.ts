import { Injectable, NestMiddleware } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Request, Response, NextFunction } from 'express';

/**
 * Basic-Auth middleware protecting the Bull Board UI at /admin/queues.
 * Credentials are configured via MONITORING_USER / MONITORING_PASSWORD env vars.
 * Defaults to admin/admin in development — override in production.
 */
@Injectable()
export class MonitoringAuthMiddleware implements NestMiddleware {
  private readonly user: string;
  private readonly password: string;

  constructor(configService: ConfigService) {
    this.user = configService.get<string>('app.monitoringUser', 'admin');
    this.password = configService.get<string>('app.monitoringPassword', 'admin');
  }

  use(req: Request, res: Response, next: NextFunction): void {
    const authHeader = req.headers['authorization'];

    if (!authHeader?.startsWith('Basic ')) {
      res.set('WWW-Authenticate', 'Basic realm="Queue Monitoring"');
      res.status(401).json({ message: 'Queue monitoring requires Basic Auth' });
      return;
    }

    const decoded = Buffer.from(authHeader.slice(6), 'base64').toString('utf8');
    const colonIdx = decoded.indexOf(':');
    const user = decoded.slice(0, colonIdx);
    const password = decoded.slice(colonIdx + 1);

    if (user !== this.user || password !== this.password) {
      res.set('WWW-Authenticate', 'Basic realm="Queue Monitoring"');
      res.status(401).json({ message: 'Invalid monitoring credentials' });
      return;
    }

    next();
  }
}
