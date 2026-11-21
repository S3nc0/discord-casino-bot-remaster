import type { Clock, NotificationKind } from '@casino/shared';
import type { Store } from '../db/store.ts';
import type { EventBus } from '../runtime/bus.ts';
import type { NotifyConfigService } from './config-service.ts';
import {
  buildDmDisabledToast,
  buildNotificationToast,
  type SubscribedDomainEvent,
} from './messages.ts';
import type { DmDisabledNotice, NotifyInboxItem, RealtimeNotifyPort } from './ports.ts';

export interface InboxWriteResult {
  item: NotifyInboxItem;
  unread: number;
}

export interface InboxWriterOptions {
  store: Store;
  bus: EventBus;
  clock: Clock;
  configService: NotifyConfigService;
  realtime: RealtimeNotifyPort;
}

/**
 * Write side of the in-Activity inbox (pairs with B1b's read-side `InboxService`).
 * Inserts the row, then after commit emits `inbox:new` and `toast` to `user:{id}` and
 * publishes `inbox:unread` on the bus so every open socket updates its badge.
 */
export class InboxWriter {
  private readonly store: Store;
  private readonly bus: EventBus;
  private readonly clock: Clock;
  private readonly configService: NotifyConfigService;
  private readonly realtime: RealtimeNotifyPort;

  constructor(options: InboxWriterOptions) {
    this.store = options.store;
    this.bus = options.bus;
    this.clock = options.clock;
    this.configService = options.configService;
    this.realtime = options.realtime;
  }

  /**
   * Persist a notification in the user's inbox (unless they opted out of inbox for `kind`)
   * and push a live `inbox:new`, `toast`, and `inbox:unread` update after commit.
   */
  writeNotification(
    userId: string,
    kind: NotificationKind,
    event: SubscribedDomainEvent,
  ): InboxWriteResult | null {
    if (!this.configService.getUserKindPref(userId, kind).inbox) {
      return null;
    }

    return this.store.transaction(() => {
      const createdAt = this.clock.now();
      const info = this.store
        .stmt(
          `INSERT INTO inbox (user_id, guild_id, kind, payload, created_at)
           VALUES (?, ?, ?, ?, ?)`,
        )
        .run(userId, event.guildId, kind, JSON.stringify(event), createdAt);

      const id = Number(info.lastInsertRowid);
      const unread = this.countUnread(userId, event.guildId);
      const item: NotifyInboxItem = {
        id,
        guildId: event.guildId,
        kind,
        event,
        createdAt,
        readAt: null,
      };
      const toast = buildNotificationToast(kind, event);

      this.store.afterCommit(() => {
        this.realtime.emitInboxNew(userId, item);
        this.realtime.emitToast(userId, toast);
        this.bus.publishInboxUnread({ guildId: event.guildId, userId, unread });
      });

      return { item, unread };
    });
  }

  /**
   * Write a system inbox note informing the user that their DMs were automatically disabled
   * after Discord rejected a DM due to closed DMs (error 50007).
   */
  writeDmDisabledNote(userId: string, guildId: string): InboxWriteResult {
    return this.store.transaction(() => {
      const createdAt = this.clock.now();
      const notice: DmDisabledNotice = {
        type: 'DmDisabled',
        guildId,
        at: createdAt,
        userId,
        reason: 'dm_closed',
      };
      const info = this.store
        .stmt(
          `INSERT INTO inbox (user_id, guild_id, kind, payload, created_at)
           VALUES (?, ?, ?, ?, ?)`,
        )
        .run(userId, guildId, 'dm_disabled', JSON.stringify(notice), createdAt);

      const id = Number(info.lastInsertRowid);
      const unread = this.countUnread(userId, guildId);
      const item: NotifyInboxItem = {
        id,
        guildId,
        kind: 'dm_disabled',
        event: notice,
        createdAt,
        readAt: null,
      };
      const toast = buildDmDisabledToast(guildId);

      this.store.afterCommit(() => {
        this.realtime.emitInboxNew(userId, item);
        this.realtime.emitToast(userId, toast);
        this.bus.publishInboxUnread({ guildId, userId, unread });
      });

      return { item, unread };
    });
  }

  private countUnread(userId: string, guildId: string): number {
    const row = this.store
      .stmt(
        'SELECT COUNT(*) AS n FROM inbox WHERE user_id = ? AND guild_id = ? AND read_at IS NULL',
      )
      .get(userId, guildId) as { n: number };
    return row.n;
  }
}
