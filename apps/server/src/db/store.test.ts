import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { runMigrations } from './migrate.ts';
import { migrations } from './migrations/index.ts';
import { openStore, Store } from './store.ts';

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});
const tmpFile = (): string => {
  const dir = mkdtempSync(join(tmpdir(), 'store-'));
  dirs.push(dir);
  return join(dir, 'test.sqlite');
};

describe('openStore and migrations', () => {
  it('applies the pragmas from ARCHITECTURE.md and every migration', () => {
    const store = openStore(tmpFile(), { migrations });
    const pragma = (name: string): unknown => store.db.pragma(name, { simple: true });
    expect(pragma('journal_mode')).toBe('wal');
    expect(pragma('synchronous')).toBe(1); // NORMAL
    expect(pragma('busy_timeout')).toBe(5000);
    expect(pragma('foreign_keys')).toBe(1);
    expect(pragma('recursive_triggers')).toBe(1);
    expect(pragma('temp_store')).toBe(2); // MEMORY
    expect(pragma('cache_size')).toBe(-8000);
    const versions = store.db
      .prepare('SELECT version FROM schema_migrations ORDER BY version')
      .all();
    expect(versions).toEqual(migrations.map((m) => ({ version: m.version })));
    store.close();
  });

  it('is idempotent across restarts', () => {
    const path = tmpFile();
    openStore(path, { migrations }).close();
    const again = openStore(path, { migrations });
    expect(again.db.prepare('SELECT COUNT(*) AS n FROM schema_migrations').get()).toEqual({
      n: migrations.length,
    });
    again.close();
  });

  it('refuses an edited migration and a database from a newer build', () => {
    const db = new Database(':memory:');
    runMigrations(db, migrations);
    const edited = migrations.map((m, i) => (i === 0 ? { ...m, sql: `${m.sql}\n-- edited` } : m));
    expect(() => runMigrations(db, edited)).toThrow(/was edited/);
    expect(() => runMigrations(db, migrations.slice(0, 1))).toThrow(/does not know/);
  });

  it('rolls a failing migration back completely', () => {
    const db = new Database(':memory:');
    const broken = [
      { version: 1, name: 'a', sql: 'CREATE TABLE a (x INTEGER);' },
      { version: 2, name: 'b', sql: 'CREATE TABLE b (x INTEGER); CREATE TABLE b (x INTEGER);' },
    ];
    expect(() => runMigrations(db, broken)).toThrow(/migration 2/);
    expect(
      db.prepare("SELECT name FROM sqlite_master WHERE name IN ('a','b') ORDER BY name").all(),
    ).toEqual([{ name: 'a' }]);
    expect(db.prepare('SELECT version FROM schema_migrations').all()).toEqual([{ version: 1 }]);
  });
});

describe('Store', () => {
  const fresh = (): Store => {
    const db = new Database(':memory:');
    db.exec('CREATE TABLE t (x INTEGER)');
    return new Store(db);
  };
  const count = (s: Store): number =>
    (s.db.prepare('SELECT COUNT(*) AS n FROM t').get() as { n: number }).n;

  it('caches prepared statements by SQL text', () => {
    const store = fresh();
    expect(store.stmt('SELECT 1')).toBe(store.stmt('SELECT 1'));
    expect(store.stmt('SELECT 1')).not.toBe(store.stmt('SELECT 2'));
  });

  it('commits, rolls back on throw, and nests as savepoints', () => {
    const store = fresh();
    const insert = (x: number): void => void store.stmt('INSERT INTO t VALUES (?)').run(x);
    store.transaction(() => insert(1));
    expect(() =>
      store.transaction(() => {
        insert(2);
        throw new Error('boom');
      }),
    ).toThrow('boom');
    expect(count(store)).toBe(1);

    store.transaction(() => {
      insert(3);
      expect(() =>
        store.transaction(() => {
          insert(4);
          throw new Error('inner');
        }),
      ).toThrow('inner');
      insert(5);
    });
    expect(store.db.prepare('SELECT x FROM t ORDER BY x').all()).toEqual([
      { x: 1 },
      { x: 3 },
      { x: 5 },
    ]);
    expect(store.inTransaction).toBe(false);
  });

  it('runs afterCommit hooks once, after the outermost commit, and drops them on rollback', () => {
    const store = fresh();
    const calls: string[] = [];
    store.transaction(() => {
      store.afterCommit(() => calls.push('outer'));
      try {
        store.transaction(() => {
          store.afterCommit(() => calls.push('rolled back'));
          throw new Error('x');
        });
      } catch {
        // expected
      }
      store.transaction(() => store.afterCommit(() => calls.push('inner kept')));
      expect(calls).toEqual([]);
    });
    expect(calls).toEqual(['outer', 'inner kept']);

    expect(() =>
      store.transaction(() => {
        store.afterCommit(() => calls.push('never'));
        throw new Error('y');
      }),
    ).toThrow();
    expect(calls).toEqual(['outer', 'inner kept']);

    store.afterCommit(() => calls.push('immediate'));
    expect(calls.at(-1)).toBe('immediate');
  });

  it('reports a throwing hook without failing the committed transaction', () => {
    const db = new Database(':memory:');
    db.exec('CREATE TABLE t (x INTEGER)');
    const onError = vi.fn();
    const store = new Store(db, onError);
    store.transaction(() => {
      store.stmt('INSERT INTO t VALUES (1)').run();
      store.afterCommit(() => {
        throw new Error('hook');
      });
    });
    expect(onError).toHaveBeenCalledTimes(1);
    expect(count(store)).toBe(1);
  });
});
