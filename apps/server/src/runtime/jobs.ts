import type { Logger } from 'pino';
import type { Store } from '../db/store.ts';
import { FINANCE_JOBS, type FinanceServices } from '../finance/jobs.ts';
import type { NonCasinoGames } from '../games/progression/register.ts';
import type { PostPinService } from '../notify/post-pins.ts';
import type { JobSpec } from './scheduler.ts';

export interface JobManifestDeps {
  store: Store;
  logger: Logger;
  finance: FinanceServices;
  games: Pick<NonCasinoGames, 'jobs'>;
  /** Pinned poll, motion and raffle posts; the sweep unpins the ones that ended. */
  postPins?: Pick<PostPinService, 'sweep'>;
  /** Housekeeping hooks owned by the auth and casino layers. */
  purgeLaunchIntents(): unknown;
}

/** Guilds the game jobs run for: every guild the bot has seen and not denied. */
export function listGameGuilds(store: Store): string[] {
  return (
    store.stmt("SELECT guild_id FROM guilds WHERE status != 'denied' ORDER BY guild_id").all() as {
      guild_id: string;
    }[]
  ).map((row) => row.guild_id);
}

/**
 * Every scheduled job of the process, from one place: the finance manifest, the game jobs
 * (races four times a day, daily reset and reminders, arena, weekly ranking, lottery, polls,
 * quiz, shop market) and housekeeping. Game jobs run once per guild; a guild that throws is
 * logged and the others still run.
 */
export function buildJobManifest(deps: JobManifestDeps): JobSpec[] {
  const { store, logger, finance, games } = deps;

  const financeJobs: JobSpec[] = FINANCE_JOBS.map((job) => ({
    id: job.id,
    cron: job.cron,
    description: job.description,
    run: (nowMs) => job.run(finance, nowMs),
  }));

  const gameJobs: JobSpec[] = games.jobs.map((job) => ({
    id: `games:${job.name}`,
    cron: job.cron,
    run: () => {
      for (const guildId of listGameGuilds(store)) {
        try {
          job.run(guildId);
        } catch (error) {
          logger.error({ err: error, job: job.name, guildId }, 'game job failed for guild');
        }
      }
    },
  }));

  const housekeeping: JobSpec[] = [
    {
      id: 'casino:idempotency-purge',
      cron: '*/10 * * * *',
      description: 'Drop expired idempotency keys.',
      run: (nowMs) =>
        store.stmt('DELETE FROM idempotency_keys WHERE expires_at <= ?').run(nowMs).changes,
    },
    {
      id: 'auth:launch-intents-purge',
      cron: '* * * * *',
      description: 'Drop expired launch intents.',
      run: () => deps.purgeLaunchIntents(),
    },
  ];

  const pinJobs: JobSpec[] = deps.postPins
    ? [
        {
          id: 'notify:pin-sweep',
          cron: '*/30 * * * * *',
          description: 'Unpin the poll, kyosai motion and raffle posts whose thing has ended.',
          run: () => deps.postPins?.sweep(),
        },
      ]
    : [];

  return [...financeJobs, ...gameJobs, ...pinJobs, ...housekeeping];
}
