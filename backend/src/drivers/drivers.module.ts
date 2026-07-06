import { Module } from '@nestjs/common';
import { DriversService } from './drivers.service.js';
import { DriversController } from './drivers.controller.js';
import { PrismaService } from '../lib/prisma.service.js';
import { RedisService } from '../lib/redis.service.js';

@Module({
  controllers: [DriversController],
  providers: [DriversService, PrismaService, RedisService],
})
export class DriversModule {}
