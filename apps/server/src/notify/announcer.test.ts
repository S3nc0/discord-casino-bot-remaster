import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';
import { manualClock } from '@casino/shared';
import { applyPragmas } from '../db/pragmas.ts';
import { runMigrations } from '../db/migrate.ts';
import { migrations } from '../db/migrations/index.ts';
import { createLogger } from '../runtime/logger.ts';
import { GUILD, memoryStore, OTHER_GUILD, START_MS, USER } from '../runtime/test-kit.ts';
import { Announcer, GuildRateLimiter, shouldAnnounceEvent } from './announcer.ts';
import { NotifyConfigService } from './config-service.ts';
import type { SubscribedDomainEvent } from './messages.ts';
import { WebhookPersonaManager } from './personas.ts';
import { createFakeDiscordPort } from './ports.ts';

const DEFAULT_CHANNEL = '456789012345678901';
const CUSTOM_CHANNEL = '556789012345678902';
const RACE_CHANNEL = '656789012345678903';
const silentLogger = createLogger({ level: 'silent' });

function makeHarness(
  overrides: {
    batchWindowMs?: number;
    maxBatchSize?: number;
    rateWindowMs?: number;
    permissionCooldownMs?: number;
    port?: ReturnType<typeof createFakeDiscordPort>;
  } = {},
) {
  const store = memoryStore();
  const clock = manualClock(START_MS);
  const port = overrides.port ?? createFakeDiscordPort();
  const config = new NotifyConfigService({
    store,
    clock,
    defaultAnnounceChannelId: DEFAULT_CHANNEL,
  });
  const personas = new WebhookPersonaManager({
    store,
    port,
    clock,
    logger: silentLogger,
    avatarBaseUrl: 'https://api.example.com',
    ...(overrides.permissionCooldownMs === undefined
      ? {}
      : { permissionCooldownMs: overrides.permissionCooldownMs }),
  });
  const announcer = new Announcer({
    configService: config,
    port,
    personas,
    clock,
    logger: silentLogger,
    ...(overrides.batchWindowMs === undefined ? {} : { batchWindowMs: overrides.batchWindowMs }),
    ...(overrides.maxBatchSize === undefined ? {} : { maxBatchSize: overrides.maxBatchSize }),
    ...(overrides.rateWindowMs === undefined ? {} : { rateWindowMs: overrides.rateWindowMs }),
  });
  return { store, clock, port, config, personas, announcer };
}

describe('0006_notify_webhooks migration', () => {
  it('adds guild_config.personas_enabled (default 0) and guild_webhooks with checks and FK', () => {
    const db = new Database(':memory:');
    applyPragmas(db);
    runMigrations(
      db,
      migrations.filter((m) => m.version <= 5),
    );
    db.prepare(
      "INSERT INTO guilds (guild_id, status, created_at, updated_at) VALUES (?, 'approved', 0, 0)",
    ).run(GUILD);
    db.prepare('INSERT INTO guild_config (guild_id, updated_at) VALUES (?, 0)').run(GUILD);

    expect(
      runMigrations(
        db,
        migrations.filter((m) => m.version <= 6),
      ),
    ).toEqual([6]);

    const cfg = db
      .prepare('SELECT personas_enabled FROM guild_config WHERE guild_id = ?')
      .get(GUILD) as { personas_enabled: number };
    expect(cfg.personas_enabled).toBe(0);

    // Rejects invalid personas_enabled and invalid persona name.
    expect(() =>
      db.prepare('UPDATE guild_config SET personas_enabled = 2 WHERE guild_id = ?').run(GUILD),
    ).toThrow(/CHECK/);
    expect(() =>
      db
        .prepare(
          `INSERT INTO guild_webhooks (guild_id, persona, channel_id, webhook_id, token, created_at, updated_at)
           VALUES (?, 'invalid_persona', ?, 'w1', 't1', 0, 0)`,
        )
        .run(GUILD, DEFAULT_CHANNEL),
    ).toThrow(/CHECK/);

    // Cascade deletes webhooks when the guild is removed.
    db.prepare(
      `INSERT INTO guild_webhooks (guild_id, persona, channel_id, webhook_id, token, created_at, updated_at)
       VALUES (?, 'race_caller', ?, 'w1', 't1', 0, 0)`,
    ).run(GUILD, DEFAULT_CHANNEL);
    db.prepare('DELETE FROM guilds WHERE guild_id = ?').run(GUILD);
    expect(db.prepare('SELECT COUNT(*) AS n FROM guild_webhooks').get()).toEqual({ n: 0 });
  });
});

