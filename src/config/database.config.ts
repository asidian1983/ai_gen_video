import { TypeOrmModuleOptions } from '@nestjs/typeorm';
import { ConfigService } from '@nestjs/config';

export const getDatabaseConfig = (config: ConfigService): TypeOrmModuleOptions => ({
  type: 'postgres',
  host: config.get('database.host'),
  port: config.get<number>('database.port'),
  username: config.get('database.username'),
  password: config.get('database.password'),
  database: config.get('database.database'),
  entities: [__dirname + '/../**/*.entity{.ts,.js}'],
  migrations: [__dirname + '/../migrations/*{.ts,.js}'],
  synchronize: config.get<boolean>('database.synchronize'),
  logging: config.get<boolean>('database.logging'),
});
