import { HealthController } from './health.controller';
import { HeartbeatService } from './heartbeat.service';

describe('HealthController', () => {
  it('returns status ok and the current heartbeat as an ISO string', () => {
    const heartbeatService = new HeartbeatService();
    const fixedDate = new Date('2026-01-01T00:00:00.000Z');
    jest.spyOn(heartbeatService, 'getLastHeartbeatAt').mockReturnValue(fixedDate);

    const controller = new HealthController(heartbeatService);

    expect(controller.getHealth()).toEqual({
      status: 'ok',
      lastHeartbeatAt: '2026-01-01T00:00:00.000Z',
    });
  });
});
