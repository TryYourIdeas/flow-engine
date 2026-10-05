import type { Pool } from 'pg';
import { ProgressPublisherService } from './progress-publisher.service';

// Unit test: the Pool is a fake, so this checks only what is sent to
// pg_notify. Real LISTEN/NOTIFY delivery is covered by the integration spec.
describe('ProgressPublisherService', () => {
  it('publishes the message as JSON on the run:<id> channel', async () => {
    const query = jest.fn().mockResolvedValue({ rows: [] });
    const publisher = new ProgressPublisherService({
      query,
    } as unknown as Pool);

    await publisher.publish('job-123', {
      kind: 'token',
      nodeId: 'llm-1',
      token: 'Hi',
    });

    expect(query).toHaveBeenCalledWith('SELECT pg_notify($1, $2)', [
      'run:job-123',
      JSON.stringify({ kind: 'token', nodeId: 'llm-1', token: 'Hi' }),
    ]);
  });

  it('passes quotes and backslashes through as a JSON payload unchanged', async () => {
    const query = jest.fn().mockResolvedValue({ rows: [] });
    const publisher = new ProgressPublisherService({
      query,
    } as unknown as Pool);
    const tricky = `it's a "test" \\ with 'quotes' and \\backslashes\\`;

    await publisher.publish('job-456', {
      kind: 'token',
      nodeId: 'llm-1',
      token: tricky,
    });

    const [, params] = query.mock.calls[0] as [string, [string, string]];
    expect(params[0]).toBe('run:job-456');
    expect(JSON.parse(params[1])).toEqual({
      kind: 'token',
      nodeId: 'llm-1',
      token: tricky,
    });
  });
});
