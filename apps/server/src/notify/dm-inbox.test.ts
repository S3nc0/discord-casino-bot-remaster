import { io as clientIo, type Socket as ClientSocket } from 'socket.io-client';
import { afterEach, describe, expect, it } from 'vitest';
import {
  SOCKET_PATH,
  manualClock,
  type ClientToServerEvents,
  type InboxItem,
  type InboxUnread,
  type ServerToClientEvents,
  type Toast,
} from '@casino/shared';
import { EventBus } from '../runtime/bus.ts';
import { createLogger } from '../runtime/logger.ts';
import {
  createTestServer,
  GUILD,
  INSTANCE,
  memoryStore,
  OTHER_USER,
  START_MS,
  USER,
} from '../runtime/test-kit.ts';
import { NotifyConfigService } from './config-service.ts';
import { computeRetryBackoffMs, DmQueue, groupDigestRows, type QueuedDmRow } from './dm-queue.ts';
import { InboxWriter } from './inbox-writer.ts';
import { attachNotify } from './index.ts';
import { createFakeDiscordPort, type NotifyInboxItem, type RealtimeNotifyPort } from './ports.ts';

const DEFAULT_CHANNEL = '456789012345678901';
const silentLogger = createLogger({ level: 'silent' });

function makeDmHarness(
  options: {
    port?: ReturnType<typeof createFakeDiscordPort>;
    digestWindowMs?: number;
    baseBackoffMs?: number;
    maxBackoffMs?: number;
    maxAttempts?: number;
  } = {},
) {
  const store = memoryStore();
  const clock = manualClock(START_MS);
  const bus = new EventBus();
  const port = options.port ?? createFakeDiscordPort();
  const inboxNewEvents: { userId: string; item: NotifyInboxItem }[] = [];
  const toastEvents: { userId: string; toast: Toast }[] = [];
  const unreadEvents: { userId: string; guildId: string; unread: number }[] = [];

  bus.onInboxUnread((ev) => unreadEvents.push(ev));

  const realtime: RealtimeNotifyPort = {
    emitInboxNew(userId, item) {
      inboxNewEvents.push({ userId, item });
    },
    emitToast(userId, toast) {
      toastEvents.push({ userId, toast });
    },
  };

  const config = new NotifyConfigService({
    store,
    clock,
    defaultAnnounceChannelId: DEFAULT_CHANNEL,
  });
  const inboxWriter = new InboxWriter({
    store,
    bus,
    clock,
    configService: config,
    realtime,
  });
  const dmQueue = new DmQueue({
    store,
    port,
    configService: config,
    inboxWriter,
    clock,
    logger: silentLogger,
    ...(options.digestWindowMs === undefined ? {} : { digestWindowMs: options.digestWindowMs }),
    ...(options.baseBackoffMs === undefined ? {} : { baseBackoffMs: options.baseBackoffMs }),
    ...(options.maxBackoffMs === undefined ? {} : { maxBackoffMs: options.maxBackoffMs }),
    ...(options.maxAttempts === undefined ? {} : { maxAttempts: options.maxAttempts }),
  });

  return {
    store,
    clock,
    bus,
    port,
    config,
    inboxWriter,
    dmQueue,
    inboxNewEvents,
    toastEvents,
    unreadEvents,
  };
}

