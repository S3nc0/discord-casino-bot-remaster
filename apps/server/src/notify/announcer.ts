import type { Clock } from '@casino/shared';
import type { Logger } from 'pino';
import type { GuildNotifyConfig, NotifyConfigService } from './config-service.ts';
import {
  EVENT_META,
  renderAnnouncementBatch,
  type PersonaId,
  type SubscribedDomainEvent,
} from './messages.ts';
import type { WebhookPersonaManager } from './personas.ts';
import type { DiscordNotifyPort } from './ports.ts';
import { defaultEmbedTheme, type EmbedTheme } from './theme.ts';

export interface QuotaCheck {
  allowed: boolean;
  retryAfterMs: number;
  remaining: number;
}

/**
 * Sliding-window per-guild rate limiter (e.g. `announce_per_minute` messages per 60 s).
 * Also honours explicit server-side retry-after backoffs returned by Discord.
 */
export class GuildRateLimiter {
  private readonly windowMs: number;
  private readonly history = new Map<string, number[]>();
  private readonly backoffUntil = new Map<string, number>();

  constructor(windowMs = 60_000) {
    this.windowMs = windowMs;
  }

  /** Check quota without consuming a slot. */
  peek(guildId: string, limit: number, nowMs: number): QuotaCheck {
    const blocked = this.backoffUntil.get(guildId) ?? 0;
    if (blocked > nowMs) {
      return { allowed: false, retryAfterMs: blocked - nowMs, remaining: 0 };
    }
    const entries = this.pruned(guildId, nowMs);
    if (entries.length < limit) {
      return { allowed: true, retryAfterMs: 0, remaining: limit - entries.length };
    }
    const oldest = entries[0] ?? nowMs;
    return {
      allowed: false,
      retryAfterMs: Math.max(1, oldest + this.windowMs - nowMs),
      remaining: 0,
    };
  }

  /** Attempt to consume one announcement slot for `guildId` at `nowMs`. */
  tryConsume(guildId: string, limit: number, nowMs: number): QuotaCheck {
    const check = this.peek(guildId, limit, nowMs);
    if (!check.allowed) return check;
    const entries = this.pruned(guildId, nowMs);
    entries.push(nowMs);
    this.history.set(guildId, entries);
    return { allowed: true, retryAfterMs: 0, remaining: Math.max(0, limit - entries.length) };
  }

  /** Impose an external cooldown (e.g. Discord 429 `retryAfterMs`). */
  applyBackoff(guildId: string, untilMs: number): void {
    const prev = this.backoffUntil.get(guildId) ?? 0;
    if (untilMs > prev) this.backoffUntil.set(guildId, untilMs);
  }

  private pruned(guildId: string, nowMs: number): number[] {
    const cutoff = nowMs - this.windowMs;
    const existing = this.history.get(guildId);
    if (!existing || existing.length === 0) return [];
    let keepFrom = 0;
    while (keepFrom < existing.length && (existing[keepFrom] ?? 0) <= cutoff) keepFrom += 1;
    if (keepFrom === 0) return existing;
    const next = existing.slice(keepFrom);
    if (next.length === 0) this.history.delete(guildId);
    else this.history.set(guildId, next);
    return next;
  }
}

/** Pure predicate: whether `event` qualifies for guild channel announcement under `cfg`. */
export function shouldAnnounceEvent(event: SubscribedDomainEvent, cfg: GuildNotifyConfig): boolean {
  if (!cfg.announceEnabled) return false;
  if (!cfg.eventTypes[event.type].enabled) return false;
  if (event.type === 'GameSettled') {
    return event.net > 0 && event.payout >= cfg.bigWinThreshold;
  }
  return true;
}

interface PendingBatch {
  readonly key: string;
  readonly guildId: string;
  readonly channelId: string;
  readonly persona: PersonaId | null;
  readonly events: SubscribedDomainEvent[];
  firstQueuedAt: number;
  flushAt: number;
}

