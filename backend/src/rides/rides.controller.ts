import { Controller, Get, Post, Param, Body } from '@nestjs/common';
import { RidesService } from './rides.service.js';

@Controller('api/rides')
export class RidesController {
  constructor(private readonly ridesService: RidesService) {}

  @Post()
  async createRide(
    @Body('riderName') riderName: string,
    @Body('pickupLat') pickupLat: number,
    @Body('pickupLng') pickupLng: number,
  ) {
    return this.ridesService.createRide(riderName, pickupLat, pickupLng);
  }

  @Get(':id')
  async getRide(@Param('id') id: string) {
    return this.ridesService.getRide(id);
  }

  @Get(':id/drivers')
  async getAvailableDrivers(@Param('id') id: string) {
    return this.ridesService.getAvailableDrivers(id);
  }

  @Post(':id/accept')
  async acceptRide(
    @Param('id') id: string,
    @Body('driverId') driverId: string,
  ) {
    return this.ridesService.acceptRide(id, driverId);
  }
}
