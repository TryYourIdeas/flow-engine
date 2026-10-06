import { HeartbeatService } from './heartbeat.service';
export interface HealthResponse {
    status: 'ok';
    lastHeartbeatAt: string;
}
export declare class HealthController {
    private readonly heartbeatService;
    constructor(heartbeatService: HeartbeatService);
    getHealth(): HealthResponse;
}
