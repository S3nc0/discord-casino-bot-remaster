import { createHash } from 'node:crypto';
import type Database from 'better-sqlite3';

export interface Migration {
  /** Strictly increasing. Never edit a migration after it has merged; add a new one. */
  readonly version: number;
  readonly name: string;
  readonly sql: string;
}

const checksum = (sql: string): string => createHash('sha256').update(sql).digest('hex');

/**
 * Apply every migration newer than what the file has, in order, one transaction each.
 * Refuses to start when an applied migration was edited since (checksum) or when the file is
 * from a newer build, instead of guessing.
 */
export function runMigrations(db: Database.Database, migrations: readonly Migration[]): number[] {
  for (let i = 0; i < migrations.length; i++) {
    const m = migrations[i];
    if (!m || !Number.isInteger(m.version) || m.version < 1)
      throw new Error('bad migration version');
    const prev = migrations[i - 1];
    if (prev && m.version <= prev.version)
      throw new Error(`migration ${m.version} is out of order`);
  }

  db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
    version    INTEGER PRIMARY KEY,
    name       TEXT NOT NULL,
    checksum   TEXT NOT NULL,
    applied_at INTEGER NOT NULL
  ) STRICT`);

  const applied = new Map<number, string>();
  for (const row of db.prepare('SELECT version, checksum FROM schema_migrations').all() as {
    version: number;
    checksum: string;
  }[]) {
    applied.set(row.version, row.checksum);
  }

  const known = new Set(migrations.map((m) => m.version));
  for (const version of applied.keys()) {
    if (!known.has(version)) {
      throw new Error(`database has migration ${version}, which this build does not know`);
    }
  }

  const insert = db.prepare(
    'INSERT INTO schema_migrations (version, name, checksum, applied_at) VALUES (?, ?, ?, ?)',
  );
  const ran: number[] = [];
  for (const m of migrations) {
    const sum = checksum(m.sql);
    const existing = applied.get(m.version);
    if (existing !== undefined) {
      if (existing !== sum) throw new Error(`migration ${m.version} (${m.name}) was edited`);
      continue;
    }
    db.exec('BEGIN IMMEDIATE');
    try {
      db.exec(m.sql);
      insert.run(m.version, m.name, sum, Date.now());
      db.exec('COMMIT');
    } catch (error) {
      if (db.inTransaction) db.exec('ROLLBACK');
      throw new Error(`migration ${m.version} (${m.name}) failed: ${(error as Error).message}`, {
        cause: error,
      });
    }
    ran.push(m.version);
  }
  return ran;
}
