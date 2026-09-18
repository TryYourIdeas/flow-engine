import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';

const HEARTBEAT_INTERVAL_MS = 1000;

/**
 * Updates lastHeartbeatAt on its own timer, independent of any job-polling
 * loop's iteration cadence - a loop that awaits a long-running job before
 * looping back would otherwise make the engine look unhealthy while it's
 * simply busy. This timer proves the Node.js event loop itself is still
 * responsive.
 */
@Injectable()
export class HeartbeatService implements OnModuleInit, OnModuleDestroy {
  private lastHeartbeatAt = new Date();
  private intervalHandle: NodeJS.Timeout | null = null;

  onModuleInit(): void {
    this.intervalHandle = setInterval(() => {
      this.lastHeartbeatAt = new Date();
    }, HEARTBEAT_INTERVAL_MS);
  }

  onModuleDestroy(): void {
    if (this.intervalHandle) {
      clearInterval(this.intervalHandle);
      this.intervalHandle = null;
    }
  }

  getLastHeartbeatAt(): Date {
    return this.lastHeartbeatAt;
  }
}
