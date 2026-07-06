import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../lib/prisma.service.js';
import { RedisService } from '../lib/redis.service.js';
import { DriverStatus } from '../generated/prisma/client.js';

@Injectable()
export class DriversService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  async create(name: string) {
    return this.prisma.driver.create({
      data: {
        name,
        status: DriverStatus.OFFLINE,
      },
    });
  }

  async updateStatus(id: string, status: DriverStatus) {
    const driver = await this.prisma.driver.findUnique({ where: { id } });
    if (!driver) {
      throw new NotFoundException(`Driver with ID ${id} not found`);
    }

    const updated = await this.prisma.driver.update({
      where: { id },
      data: { status },
    });

    // If driver is no longer AVAILABLE, remove from active location tracking
    if (status !== DriverStatus.AVAILABLE) {
      await this.redis.zrem('drivers:locations', id);
    }

    return updated;
  }

  async updateLocation(id: string, lat: number, lng: number) {
    const driver = await this.prisma.driver.findUnique({ where: { id } });
    if (!driver) {
      throw new NotFoundException(`Driver with ID ${id} not found`);
    }

    // Redis GEOADD expects: key longitude latitude member
    await this.redis.geoadd('drivers:locations', lng, lat, id);
    return { success: true, message: 'Location updated' };
  }

  async findAll() {
    const drivers = await this.prisma.driver.findMany();
    const result: any[] = [];

    for (const driver of drivers) {
      const pos = await this.redis.geopos('drivers:locations', driver.id);
      const location = pos && pos[0] ? { lng: parseFloat(pos[0][0]), lat: parseFloat(pos[0][1]) } : null;
      result.push({
        ...driver,
        location,
      });
    }

    return result;
  }
}