describe('NotifyConfigService (/admin notifications surface)', () => {
  it('defaults to ANNOUNCE_CHANNEL_ID and persists channel, locale, threshold, rate, types, and personas', () => {
    const { config } = makeHarness();

    const initial = config.getGuildConfig(GUILD);
    expect(initial.announceChannelId).toBeNull();
    expect(initial.effectiveChannelId).toBe(DEFAULT_CHANNEL);
    expect(initial.locale).toBeNull();
    expect(initial.announceEnabled).toBe(true);
    expect(initial.bigWinThreshold).toBe(100_000);
    expect(initial.announcePerMinute).toBe(6);
    expect(initial.personasEnabled).toBe(false);
    expect(initial.eventTypes.BigWin.enabled).toBe(true);
    expect(initial.eventTypes.DailyReady.enabled).toBe(false);

    config.setAnnounceChannel(GUILD, CUSTOM_CHANNEL);
    config.setGuildLocale(GUILD, 'ja');
    config.setBigWinThreshold(GUILD, 50_000);
    config.setAnnounceRateLimit(GUILD, 12);
    config.setPersonasEnabled(GUILD, true);
    config.setEventTypeConfig(GUILD, 'RaceFinished', { enabled: true, channelId: RACE_CHANNEL });
    config.setEnabledEventTypes(GUILD, { BigWin: false, DailyReady: true });

    const updated = config.getGuildConfig(GUILD);
    expect(updated.announceChannelId).toBe(CUSTOM_CHANNEL);
    expect(updated.effectiveChannelId).toBe(CUSTOM_CHANNEL);
    expect(updated.locale).toBe('ja');
    expect(updated.bigWinThreshold).toBe(50_000);
    expect(updated.announcePerMinute).toBe(12);
    expect(updated.personasEnabled).toBe(true);
    expect(updated.eventTypes.RaceFinished).toEqual({ enabled: true, channelId: RACE_CHANNEL });
    expect(updated.eventTypes.BigWin.enabled).toBe(false);
    expect(updated.eventTypes.DailyReady.enabled).toBe(true);
    expect(config.resolveEventChannel(GUILD, 'RaceFinished')).toBe(RACE_CHANNEL);
    expect(config.resolveEventChannel(GUILD, 'Jackpot')).toBe(CUSTOM_CHANNEL);

    // Clearing channel falls back to ANNOUNCE_CHANNEL_ID.
    config.setAnnounceChannel(GUILD, null);
    expect(config.getGuildConfig(GUILD).effectiveChannelId).toBe(DEFAULT_CHANNEL);

    // Validation bounds.
    expect(() => config.setBigWinThreshold(GUILD, -1)).toThrow(RangeError);
    expect(() => config.setAnnounceRateLimit(GUILD, 0)).toThrow(RangeError);
    expect(() => config.setAnnounceRateLimit(GUILD, 61)).toThrow(RangeError);
  });
});

describe('GuildRateLimiter math', () => {
  it('enforces exact sliding-window counts, retryAfterMs, per-guild isolation, and external backoff', () => {
    const limiter = new GuildRateLimiter(60_000);

    // Limit of 2 per 60s: send at t=1000 and t=25_000.
    expect(limiter.tryConsume(GUILD, 2, 1_000)).toEqual({
      allowed: true,
      retryAfterMs: 0,
      remaining: 1,
    });
    expect(limiter.tryConsume(GUILD, 2, 25_000)).toEqual({
      allowed: true,
      retryAfterMs: 0,
      remaining: 0,
    });

    // At t=30_000, oldest entry (1_000) expires at 61_000 → retryAfterMs = 31_000.
    expect(limiter.tryConsume(GUILD, 2, 30_000)).toEqual({
      allowed: false,
      retryAfterMs: 31_000,
      remaining: 0,
    });

    // Other guild is unaffected.
    expect(limiter.tryConsume(OTHER_GUILD, 2, 30_000).allowed).toBe(true);

    // At t=61_000, first slot frees up while second (25_000) still counts.
    expect(limiter.tryConsume(GUILD, 2, 61_000)).toEqual({
      allowed: true,
      retryAfterMs: 0,
      remaining: 0,
    });
    expect(limiter.peek(GUILD, 2, 61_000)).toEqual({
      allowed: false,
      retryAfterMs: 24_000, // 25_000 + 60_000 - 61_000
      remaining: 0,
    });

    // External Discord 429 backoff overrides available quota.
    limiter.applyBackoff(OTHER_GUILD, 45_000);
    expect(limiter.tryConsume(OTHER_GUILD, 2, 40_000)).toEqual({
      allowed: false,
      retryAfterMs: 5_000,
      remaining: 0,
    });
    expect(limiter.tryConsume(OTHER_GUILD, 2, 45_000).allowed).toBe(true);
  });
});

