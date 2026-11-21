import {
  INBOX_PAGE_DEFAULT,
  INBOX_PAGE_MAX,
  type Clock,
  type InboxItem,
  type InboxPage,
  type InboxReadRequest,
  type NotificationKind,
} from '@casino/shared';
import type { EventBus } from '../runtime/bus.ts';
import type { Store } from './store.ts';

interface InboxRow {
  id: number;
  guild_id: string;
  kind: NotificationKind;
  payload: string;
  created_at: number;
  read_at: number | null;
}

/**
 * Read side of the in-Activity inbox (the notify module writes rows). Everything is scoped to
 * one user in one guild; ids that belong to someone else are simply not touched. Every read
 * publishes the new unread count so each open instance of the user shows the same number.
 */
export class InboxService {
  private readonly store: Store;
  private readonly clock: Clock;
  private readonly bus: EventBus | undefined;

  constructor(options: { store: Store; clock: Clock; bus?: EventBus }) {
    this.store = options.store;
    this.clock = options.clock;
    this.bus = options.bus;
  }

  unread(userId: string, guildId: string): number {
    const row = this.store
      .stmt(
        'SELECT COUNT(*) AS n FROM inbox WHERE user_id = ? AND guild_id = ? AND read_at IS NULL',
      )
      .get(userId, guildId) as { n: number };
    return row.n;
  }

  /** Newest first. `before` pages to older items; `limit` defaults to `INBOX_PAGE_DEFAULT`. */
  page(
    userId: string,
    guildId: string,
    query: { before?: number; limit?: number; unreadOnly?: boolean } = {},
  ): InboxPage {
    const limit = Math.min(query.limit ?? INBOX_PAGE_DEFAULT, INBOX_PAGE_MAX);
    const rows = this.store
      .stmt(
        `SELECT id, guild_id, kind, payload, created_at, read_at FROM inbox
         WHERE user_id = @userId AND guild_id = @guildId
           AND (@before IS NULL OR id < @before)
           AND (@unreadOnly = 0 OR read_at IS NULL)
         ORDER BY id DESC LIMIT @take`,
      )
      .all({
        userId,
        guildId,
        before: query.before ?? null,
        unreadOnly: query.unreadOnly ? 1 : 0,
        take: limit + 1,
      }) as InboxRow[];
    const shown = rows.slice(0, limit);
    const last = shown.at(-1);
    return {
      items: shown.map((row): InboxItem => ({
        id: row.id,
        guildId: row.guild_id,
        kind: row.kind,
        event: JSON.parse(row.payload) as InboxItem['event'],
        createdAt: row.created_at,
        readAt: row.read_at,
      })),
      unread: this.unread(userId, guildId),
      nextBefore: rows.length > limit && last ? last.id : null,
    };
  }

  /** Mark items read (`{ ids }` or `{ all: true }`), publish and return the unread count. */
  markRead(userId: string, guildId: string, request: InboxReadRequest): number {
    return this.store.transaction(() => {
      const at = this.clock.now();
      if ('all' in request) {
        this.store
          .stmt(
            'UPDATE inbox SET read_at = ? WHERE user_id = ? AND guild_id = ? AND read_at IS NULL',
          )
          .run(at, userId, guildId);
      } else {
        const mark = this.store.stmt(
          'UPDATE inbox SET read_at = ? WHERE id = ? AND user_id = ? AND guild_id = ? AND read_at IS NULL',
        );
        for (const id of request.ids) mark.run(at, id, userId, guildId);
      }
      const unread = this.unread(userId, guildId);
      const bus = this.bus;
      if (bus) this.store.afterCommit(() => bus.publishInboxUnread({ guildId, userId, unread }));
      return unread;
    });
  }
}
