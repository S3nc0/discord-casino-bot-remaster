import type { Migration } from '../migrate.ts';
import init from './0001_init.sql';
import ledgerIdempotency from './0002_ledger_idempotency.sql';
import legacyImport from './0003_legacy_import.sql';
import userSettings from './0004_user_settings.sql';
import casino from './0005_casino.sql';
import notifyWebhooks from './0006_notify_webhooks.sql';
import finance from './0007_finance.sql';
import gamesProgression from './0008_games_progression.sql';
import horseBreeding from './0009_horse_breeding.sql';
import botTools from './0010_bot_tools.sql';
import arenaRunnerUp from './0011_arena_runner_up.sql';

export type { Migration };

/** Ordered list of migrations. SQL files are inlined into the server bundle at build time. */
export const migrations: readonly Migration[] = [
  { version: 1, name: 'init', sql: init },
  { version: 2, name: 'ledger_idempotency', sql: ledgerIdempotency },
  { version: 3, name: 'legacy_import', sql: legacyImport },
  { version: 4, name: 'user_settings', sql: userSettings },
  { version: 5, name: 'casino', sql: casino },
  { version: 6, name: 'notify_webhooks', sql: notifyWebhooks },
  { version: 7, name: 'finance', sql: finance },
  { version: 8, name: 'games_progression', sql: gamesProgression },
  { version: 9, name: 'horse_breeding', sql: horseBreeding },
  { version: 10, name: 'bot_tools', sql: botTools },
  { version: 11, name: 'arena_runner_up', sql: arenaRunnerUp },
];