describe('DM backoff and digest grouping math', () => {
  it('computes exponential backoff with cap and respects Discord retryAfterMs', () => {
    expect(computeRetryBackoffMs(1, { baseDelayMs: 30_000, maxDelayMs: 300_000 })).toBe(30_000);
    expect(computeRetryBackoffMs(2, { baseDelayMs: 30_000, maxDelayMs: 300_000 })).toBe(60_000);
    expect(computeRetryBackoffMs(3, { baseDelayMs: 30_000, maxDelayMs: 300_000 })).toBe(120_000);
    expect(computeRetryBackoffMs(4, { baseDelayMs: 30_000, maxDelayMs: 300_000 })).toBe(240_000);
    expect(computeRetryBackoffMs(5, { baseDelayMs: 30_000, maxDelayMs: 300_000 })).toBe(300_000);
    expect(
      computeRetryBackoffMs(1, { baseDelayMs: 30_000, maxDelayMs: 300_000, retryAfterMs: 45_000 }),
    ).toBe(45_000);
  });

  it('groups rows per user in chronological order and caps each digest batch', () => {
    const rows: QueuedDmRow[] = [
      {
        id: 3,
        user_id: USER,
        guild_id: GUILD,
        kind: 'daily_ready',
        payload: '{}',
        attempts: 0,
        next_attempt_at: 0,
        created_at: 300,
      },
      {
        id: 1,
        user_id: OTHER_USER,
        guild_id: GUILD,
        kind: 'order_filled',
        payload: '{}',
        attempts: 0,
        next_attempt_at: 0,
        created_at: 200,
      },
      {
        id: 2,
        user_id: USER,
        guild_id: GUILD,
        kind: 'loan_due',
        payload: '{}',
        attempts: 0,
        next_attempt_at: 0,
        created_at: 100,
      },
      {
        id: 4,
        user_id: USER,
        guild_id: GUILD,
        kind: 'mission_complete',
        payload: '{}',
        attempts: 0,
        next_attempt_at: 0,
        created_at: 400,
      },
    ];

    const groups = groupDigestRows(rows, 2);
    expect(groups).toHaveLength(2);
    const u1 = groups.find((g) => g.userId === USER);
    const u2 = groups.find((g) => g.userId === OTHER_USER);
    expect(u1?.rows.map((r) => r.id)).toEqual([2, 3]); // chronological + capped at 2
    expect(u2?.rows.map((r) => r.id)).toEqual([1]);
  });
});