export interface AnnouncerOptions {
  configService: NotifyConfigService;
  port: DiscordNotifyPort;
  personas: WebhookPersonaManager;
  clock: Clock;
  logger: Logger;
  theme?: EmbedTheme;
  /** Coalescing window for bursts (ms). Default 2,000 ms. */
  batchWindowMs?: number;
  /** Max events coalesced into a single message before triggering immediate flush. Default 10. */
  maxBatchSize?: number;
  /** Hard cap per buffer key to protect memory during long outages. Default 50. */
  maxBufferedPerKey?: number;
  /** Rate-limit window length (ms). Default 60,000 ms (1 minute). */
  rateWindowMs?: number;
}

export interface FlushReport {
  sent: number;
  deferred: number;
  failed: number;
}

/**
 * Per-guild announcement pipeline: filters events by guild config & big-win threshold, coalesces
 * bursts into one message per `(guild, channel, persona)`, enforces per-guild rate limits,
 * renders in the guild's language, and delivers via optional webhook personas with bot fallback.
 */
export class Announcer {
  private readonly configService: NotifyConfigService;
  private readonly port: DiscordNotifyPort;
  private readonly personas: WebhookPersonaManager;
  private readonly clock: Clock;
  private readonly logger: Logger;
  private readonly theme: EmbedTheme;
  private readonly batchWindowMs: number;
  private readonly maxBatchSize: number;
  private readonly maxBufferedPerKey: number;
  private readonly rateLimiter: GuildRateLimiter;
  private readonly batches = new Map<string, PendingBatch>();
  private flushing = false;

  constructor(options: AnnouncerOptions) {
    this.configService = options.configService;
    this.port = options.port;
    this.personas = options.personas;
    this.clock = options.clock;
    this.logger = options.logger;
    this.theme = options.theme ?? defaultEmbedTheme;
    this.batchWindowMs = options.batchWindowMs ?? 2_000;
    this.maxBatchSize = options.maxBatchSize ?? 10;
    this.maxBufferedPerKey = options.maxBufferedPerKey ?? 50;
    this.rateLimiter = new GuildRateLimiter(options.rateWindowMs ?? 60_000);
  }

  /** Buffer an event for announcement if it passes the guild's config and threshold checks. */
  enqueue(event: SubscribedDomainEvent): boolean {
    const cfg = this.configService.getGuildConfig(event.guildId);
    if (!shouldAnnounceEvent(event, cfg)) return false;

    const channelId = cfg.eventTypes[event.type].channelId ?? cfg.effectiveChannelId;
    const persona = cfg.personasEnabled ? EVENT_META[event.type].persona : null;
    const key = `${event.guildId}:${channelId}:${persona ?? 'bot'}`;
    const now = this.clock.now();

    let batch = this.batches.get(key);
    if (!batch) {
      batch = {
        key,
        guildId: event.guildId,
        channelId,
        persona,
        events: [],
        firstQueuedAt: now,
        flushAt: now + this.batchWindowMs,
      };
      this.batches.set(key, batch);
    }

    if (batch.events.length >= this.maxBufferedPerKey) {
      batch.events.shift();
      this.logger.warn(
        { guildId: event.guildId, channelId, persona },
        'announcer buffer full; dropped oldest event',
      );
    }
    batch.events.push(event);

    if (batch.events.length >= this.maxBatchSize) {
      batch.flushAt = Math.min(batch.flushAt, now);
    }
    return true;
  }

  /** Number of buffered events currently awaiting delivery across all guilds. */
  get pendingCount(): number {
    let total = 0;
    for (const b of this.batches.values()) total += b.events.length;
    return total;
  }

  /** Earliest timestamp at which a pending batch is due to flush, or null if empty. */
  nextFlushAt(): number | null {
    let earliest: number | null = null;
    for (const b of this.batches.values()) {
      if (earliest === null || b.flushAt < earliest) earliest = b.flushAt;
    }
    return earliest;
  }

