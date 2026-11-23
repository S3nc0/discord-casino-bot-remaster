// Tests for the Pi shell scripts in ops/pi. They live here because only the server package's
// vitest project is collected by CI.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const OPS = resolve(import.meta.dirname, '../../../../ops/pi');
const hasSqlite = spawnSync('sqlite3', ['-version']).status === 0;

let dir = '';
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'ops-pi-'));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function runBackup(env: Record<string, string>) {
  const db = join(dir, 'casino.sqlite');
  if (!existsSync(db))
    spawnSync('sqlite3', [db, 'CREATE TABLE t (x INTEGER); INSERT INTO t VALUES (1);']);
  return spawnSync('bash', [join(OPS, 'backup.sh')], {
    encoding: 'utf8',
    env: {
      PATH: process.env.PATH ?? '',
      APP_DIR: dir,
      ENV_FILE: join(dir, 'missing.env'),
      DATABASE_PATH: db,
      BACKUP_DIR: join(dir, 'backups'),
      ...env,
    },
  });
}

describe.skipIf(!hasSqlite)('ops/pi/backup.sh', () => {
  it('writes a backup with valid settings', () => {
    const res = runBackup({});
    expect(res.status).toBe(0);
    expect(readdirSync(join(dir, 'backups')).some((f) => f.endsWith('.sqlite'))).toBe(true);
  });

  it('R-20: refuses a BACKUP_DIR with a quote or a newline and creates nothing', () => {
    for (const bad of [join(dir, "it's"), join(dir, 'a\nb'), 'relative/dir']) {
      const res = runBackup({ BACKUP_DIR: bad });
      expect(res.status).not.toBe(0);
      expect(res.stderr).toContain('BACKUP_DIR');
    }
    expect(readdirSync(dir).sort()).toEqual(['casino.sqlite']);
  });

  it('R-20: refuses a non-numeric RETENTION_DAYS before writing a backup', () => {
    for (const bad of ['abc', '-1', '7; rm -rf /']) {
      const res = runBackup({ RETENTION_DAYS: bad });
      expect(res.status).not.toBe(0);
      expect(res.stderr).toContain('RETENTION_DAYS');
    }
    expect(existsSync(join(dir, 'backups'))).toBe(false);
  });
});

describe('ops/pi/install.sh', () => {
  const script = readFileSync(join(OPS, 'install.sh'), 'utf8');

  it('R-19: installs a pinned cloudflared and verifies its SHA-256 before dpkg', () => {
    expect(script).not.toMatch(/releases\/latest/);
    expect(script).toMatch(/^CLOUDFLARED_VERSION="\d{4}\.\d+\.\d+"$/m);
    expect(script).toMatch(/^CLOUDFLARED_SHA256="[0-9a-f]{64}"$/m);
    const verify = script.indexOf('sha256sum -c');
    const install = script.indexOf('dpkg -i');
    expect(verify).toBeGreaterThan(-1);
    expect(install).toBeGreaterThan(verify);
  });
});
