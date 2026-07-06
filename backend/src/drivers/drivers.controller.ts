import { Controller, Get, Post, Patch, Param, Body } from '@nestjs/common';
import { DriversService } from './drivers.service.js';
import { DriverStatus } from '../generated/prisma/client.js';

@Controller('api/drivers')
export class DriversController {
  constructor(private readonly driversService: DriversService) {}

  @Post()
  async create(@Body('name') name: string) {
    return this.driversService.create(name);
  }

  @Patch(':id/status')
  async updateStatus(
    @Param('id') id: string,
    @Body('status') status: DriverStatus,
  ) {
    return this.driversService.updateStatus(id, status);
  }

  @Post(':id/location')
  async updateLocation(
    @Param('id') id: string,
    @Body('lat') lat: number,
    @Body('lng') lng: number,
  ) {
    return this.driversService.updateLocation(id, lat, lng);
  }

  @Get()
  async findAll() {
    return this.driversService.findAll();
  }
}
