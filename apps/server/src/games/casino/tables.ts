/** An idle shared table untouched this long is dropped (its Activity instance is most likely gone). */
export const TABLE_IDLE_EVICT_MS = 30 * 60 * 1000;

/** What eviction needs from a shared table. */
export interface EvictableTable {
  phase: string;
  /** A pending timer (lobby, reveal, result) keeps the table. */
  cancel: (() => void) | null;
  /** Epoch ms of the last change (or of creation). */
  touchedAt: number;
}

/**
 * Drop idle tables nobody touched for `TABLE_IDLE_EVICT_MS`. Every Activity launch has its own
 * instance id, so without this the per-instance maps would only grow. A later request for an
 * evicted instance simply gets a fresh idle table.
 */
export function evictIdleTables(tables: Map<string, EvictableTable>, now: number): void {
  for (const [key, table] of tables) {
    if (
      table.phase === 'idle' &&
      table.cancel === null &&
      now - table.touchedAt >= TABLE_IDLE_EVICT_MS
    ) {
      tables.delete(key);
    }
  }
}
