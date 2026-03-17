import { JwtModuleOptions } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';

export const getJwtConfig = (config: ConfigService): JwtModuleOptions => ({
  secret: config.get<string>('jwt.secret'),
  signOptions: {
    expiresIn: config.get<string>('jwt.expiresIn'),
  },
});
