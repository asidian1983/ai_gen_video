export default () => ({
  app: {
    nodeEnv: process.env.NODE_ENV ?? 'development',
    port: parseInt(process.env.PORT ?? '3000', 10),
    apiPrefix: process.env.API_PREFIX ?? 'api/v1',
    corsOrigin: process.env.CORS_ORIGIN ?? '*',
    throttleTtl: parseInt(process.env.THROTTLE_TTL ?? '60', 10),
    throttleLimit: parseInt(process.env.THROTTLE_LIMIT ?? '100', 10),
  },
  database: {
    host: process.env.DB_HOST ?? 'localhost',
    port: parseInt(process.env.DB_PORT ?? '5432', 10),
    username: process.env.DB_USERNAME ?? 'postgres',
    password: process.env.DB_PASSWORD ?? 'postgres',
    database: process.env.DB_DATABASE ?? 'ai_gen_video',
    synchronize: process.env.DB_SYNCHRONIZE === 'true',
    logging: process.env.DB_LOGGING === 'true',
  },
  jwt: {
    secret: process.env.JWT_SECRET ?? 'change-me-in-production',
    expiresIn: process.env.JWT_EXPIRES_IN ?? '7d',
    refreshSecret: process.env.JWT_REFRESH_SECRET ?? 'change-refresh-in-production',
    refreshExpiresIn: process.env.JWT_REFRESH_EXPIRES_IN ?? '30d',
  },
  redis: {
    host: process.env.REDIS_HOST ?? 'localhost',
    port: parseInt(process.env.REDIS_PORT ?? '6379', 10),
    password: process.env.REDIS_PASSWORD ?? '',
  },
  storage: {
    region: process.env.AWS_REGION ?? 'us-east-1',
    accessKeyId: process.env.AWS_ACCESS_KEY_ID ?? '',
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY ?? '',
    bucket: process.env.AWS_S3_BUCKET ?? 'ai-gen-video-storage',
    endpoint: process.env.AWS_S3_ENDPOINT ?? undefined,
  },
  ai: {
    openaiApiKey: process.env.OPENAI_API_KEY ?? '',
    videoProvider: process.env.AI_VIDEO_PROVIDER ?? 'openai',
    videoApiKey: process.env.AI_VIDEO_API_KEY ?? '',
    videoApiUrl: process.env.AI_VIDEO_API_URL ?? '',
  },
});
