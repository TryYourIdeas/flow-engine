import { Controller, Get } from '@nestjs/common';
import { HeartbeatService } from './heartbeat.service';

export interface HealthResponse {
  status: 'ok';
  lastHeartbeatAt: string;
}

@Controller('health')
export class HealthController {
  constructor(private readonly heartbeatService: HeartbeatService) {}

  @Get()
  getHealth(): HealthResponse {
    return {
      status: 'ok',
      lastHeartbeatAt: this.heartbeatService.getLastHeartbeatAt().toISOString(),
    };
  }
}
