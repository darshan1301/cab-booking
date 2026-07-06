import { Module } from '@nestjs/common';
import { RidesService } from './rides.service.js';
import { RidesController } from './rides.controller.js';
import { PrismaService } from '../lib/prisma.service.js';
import { RedisService } from '../lib/redis.service.js';

@Module({
  controllers: [RidesController],
  providers: [RidesService, PrismaService, RedisService],
})
export class RidesModule {}
