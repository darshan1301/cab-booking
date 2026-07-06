import { Controller, Get, InternalServerErrorException } from '@nestjs/common';
import { AppService } from './app.service.js';

@Controller('api')
export class AppController {
  constructor(private readonly appService: AppService) {}

  @Get('health')
  async getHealth() {
    const health = await this.appService.checkHealth();
    if (health.status !== 'healthy') {
      throw new InternalServerErrorException(health);
    }
    return health;
  }
}
