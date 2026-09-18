import { HeartbeatService } from './heartbeat.service';

describe('HeartbeatService', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('updates lastHeartbeatAt every second while running', () => {
    const service = new HeartbeatService();
    const initial = service.getLastHeartbeatAt();

    service.onModuleInit();
    jest.advanceTimersByTime(1000);

    expect(service.getLastHeartbeatAt().getTime()).toBeGreaterThan(initial.getTime());

    service.onModuleDestroy();
  });

  it('stops updating after onModuleDestroy', () => {
    const service = new HeartbeatService();
    service.onModuleInit();
    jest.advanceTimersByTime(1000);
    const afterFirstTick = service.getLastHeartbeatAt();

    service.onModuleDestroy();
    jest.advanceTimersByTime(5000);

    expect(service.getLastHeartbeatAt().getTime()).toBe(afterFirstTick.getTime());
  });
});