describe('Announcer batching, threshold, rate-limiting, language, and personas', () => {
  it('filters GameSettled by per-guild bigWinThreshold and positive net profit', () => {
    const { config } = makeHarness();
    config.setBigWinThreshold(GUILD, 100_000);
    const cfg = config.getGuildConfig(GUILD);

    const small: SubscribedDomainEvent = {
      type: 'GameSettled',
      guildId: GUILD,
      at: START_MS,
      userId: USER,
      game: 'slots',
      roundId: '1',
      stake: 10_000,
      payout: 99_999,
      net: 89_999,
      source: 'activity',
    };
    const breakEven: SubscribedDomainEvent = {
      ...small,
      roundId: '2',
      stake: 100_000,
      payout: 100_000,
      net: 0,
    };
    const bigWin: SubscribedDomainEvent = {
      ...small,
      roundId: '3',
      stake: 10_000,
      payout: 100_000,
      net: 90_000,
    };

    expect(shouldAnnounceEvent(small, cfg)).toBe(false);
    expect(shouldAnnounceEvent(breakEven, cfg)).toBe(false);
    expect(shouldAnnounceEvent(bigWin, cfg)).toBe(true);

    // Master switch off suppresses all events.
    config.setAnnounceEnabled(GUILD, false);
    expect(shouldAnnounceEvent(bigWin, config.getGuildConfig(GUILD))).toBe(false);
  });

  it('coalesces a burst into one message and defers cleanly when per-guild rate limit is hit', async () => {
    const { clock, port, config, announcer } = makeHarness({
      batchWindowMs: 2_000,
      maxBatchSize: 5,
      rateWindowMs: 60_000,
    });
    config.setAnnounceRateLimit(GUILD, 1);

    // Enqueue 3 events within 1 s → should stay buffered until batchWindowMs elapses.
    announcer.enqueue({
      type: 'BigWin',
      guildId: GUILD,
      at: clock.now(),
      userId: USER,
      game: 'slots',
      roundId: 'r1',
      payout: 200_000,
      multiplierBps: 20_000,
    });
    clock.advance(500);
    announcer.enqueue({
      type: 'Jackpot',
      guildId: GUILD,
      at: clock.now(),
      userId: USER,
      game: 'pachinko',
      amount: 500_000,
    });
    clock.advance(500);
    announcer.enqueue({
      type: 'TitleAwarded',
      guildId: GUILD,
      at: clock.now(),
      userId: USER,
      titleId: 'weekly_king',
      week: '2026-11-16',
    });

    // Not due yet (only 1s passed, window is 2s).
    expect(await announcer.flushDue()).toEqual({ sent: 0, deferred: 0, failed: 0 });
    expect(port.channelPosts).toHaveLength(0);

    // Advance past batch window → coalesced into 1 message with 3 fields.
    clock.advance(1_000);
    expect(await announcer.flushDue()).toEqual({ sent: 1, deferred: 0, failed: 0 });
    expect(port.channelPosts).toHaveLength(1);
    expect(port.channelPosts[0]?.channelId).toBe(DEFAULT_CHANNEL);
    expect(port.channelPosts[0]?.message.embeds?.[0]?.fields).toHaveLength(3);

    // Rate limit is 1/min, so a new burst 10s later is deferred (not dropped) and keeps coalescing.
    clock.advance(10_000);
    announcer.enqueue({
      type: 'Jackpot',
      guildId: GUILD,
      at: clock.now(),
      userId: USER,
      game: 'roulette',
      amount: 300_000,
    });
    clock.advance(2_000);
    expect(await announcer.flushDue()).toEqual({ sent: 0, deferred: 1, failed: 0 });
    expect(port.channelPosts).toHaveLength(1);

    // Another event arrives while waiting for the rate-limit window → joins the deferred batch.
    clock.advance(5_000);
    announcer.enqueue({
      type: 'BigWin',
      guildId: GUILD,
      at: clock.now(),
      userId: USER,
      game: 'blackjack',
      roundId: 'r2',
      payout: 150_000,
      multiplierBps: 30_000,
    });

    // Advance past the 60s window from the first send (t0 + 2s + 60s = t0 + 62s; currently at t0 + 19s).
    clock.advance(43_000);
    expect(await announcer.flushDue()).toEqual({ sent: 1, deferred: 0, failed: 0 });
    expect(port.channelPosts).toHaveLength(2);
    expect(port.channelPosts[1]?.message.embeds?.[0]?.fields).toHaveLength(2);
  });

  it('requeues on Discord 429 rate_limited response and delivers after retryAfterMs', async () => {
    let failOnce = true;
    const port = createFakeDiscordPort({
      onPostToChannel() {
        if (failOnce) {
          failOnce = false;
          return { ok: false, reason: 'rate_limited', retryAfterMs: 15_000 };
        }
        return { ok: true, messageId: 'ok-1' };
      },
    });
    const { clock, announcer } = makeHarness({ batchWindowMs: 1_000, port });

    announcer.enqueue({
      type: 'Jackpot',
      guildId: GUILD,
      at: clock.now(),
      userId: USER,
      game: 'slots',
      amount: 999_000,
    });
    clock.advance(1_000);
    expect(await announcer.flushDue()).toEqual({ sent: 0, deferred: 1, failed: 0 });
    expect(announcer.pendingCount).toBe(1);

    clock.advance(10_000);
    expect(await announcer.flushDue()).toEqual({ sent: 0, deferred: 0, failed: 0 });

    clock.advance(5_000);
    expect(await announcer.flushDue()).toEqual({ sent: 1, deferred: 0, failed: 0 });
    expect(announcer.pendingCount).toBe(0);
  });

  it('renders announcements in the guild locale (DB override → Discord guild preferredLocale → en)', async () => {
    const port = createFakeDiscordPort({
      guildLocales: {
        [GUILD]: 'ja',
        [OTHER_GUILD]: 'fr-FR',
      },
    });
    const { clock, config, announcer } = makeHarness({ batchWindowMs: 0, port });

    // GUILD has no DB locale override → resolves from Discord preferredLocale 'ja'.
    announcer.enqueue({
      type: 'Jackpot',
      guildId: GUILD,
      at: clock.now(),
      userId: USER,
      game: 'slots',
      amount: 100_000,
    });
    // OTHER_GUILD has unsupported 'fr-FR' → falls back to 'en'.
    announcer.enqueue({
      type: 'Jackpot',
      guildId: OTHER_GUILD,
      at: clock.now(),
      userId: USER,
      game: 'slots',
      amount: 100_000,
    });
    await announcer.flushAll();

    expect(port.channelPosts[0]?.message.embeds?.[0]?.title).toBe('ジャックポット！');
    expect(port.channelPosts[1]?.message.embeds?.[0]?.title).toBe('Jackpot!');

    // Explicit DB override switches GUILD to 'en' even though Discord reports 'ja'.
    config.setGuildLocale(GUILD, 'en');
    announcer.enqueue({
      type: 'Jackpot',
      guildId: GUILD,
      at: clock.now(),
      userId: USER,
      game: 'slots',
      amount: 200_000,
    });
    await announcer.flushAll();
    expect(port.channelPosts[2]?.message.embeds?.[0]?.title).toBe('Jackpot!');
  });

  it('creates webhook personas lazily only when enabled, reuses cached webhooks, and falls back on error/missing permissions', async () => {
    const port = createFakeDiscordPort({ guildLocales: { [GUILD]: 'ja' } });
    const { clock, config, announcer } = makeHarness({ batchWindowMs: 0, port });

    // Personas OFF by default → createWebhook is never called.
    announcer.enqueue({
      type: 'RaceScheduled',
      guildId: GUILD,
      at: clock.now(),
      raceId: 1,
      startsAt: clock.now() + 60_000,
      entrants: 8,
    });
    await announcer.flushAll();
    expect(port.createdWebhooks).toHaveLength(0);
    expect(port.webhookPosts).toHaveLength(0);
    expect(port.channelPosts).toHaveLength(1);

    // Enable personas → creates 3 distinct personas (競馬実況, 証券ニュース, 帝愛銀行) with avatars.
    config.setPersonasEnabled(GUILD, true);
    announcer.enqueue({
      type: 'RaceScheduled',
      guildId: GUILD,
      at: clock.now(),
      raceId: 2,
      startsAt: clock.now() + 60_000,
      entrants: 8,
    });
    announcer.enqueue({
      type: 'MarketMove',
      guildId: GUILD,
      at: clock.now(),
      ticker: 'CS',
      direction: 'spike',
      changeBps: 1500,
      price: 20_000_000,
    });
    announcer.enqueue({
      type: 'BankruptcyDeclared',
      guildId: GUILD,
      at: clock.now(),
      userId: USER,
      cause: 'voluntary',
      debtBefore: 20_000,
      debtAfter: 5_000,
    });
    await announcer.flushAll();

    expect(port.createdWebhooks.map((w) => w.identity.name)).toEqual([
      '競馬実況',
      '証券ニュース',
      '帝愛銀行',
    ]);
    for (const w of port.createdWebhooks) {
      expect(w.identity.avatarUrl).toMatch(
        /^https:\/\/api\.example\.com\/assets\/personas\/.+\.png$/,
      );
    }
    expect(port.webhookPosts).toHaveLength(3);

    // Subsequent race event reuses the cached webhook without calling createWebhook again.
    announcer.enqueue({
      type: 'RaceFinished',
      guildId: GUILD,
      at: clock.now(),
      raceId: 2,
      placings: [1, 2, 3],
      ownerIds: [],
      bettorIds: [],
    });
    await announcer.flushAll();
    expect(port.createdWebhooks).toHaveLength(3);
    expect(port.webhookPosts).toHaveLength(4);
  });

  it('falls back to bot channel post when Manage Webhooks permission is missing or webhook delivery fails', async () => {
    const permDeniedPort = createFakeDiscordPort({
      onCreateWebhook: () => ({ ok: false, reason: 'missing_permissions' }),
    });
    const h1 = makeHarness({
      batchWindowMs: 0,
      permissionCooldownMs: 60_000,
      port: permDeniedPort,
    });
    h1.config.setPersonasEnabled(GUILD, true);

    h1.announcer.enqueue({
      type: 'MarketMove',
      guildId: GUILD,
      at: h1.clock.now(),
      ticker: 'CS',
      direction: 'crash',
      changeBps: -2000,
      price: 5_000_000,
    });
    await h1.announcer.flushAll();
    expect(permDeniedPort.createdWebhooks).toHaveLength(1);
    expect(permDeniedPort.webhookPosts).toHaveLength(0);
    expect(permDeniedPort.channelPosts).toHaveLength(1);

    // During cooldown, falls back directly without hammering createWebhook.
    h1.announcer.enqueue({
      type: 'MarketMove',
      guildId: GUILD,
      at: h1.clock.now(),
      ticker: 'TB',
      direction: 'spike',
      changeBps: 1000,
      price: 9_000_000,
    });
    await h1.announcer.flushAll();
    expect(permDeniedPort.createdWebhooks).toHaveLength(1);
    expect(permDeniedPort.channelPosts).toHaveLength(2);

    // Stale unknown_webhook: evicts, attempts one recreate, and falls back if post still fails.
    let postCalls = 0;
    const flakyPort = createFakeDiscordPort({
      onPostViaWebhook() {
        postCalls += 1;
        if (postCalls === 1) return { ok: false, reason: 'unknown_webhook' };
        return { ok: false, reason: 'error', message: 'upstream 500' };
      },
    });
    const h2 = makeHarness({ batchWindowMs: 0, port: flakyPort });
    h2.config.setPersonasEnabled(GUILD, true);
    h2.announcer.enqueue({
      type: 'BankruptcyGraceStarted',
      guildId: GUILD,
      at: h2.clock.now(),
      userId: USER,
      debt: 15_000,
      graceEndsAt: h2.clock.now() + 86_400_000,
    });
    await h2.announcer.flushAll();
    expect(flakyPort.channelPosts).toHaveLength(1);
  });

  it('announces HorseFoaled in the guild channel only when statTotal >= 205', async () => {
    const h = makeHarness({ batchWindowMs: 0 });
    const baseFoal = {
      type: 'HorseFoaled' as const,
      guildId: GUILD,
      at: h.clock.now(),
      userId: USER,
      foalId: 10,
      foalName: 'Comet',
      parentIds: [1, 2] as [number, number],
      generation: 1,
      maturesAt: h.clock.now() + 86_400_000,
    };

    expect(h.announcer.enqueue({ ...baseFoal, statTotal: 204 })).toBe(false);
    expect(h.announcer.enqueue({ ...baseFoal, foalId: 11, statTotal: 205 })).toBe(true);
    await h.announcer.flushAll();
    expect(h.port.channelPosts).toHaveLength(1);
    expect(h.port.channelPosts[0]?.message.embeds?.[0]?.description).toContain('Comet');
  });

  it('announces Teiai relic listings in the guild channel with the item, price and a launch button', async () => {
    const h = makeHarness({ batchWindowMs: 0 });
    const event = {
      type: 'TeiaiRelicListed' as const,
      guildId: GUILD,
      at: h.clock.now(),
      listingId: 4,
      itemId: 'relic_tear',
      startPrice: 100_000,
      endAt: h.clock.now() + 86_400_000,
    };
    expect(h.announcer.enqueue(event)).toBe(true);
    await h.announcer.flushAll();
    expect(h.port.channelPosts).toHaveLength(1);
    const post = h.port.channelPosts[0]?.message;
    const embed = post?.embeds?.[0];
    expect(embed?.title).toContain('Dragon’s tear');
    expect(embed?.description).toContain('100,000');
    expect(post?.openInActivity).toBe(true);
    expect(post?.activityScreen).toBe('market');
  });
});

