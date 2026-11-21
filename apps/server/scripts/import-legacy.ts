// Import the Python bot's wallet data into the new database.
//
//   node scripts/import-legacy.ts --legacy data/casino.db                      # dry run
//   node scripts/import-legacy.ts --legacy data/casino.db --target data/casino.sqlite --apply
//
// Stop the Python bot first. A dry run prints totals per guild and per user and touches
// nothing. --apply writes in one transaction and exits non-zero (writing nothing) if any
// Pelica total differs. A second --apply on the same data is a no-op.
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { IdentityRepo } from '../src/db/identity.ts';
import { runImport, type ImportReport } from '../src/db/legacy-import.ts';
import { readMigrationsFromDir } from '../src/db/migrations-fs.ts';
import { openStore, type Store } from '../src/db/store.ts';
import { EconomyService } from '../src/economy/economy-service.ts';
import { systemClock } from '../src/runtime/clock.ts';

function print(report: ImportReport): void {
  const { plan } = report;
  console.log(`mode: ${report.mode}   source digest: ${plan.digest.slice(0, 16)}`);
  for (const guild of plan.guilds) {
    console.log(
      `guild ${guild.guildId} [${guild.status}] ${guild.name ?? ''}: ${guild.members} players, total ${guild.expectedTotal} Pelica`,
    );
    for (const m of plan.members.filter((x) => x.guildId === guild.guildId)) {
      const held = m.escrow.reduce((sum, e) => sum + e.amount, 0);
      console.log(
        `  user ${m.userId}: balance ${m.balance} + escrow refund ${held} = ${m.expected}`,
      );
    }
  }
  console.log(`legacy ledger rows to copy: ${plan.legacyLedgerRows}`);
  for (const w of plan.warnings) console.warn(`warning: ${w}`);
  for (const e of plan.errors) console.error(`error: ${e}`);
  if (report.mode === 'applied') console.log('verified: every user and guild total matches');
}

function main(): number {
  const { values } = parseArgs({
    options: {
      legacy: { type: 'string' },
      target: { type: 'string' },
      apply: { type: 'boolean', default: false },
    },
  });
  if (!values.legacy) {
    console.error('usage: import-legacy.ts --legacy <casino.db> [--target <db>] [--apply]');
    return 2;
  }
  if (values.apply && !values.target) {
    console.error('--apply needs --target');
    return 2;
  }

  let store: Store | undefined;
  try {
    let target;
    if (values.target && (values.apply || existsSync(values.target))) {
      const migrationsDir = fileURLToPath(new URL('../src/db/migrations', import.meta.url));
      store = openStore(values.target, { migrations: readMigrationsFromDir(migrationsDir) });
      const identity = new IdentityRepo(store, () => systemClock.now());
      target = {
        store,
        identity,
        economy: new EconomyService({ store, identity, clock: systemClock }),
      };
    }
    const report = runImport({
      legacyPath: values.legacy,
      apply: values.apply,
      clock: systemClock,
      ...(target ? { target } : {}),
    });
    print(report);
    return report.plan.errors.length > 0 ? 1 : 0;
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    return 1;
  } finally {
    store?.close();
  }
}

process.exitCode = main();
