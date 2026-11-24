import { describe, expect, it } from 'vitest';
import type { FinanceServices } from '../finance/jobs.ts';
import { buildJobManifest } from './jobs.ts';
import { createLogger } from './logger.ts';
import { memoryStore } from './test-kit.ts';

const G1 = '200000000000000001';
const G2 = '200000000000000002';
const DENIED = '200000000000000003';

describe('stream jobs', () => {
  it('run every minute for each guild that is not denied; one failing guild never stops the others', async () => {
    const store = memoryStore();
    for (const [g, status] of [
      [G1, 'approved'],
      [G2, 'approved'],
      [DENIED, 'denied'],
    ] as const) {
      store
        .stmt(`INSERT INTO guilds (guild_id, status, created_at, updated_at) VALUES (?, ?, 0, 0)`)
        .run(g, status);
    }
    const calls: string[] = [];
    const jobs = buildJobManifest({
      store,
      logger: createLogger({ level: 'silent' }),
      finance: {} as FinanceServices,
      games: { jobs: [] },
      stream: {
        lockDue: (g) => {
          calls.push(`lock:${g}`);
          if (g === G1) throw new Error('boom');
          return 0;
        },
        closeDue: (g) => {
          calls.push(`close:${g}`);
          return 0;
        },
      },
      purgeLaunchIntents: () => 0,
    }).filter((j) => j.id.startsWith('stream:'));
    expect(jobs.map((j) => [j.id, j.cron])).toEqual([
      ['stream:lock-due', '* * * * *'],
      ['stream:close-due', '* * * * *'],
    ]);
    for (const job of jobs) await job.run(0);
    expect(calls).toEqual([`lock:${G1}`, `lock:${G2}`, `close:${G1}`, `close:${G2}`]);
  });
});