describe('DmQueue opt-in, hourly digest, retry/backoff, closed DMs, and language selection', () => {
  it('respects opt-in defaults (DMs off, inbox on) and opt-out changes before send', async () => {
    const h = makeDmHarness();

    // Default: DMs off → enqueue rejected.
    const ev = {
      type: 'DailyReady' as const,
      guildId: GUILD,
      at: h.clock.now(),
      userId: USER,
    };
    expect(h.dmQueue.enqueue(USER, 'daily_ready', ev)).toEqual({
      enqueued: false,
      reason: 'opted_out',
    });

    // Opt in to daily_ready only; order_filled still opted out.
    h.config.setUserKindPref(USER, 'daily_ready', { dm: true });
    expect(h.dmQueue.enqueue(USER, 'daily_ready', ev).enqueued).toBe(true);
    expect(
      h.dmQueue.enqueue(USER, 'order_filled', {
        type: 'OrderFilled',
        guildId: GUILD,
        at: h.clock.now(),
        userId: USER,
        orderId: 1,
        ticker: 'CS',
        side: 'buy',
        quantity: 1_000,
        price: 10_000_000,
      }),
    ).toEqual({ enqueued: false, reason: 'opted_out' });

    // Dedupe key blocks exact duplicate.
    expect(h.dmQueue.enqueue(USER, 'daily_ready', ev)).toEqual({
      enqueued: false,
      reason: 'duplicate',
    });

    // Opting out before processDue drops the queued item instead of sending.
    h.config.setUserKindPref(USER, 'daily_ready', { dm: false });
    const report = await h.dmQueue.processDue();
    expect(report.sentUsers).toBe(0);
    expect(report.droppedItems).toBe(1);
    expect(h.port.dms).toHaveLength(0);

    // Inbox opt-out respected too.
    h.config.setUserKindPref(USER, 'daily_ready', { inbox: false });
    expect(h.inboxWriter.writeNotification(USER, 'daily_ready', ev)).toBeNull();
    expect(h.inboxNewEvents).toHaveLength(0);
  });

  it('paces per-user DMs with an hourly digest and groups items arriving within the hour', async () => {
    const h = makeDmHarness({ digestWindowMs: 3_600_000 });
    h.config.setUserKindPref(USER, 'daily_ready', { dm: true });
    h.config.setUserKindPref(USER, 'mission_complete', { dm: true });
    h.config.setUserKindPref(USER, 'marketplace_outbid', { dm: true });

    // First DM after idle sends right away.
    h.dmQueue.enqueue(USER, 'daily_ready', {
      type: 'DailyReady',
      guildId: GUILD,
      at: h.clock.now(),
      userId: USER,
    });
    expect((await h.dmQueue.processDue()).sentItems).toBe(1);
    expect(h.port.dms).toHaveLength(1);

    // Two more events arrive 10 min and 30 min later → both defer until t0 + 1h.
    h.clock.advance(600_000);
    const r2 = h.dmQueue.enqueue(USER, 'mission_complete', {
      type: 'MissionCompleted',
      guildId: GUILD,
      at: h.clock.now(),
      userId: USER,
      missionId: 'm-1',
      reward: 2_000,
    });
    h.clock.advance(1_200_000);
    const r3 = h.dmQueue.enqueue(USER, 'marketplace_outbid', {
      type: 'MarketplaceOutbid',
      guildId: GUILD,
      at: h.clock.now(),
      userId: USER,
      listingId: 9,
      newBid: 5_000,
    });
    expect(r2.enqueued && r2.nextAttemptAt).toBe(START_MS + 3_600_000);
    expect(r3.enqueued && r3.nextAttemptAt).toBe(START_MS + 3_600_000);

    // Still inside the 1h window → nothing sent yet.
    expect((await h.dmQueue.processDue()).sentUsers).toBe(0);
    expect(h.port.dms).toHaveLength(1);

    // Advance to the hourly boundary → both coalesce into ONE digest DM with 2 fields.
    h.clock.advance(1_800_000);
    const digestReport = await h.dmQueue.processDue();
    expect(digestReport.sentUsers).toBe(1);
    expect(digestReport.sentItems).toBe(2);
    expect(h.port.dms).toHaveLength(2);
    expect(h.port.dms[1]?.message.embeds?.[0]?.fields).toHaveLength(2);
    expect(h.port.dms[1]?.message.embeds?.[0]?.title).toContain('2');

    // When dm_digest is disabled, a new DM sends immediately without waiting an hour.
    h.config.setUserDmDigest(USER, false);
    h.clock.advance(60_000);
    const r4 = h.dmQueue.enqueue(USER, 'daily_ready', {
      type: 'DailyReady',
      guildId: GUILD,
      at: h.clock.now(),
      userId: USER,
    });
    expect(r4.enqueued && r4.nextAttemptAt).toBe(h.clock.now());
    expect((await h.dmQueue.processDue()).sentItems).toBe(1);
    expect(h.port.dms).toHaveLength(3);
  });

  it('retries transient failures with exponential backoff and marks failed after maxAttempts', async () => {
    let mode: 'transient' | 'ok' = 'transient';
    const port = createFakeDiscordPort({
      onSendDm: () =>
        mode === 'transient'
          ? { ok: false, reason: 'transient', message: 'timeout' }
          : { ok: true, messageId: 'dm-ok' },
    });
    const h = makeDmHarness({
      port,
      baseBackoffMs: 10_000,
      maxBackoffMs: 40_000,
      maxAttempts: 3,
    });
    h.config.setUserKindPref(USER, 'loan_due', { dm: true });

    h.dmQueue.enqueue(USER, 'loan_due', {
      type: 'LoanDue',
      guildId: GUILD,
      at: h.clock.now(),
      userId: USER,
      loanId: 1,
      amount: 10_000,
      dueAt: h.clock.now() + 86_400_000,
    });

    // Attempt 1 fails → backoff 10s.
    expect((await h.dmQueue.processDue()).retriedItems).toBe(1);
    h.clock.advance(9_999);
    expect((await h.dmQueue.processDue()).retriedItems).toBe(0);
    h.clock.advance(1);

    // Attempt 2 fails → backoff 20s.
    expect((await h.dmQueue.processDue()).retriedItems).toBe(1);
    h.clock.advance(19_999);
    expect((await h.dmQueue.processDue()).failedItems).toBe(0);
    h.clock.advance(1);

    // Attempt 3 fails → reaches maxAttempts (3) → marked 'failed'.
    expect((await h.dmQueue.processDue()).failedItems).toBe(1);
    const row = h.store
      .stmt('SELECT status, attempts, last_error FROM notification_queue WHERE user_id = ?')
      .get(USER) as { status: string; attempts: number; last_error: string };
    expect(row).toEqual({ status: 'failed', attempts: 3, last_error: 'timeout' });

    // Recovery of a stuck 'sending' row works on restart.
    mode = 'ok';
    h.store
      .stmt("UPDATE notification_queue SET status = 'sending', attempts = 0 WHERE user_id = ?")
      .run(USER);
    expect(h.dmQueue.recoverStuckSending()).toBe(1);
    expect((await h.dmQueue.processDue()).sentItems).toBe(1);
  });

  it('disables all DMs for a user on dm_closed, drops remaining pending items, and writes an inbox note', async () => {
    const port = createFakeDiscordPort({
      onSendDm: () => ({ ok: false, reason: 'dm_closed', message: '50007' }),
    });
    const h = makeDmHarness({ port });
    h.config.setUserKindPref(USER, 'loan_due', { dm: true });
    h.config.setUserKindPref(USER, 'daily_ready', { dm: true });

    h.dmQueue.enqueue(USER, 'loan_due', {
      type: 'LoanDue',
      guildId: GUILD,
      at: h.clock.now(),
      userId: USER,
      loanId: 2,
      amount: 5_000,
      dueAt: h.clock.now() + 3_600_000,
    });
    // Also seed a future pending row to verify it gets dropped too.
    h.store
      .stmt(
        `INSERT INTO notification_queue
           (user_id, guild_id, kind, payload, dedupe_key, status, attempts, next_attempt_at, created_at)
         VALUES (?, ?, 'daily_ready', ?, 'future-1', 'pending', 0, ?, ?)`,
      )
      .run(
        USER,
        GUILD,
        JSON.stringify({ type: 'DailyReady', guildId: GUILD, at: h.clock.now(), userId: USER }),
        h.clock.now() + 99_999,
        h.clock.now(),
      );

    const report = await h.dmQueue.processDue();
    expect(report.disabledUsers).toBe(1);
    expect(report.droppedItems).toBe(2);

    // All DM kinds disabled for USER.
    const prefs = h.config.getUserPrefs(USER);
    expect(prefs.kinds.loan_due.dm).toBe(false);
    expect(prefs.kinds.daily_ready.dm).toBe(false);

    // No pending rows left.
    expect(
      h.store
        .stmt(
          "SELECT COUNT(*) AS n FROM notification_queue WHERE user_id = ? AND status = 'pending'",
        )
        .get(USER),
    ).toEqual({ n: 0 });

    // Inbox note written + live inbox:new, warning toast, and inbox:unread emitted.
    expect(h.inboxNewEvents).toHaveLength(1);
    expect(h.inboxNewEvents[0]?.item.kind).toBe('dm_disabled');
    expect(h.toastEvents).toHaveLength(1);
    expect(h.toastEvents[0]?.toast.tone).toBe('warning');
    expect(h.unreadEvents).toEqual([{ userId: USER, guildId: GUILD, unread: 1 }]);
  });

  it('uses the GUILD language for announcements and the USER language for DMs', async () => {
    const store = memoryStore();
    const clock = manualClock(START_MS);
    const bus = new EventBus();
    const port = createFakeDiscordPort({ guildLocales: { [GUILD]: 'ja' } });

    const handle = attachNotify({
      bus,
      store,
      clock,
      logger: silentLogger,
      defaultAnnounceChannelId: DEFAULT_CHANNEL,
      port,
      batchWindowMs: 0,
      pollIntervalMs: 0,
    });

    // Guild is 'ja', USER prefers 'en', OTHER_USER has auto (null → inherits guild 'ja').
    handle.config.setGuildLocale(GUILD, 'ja');
    store.stmt('INSERT INTO users (user_id, created_at, updated_at) VALUES (?, 0, 0)').run(USER);
    store
      .stmt("INSERT INTO user_settings (user_id, locale, updated_at) VALUES (?, 'en', 0)")
      .run(USER);
    handle.config.setUserKindPref(USER, 'race_result', { dm: true });
    handle.config.setUserKindPref(OTHER_USER, 'race_result', { dm: true });

    bus.publishDomain({
      type: 'RaceFinished',
      guildId: GUILD,
      at: clock.now(),
      raceId: 7,
      placings: [4, 2, 1],
      ownerIds: [USER],
      bettorIds: [OTHER_USER],
    });

    await handle.flush();

    // Guild announcement is in Japanese.
    expect(port.channelPosts).toHaveLength(1);
    expect(port.channelPosts[0]?.message.embeds?.[0]?.title).toBe('第7回レース 確定');

    // USER's DM is in English; OTHER_USER's DM falls back to Japanese.
    const dmUser = port.dms.find((d) => d.userId === USER);
    const dmOther = port.dms.find((d) => d.userId === OTHER_USER);
    expect(dmUser?.message.embeds?.[0]?.title).toBe('Race #7 Finished');
    expect(dmOther?.message.embeds?.[0]?.title).toBe('第7回レース 確定');

    handle.stop();
  });
});

