import { Client } from 'pg';
import { ProgressPublisherService } from './progress-publisher.service';
import { testDb } from '../db/test/seed';

describe('ProgressPublisherService', () => {
  const { pool } = testDb();
  const connectionString =
    process.env.DATABASE_URL ??
    'postgres://flow_engine:flow_engine@localhost:5433/flow_engine';

  afterAll(async () => {
    await pool.end();
  });

  it('publishes an event that a LISTEN client receives on run:<id>', async () => {
    const listener = new Client({ connectionString });
    await listener.connect();
    await listener.query('LISTEN "run:job-123"');

    const received = new Promise<string>((resolve) => {
      listener.on('notification', (msg) => resolve(msg.payload ?? ''));
    });

    const publisher = new ProgressPublisherService(pool);
    await publisher.publish('job-123', {
      kind: 'token',
      nodeId: 'llm-1',
      token: 'Hi',
    });

    const payload = await received;
    expect(JSON.parse(payload)).toEqual({
      kind: 'token',
      nodeId: 'llm-1',
      token: 'Hi',
    });

    await listener.end();
  });

  it('publishes a token payload containing quotes and backslashes without corruption', async () => {
    const listener = new Client({ connectionString });
    await listener.connect();
    await listener.query('LISTEN "run:job-456"');

    const received = new Promise<string>((resolve) => {
      listener.on('notification', (msg) => resolve(msg.payload ?? ''));
    });

    const publisher = new ProgressPublisherService(pool);
    const tricky = `it's a "test" \\ with 'quotes' and \\backslashes\\`;
    await publisher.publish('job-456', {
      kind: 'token',
      nodeId: 'llm-1',
      token: tricky,
    });

    const payload = await received;
    expect(JSON.parse(payload)).toEqual({
      kind: 'token',
      nodeId: 'llm-1',
      token: tricky,
    });

    await listener.end();
  });
});
