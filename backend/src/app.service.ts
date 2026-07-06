import { Injectable } from '@nestjs/common';
import { PrismaService } from './lib/prisma.service.js';
import { RedisService } from './lib/redis.service.js';

@Injectable()
export class AppService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  async checkHealth() {
    let dbStatus = 'up';
    let redisStatus = 'up';
    let dbError: string | undefined;
    let redisError: string | undefined;

    try {
      await this.prisma.$queryRaw`SELECT 1`;
    } catch (error) {
      dbStatus = 'down';
      dbError = error instanceof Error ? error.message : String(error);
    }

    try {
      await this.redis.ping();
    } catch (error) {
      redisStatus = 'down';
      redisError = error instanceof Error ? error.message : String(error);
    }

    const isHealthy = dbStatus === 'up' && redisStatus === 'up';

    return {
      status: isHealthy ? 'healthy' : 'unhealthy',
      database: dbStatus,
      redis: redisStatus,
      timestamp: new Date().toISOString(),
      ...(dbError && { databaseError: dbError }),
      ...(redisError && { redisError: redisError }),
    };
  }
}