describe('End-to-end notify boot with server + Socket.io live inbox & toast', () => {
  const cleanups: (() => Promise<void>)[] = [];
  afterEach(async () => {
    for (const fn of cleanups.splice(0).reverse()) await fn();
  });

  it('boots server with dummy env + fake notify port, writes inbox, emits inbox:new/toast/inbox:unread, and deduplicates RaceFinished recipients', async () => {
    const srv = createTestServer();
    cleanups.push(() => srv.close());

    const fakePort = createFakeDiscordPort({ guildLocales: { [GUILD]: 'en' } });
    const notify = attachNotify({
      bus: srv.bus,
      store: srv.store,
      clock: srv.clock,
      logger: srv.logger,
      defaultAnnounceChannelId: srv.config.announceChannelId,
      port: fakePort,
      io: srv.io,
      batchWindowMs: 0,
      pollIntervalMs: 0,
    });
    cleanups.push(async () => notify.stop());

    // Opt USER into race_result DMs; OTHER_USER stays opted out.
    notify.config.setUserKindPref(USER, 'race_result', { dm: true });

    const address = await srv.listen();
    const loginRes = await srv.app.inject({
      method: 'POST',
      url: '/api/token',
      headers: srv.signed(),
      payload: { code: 'test-code', guildId: GUILD, instanceId: INSTANCE },
    });
    expect(loginRes.statusCode).toBe(200);
    const { sessionToken } = loginRes.json<{ sessionToken: string }>();

    const socket: ClientSocket<ServerToClientEvents, ClientToServerEvents> = clientIo(address, {
      path: SOCKET_PATH,
      transports: ['websocket'],
      auth: { token: sessionToken },
      extraHeaders: srv.signed(),
      reconnection: false,
      forceNew: true,
    });
    cleanups.push(
      () =>
        new Promise<void>((resolve) => {
          socket.disconnect();
          resolve();
        }),
    );

    await new Promise<void>((resolve, reject) => {
      socket.once('connect', () => resolve());
      socket.once('connect_error', reject);
    });

    const receivedInboxNew = new Promise<InboxItem>((resolve) => socket.once('inbox:new', resolve));
    const receivedToast = new Promise<Toast>((resolve) => socket.once('toast', resolve));
    const receivedUnread = new Promise<InboxUnread>((resolve) =>
      socket.once('inbox:unread', resolve),
    );

    // USER is BOTH owner and bettor → must be deduplicated to 1 inbox entry and 1 DM.
    srv.bus.publishDomain({
      type: 'RaceFinished',
      guildId: GUILD,
      at: srv.clock.now(),
      raceId: 42,
      placings: [5, 1, 8],
      ownerIds: [USER],
      bettorIds: [USER, OTHER_USER],
    });

    const [inboxItem, toast, unread] = await Promise.all([
      receivedInboxNew,
      receivedToast,
      receivedUnread,
    ]);
    await notify.flush();

    expect(inboxItem.kind).toBe('race_result');
    expect(inboxItem.guildId).toBe(GUILD);
    expect(toast).toEqual({
      guildId: GUILD,
      tone: 'info',
      messageKey: 'inbox.kind.race_result',
    });
    expect(unread).toEqual({ guildId: GUILD, unread: 1 });

    // Readable through B1b's InboxService and HTTP GET /api/inbox.
    const page = srv.inbox.page(USER, GUILD);
    expect(page.items).toHaveLength(1);
    expect(page.unread).toBe(1);
    expect(srv.inbox.page(OTHER_USER, GUILD).items).toHaveLength(1);

    const httpInbox = await srv.app.inject({
      method: 'GET',
      url: '/api/inbox',
      headers: { ...srv.signed(), authorization: `Bearer ${sessionToken}` },
    });
    expect(httpInbox.statusCode).toBe(200);
    expect(httpInbox.json<{ unread: number; items: InboxItem[] }>().unread).toBe(1);

    // Fake port got 1 channel post and 1 DM (only USER opted in; deduped across owner+bettor).
    expect(fakePort.channelPosts).toHaveLength(1);
    expect(fakePort.dms).toHaveLength(1);
    expect(fakePort.dms[0]?.userId).toBe(USER);

    // After stop(), bus events are no longer processed by notify.
    notify.stop();
    srv.bus.publishDomain({
      type: 'DailyReady',
      guildId: GUILD,
      at: srv.clock.now() + 1,
      userId: USER,
    });
    await notify.flush();
    expect(srv.inbox.unread(USER, GUILD)).toBe(1);
  });

  it('boots and flushes cleanly with default noop port when the bot is disabled', async () => {
    const srv = createTestServer();
    cleanups.push(() => srv.close());

    const notify = attachNotify({
      bus: srv.bus,
      store: srv.store,
      clock: srv.clock,
      logger: srv.logger,
      defaultAnnounceChannelId: srv.config.announceChannelId,
      io: srv.io,
      batchWindowMs: 0,
      pollIntervalMs: 0,
    });
    cleanups.push(async () => notify.stop());

    notify.config.setPersonasEnabled(GUILD, true);
    notify.config.setUserKindPref(USER, 'daily_ready', { dm: true });

    srv.bus.publishDomain({
      type: 'RaceScheduled',
      guildId: GUILD,
      at: srv.clock.now(),
      raceId: 1,
      startsAt: srv.clock.now() + 60_000,
      entrants: 8,
    });
    srv.bus.publishDomain({
      type: 'DailyReady',
      guildId: GUILD,
      at: srv.clock.now(),
      userId: USER,
    });

    const result = await notify.flush();
    expect(result.announcements.sent).toBe(1);
    expect(result.dms.sentItems).toBe(1);
    expect(srv.inbox.unread(USER, GUILD)).toBe(1);
  });
});
