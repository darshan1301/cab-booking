import { Module } from '@nestjs/common';
import { AppController } from './app.controller.js';
import { AppService } from './app.service.js';
import { PrismaService } from './lib/prisma.service.js';
import { RedisService } from './lib/redis.service.js';
import { DriversModule } from './drivers/drivers.module.js';
import { RidesModule } from './rides/rides.module.js';

@Module({
  imports: [DriversModule, RidesModule],
  controllers: [AppController],
  providers: [AppService, PrismaService, RedisService],
})
export class AppModule {}