  /** Flush all batches whose coalescing window or rate-limit backoff has elapsed. */
  async flushDue(): Promise<FlushReport> {
    if (this.flushing) return { sent: 0, deferred: 0, failed: 0 };
    this.flushing = true;
    const report: FlushReport = { sent: 0, deferred: 0, failed: 0 };

    try {
      const now = this.clock.now();
      const due = [...this.batches.values()]
        .filter((b) => b.flushAt <= now && b.events.length > 0)
        .sort((a, b) => a.firstQueuedAt - b.firstQueuedAt);

      for (const batch of due) {
        const cfg = this.configService.getGuildConfig(batch.guildId);
        const currentNow = this.clock.now();
        const quota = this.rateLimiter.tryConsume(batch.guildId, cfg.announcePerMinute, currentNow);
        if (!quota.allowed) {
          batch.flushAt = currentNow + quota.retryAfterMs;
          report.deferred += 1;
          continue;
        }

        const slice = batch.events.splice(0, this.maxBatchSize);
        if (batch.events.length === 0) {
          this.batches.delete(batch.key);
        } else {
          batch.firstQueuedAt = currentNow;
          batch.flushAt = currentNow + this.batchWindowMs;
        }

        const locale = await this.configService.resolveGuildLocale(batch.guildId, (gid) =>
          this.port.fetchGuildLocale(gid),
        );
        const message = renderAnnouncementBatch(locale, slice, this.theme);

        const delivery = await this.deliver(
          batch.guildId,
          batch.channelId,
          batch.persona,
          locale,
          message,
        );
        if (delivery.ok) {
          report.sent += 1;
        } else if (delivery.rateLimited) {
          const retryAfterMs = delivery.retryAfterMs ?? 5_000;
          this.rateLimiter.applyBackoff(batch.guildId, this.clock.now() + retryAfterMs);
          this.requeueFront(batch, slice, this.clock.now() + retryAfterMs);
          report.deferred += 1;
        } else {
          report.failed += 1;
        }
      }
    } finally {
      this.flushing = false;
    }
    return report;
  }

  /** Force every buffered batch to be eligible immediately and attempt delivery (respecting rate limits). */
  async flushAll(): Promise<FlushReport> {
    const now = this.clock.now();
    for (const batch of this.batches.values()) {
      batch.flushAt = Math.min(batch.flushAt, now);
    }
    return this.flushDue();
  }

  private requeueFront(
    batch: PendingBatch,
    events: SubscribedDomainEvent[],
    flushAt: number,
  ): void {
    const existing = this.batches.get(batch.key);
    if (existing) {
      existing.events.unshift(...events);
      existing.flushAt = Math.max(existing.flushAt, flushAt);
    } else {
      this.batches.set(batch.key, {
        ...batch,
        events: [...events],
        flushAt,
      });
    }
  }

  private async deliver(
    guildId: string,
    channelId: string,
    persona: PersonaId | null,
    locale: 'en' | 'ja',
    message: ReturnType<typeof renderAnnouncementBatch>,
  ): Promise<{ ok: true } | { ok: false; rateLimited: boolean; retryAfterMs?: number }> {
    if (persona) {
      const res = await this.personas.send({ guildId, channelId, persona, locale, message });
      if (res.ok) return { ok: true };
      if (res.reason === 'rate_limited') {
        return {
          ok: false,
          rateLimited: true,
          ...(res.retryAfterMs === undefined ? {} : { retryAfterMs: res.retryAfterMs }),
        };
      }
      this.logger.warn(
        { guildId, channelId, persona, reason: res.reason },
        'announcement delivery failed after fallback',
      );
      return { ok: false, rateLimited: false };
    }

    try {
      const res = await this.port.postToChannel(channelId, message);
      if (res.ok) return { ok: true };
      if (res.reason === 'rate_limited') {
        return {
          ok: false,
          rateLimited: true,
          ...(res.retryAfterMs === undefined ? {} : { retryAfterMs: res.retryAfterMs }),
        };
      }
      this.logger.warn({ guildId, channelId, reason: res.reason }, 'channel announcement failed');
      return { ok: false, rateLimited: false };
    } catch (error) {
      this.logger.error({ err: error, guildId, channelId }, 'channel announcement threw');
      return { ok: false, rateLimited: false };
    }
  }
}