describe('R-9: shared ANNOUNCE_CHANNEL_ID fallback', () => {
  const bigWin = (guildId: string, roundId: string, at: number): SubscribedDomainEvent => ({
    type: 'BigWin',
    guildId,
    at,
    userId: USER,
    game: 'slots',
    roundId,
    payout: 200_000,
    multiplierBps: 20_000,
  });

  it("R-9: a guild without its own channel never posts into another guild's fallback channel", async () => {
    const port = createFakeDiscordPort({ channelGuilds: { [DEFAULT_CHANNEL]: GUILD } });
    const { clock, config, announcer } = makeHarness({ port });
    expect(config.getGuildConfig(OTHER_GUILD).announceChannelId).toBeNull();

    announcer.enqueue(bigWin(OTHER_GUILD, 'b1', clock.now()));
    announcer.enqueue(bigWin(GUILD, 'a1', clock.now()));
    clock.advance(3_000);
    await announcer.flushDue();

    expect(port.channelPosts).toHaveLength(1);
    expect(port.channelPosts[0]?.channelId).toBe(DEFAULT_CHANNEL);
    expect(announcer.pendingCount).toBe(0);
  });

  it('R-9: two guilds that share one explicit channel share its per-minute limit', async () => {
    const { clock, port, config, announcer } = makeHarness();
    config.setAnnounceChannel(GUILD, CUSTOM_CHANNEL);
    config.setAnnounceChannel(OTHER_GUILD, CUSTOM_CHANNEL);
    config.setAnnounceRateLimit(GUILD, 1);
    config.setAnnounceRateLimit(OTHER_GUILD, 1);

    announcer.enqueue(bigWin(GUILD, 'a1', clock.now()));
    announcer.enqueue(bigWin(OTHER_GUILD, 'b1', clock.now()));
    clock.advance(3_000);
    expect(await announcer.flushDue()).toEqual({ sent: 1, deferred: 1, failed: 0 });
    expect(port.channelPosts).toHaveLength(1);
  });
});
