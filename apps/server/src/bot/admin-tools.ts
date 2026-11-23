import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  type AutocompleteInteraction,
  type Client,
  type ButtonInteraction,
  type ChatInputCommandInteraction,
  type EmbedBuilder,
  type ModalSubmitInteraction,
} from 'discord.js';
import { formatPelica, t, type Locale } from '@casino/shared/i18n';
import {
  BLACKJACK_PROFILE,
  CASINO_GAMES,
  CHINCHIRO_PROFILE,
  MANUAL_BOOST_PCT,
  MANUAL_MINUTES,
  approxRtp,
  isCasinoGame,
  makeManualEvent,
  pachinko,
  slots,
  type CasinoGame,
  type RtpProfile,
} from '@casino/domain/casino';
import { parseBulk } from '@casino/domain/quiz';
import { MIN_FEE } from '@casino/domain/lottery';
import { fetchSendable } from './boards.ts';
import { AppError } from '../runtime/errors.ts';
import {
  EPHEMERAL,
  activityRow,
  cid,
  embed,
  formatNumber,
  idemKeyOf,
  isOwner,
  nowOf,
  reply,
  updateMessage,
  type ChatCtx,
  type ParsedCid,
} from './chat-kit.ts';
import { quizMessage } from './progress-chat.ts';

// ------------------------------------------------------------------ guards and targets

/** A refusal with its own localized message (shown as an ephemeral error embed). */
class AdminRefusal extends Error {
  readonly titleKey: Parameters<typeof t>[1];
  readonly bodyKey: Parameters<typeof t>[1];
  readonly params: Record<string, string | number>;

  constructor(
    titleKey: Parameters<typeof t>[1],
    bodyKey: Parameters<typeof t>[1],
    params: Record<string, string | number> = {},
  ) {
    super(String(bodyKey));
    this.titleKey = titleKey;
    this.bodyKey = bodyKey;
    this.params = params;
  }
}

const FEATURES = [
  'chinchiro',
  'pachinko',
  'slot',
  'blackjack',
  'roulette',
  'arena',
  'horse',
  'market',
  'bonds',
  'kyosai',
  'loan',
  'company',
  'labor',
  'quiz',
  'raffle',
  'poll',
  'p2p',
  'shop',
] as const;
type Feature = (typeof FEATURES)[number];

/** `guild_features_off` key of a feature: the casino games share the casino port's `casino:<game>` rows. */
export function featureKey(feature: Feature): string {
  switch (feature) {
    case 'chinchiro':
    case 'pachinko':
    case 'blackjack':
    case 'roulette':
      return `casino:${feature}`;
    case 'slot':
      return 'casino:slots';
    default:
      return feature;
  }
}

const MAX_GUILD_ID = (1n << 63n) - 1n;

function parseSnowflake(raw: string): string | null {
  const m = /^(?:<@!?(\d+)>|(\d+))$/.exec(raw.trim());
  const digits = m?.[1] ?? m?.[2];
  if (!digits) return null;
  const n = BigInt(digits);
  return n >= 1n && n <= MAX_GUILD_ID ? digits : null;
}

function requireStore(ctx: ChatCtx) {
  if (!ctx.deps.store) throw new AppError('internal');
  return ctx.deps.store;
}

function guildLabel(ctx: ChatCtx, guildId: string): string {
  return `**${ctx.deps.identity.getGuildName(guildId) ?? guildId}**（\`${guildId}\`）`;
}

/** The guilds an owner command without a `guild_id` means: every approved guild plus the configured ones. */
function allowedGuildIds(ctx: ChatCtx): string[] {
  const store = requireStore(ctx);
  const rows = store.stmt('SELECT guild_id, status FROM guilds ORDER BY guild_id').all() as {
    guild_id: string;
    status: string;
  }[];
  return rows
    .filter((r) => r.status === 'approved' || ctx.deps.allowedGuildIds.has(r.guild_id))
    .map((r) => r.guild_id);
}

function knownGuild(ctx: ChatCtx, raw: string | null, required: true): string;
function knownGuild(ctx: ChatCtx, raw: string | null, required: false): string | null;
function knownGuild(ctx: ChatCtx, raw: string | null, required: boolean): string | null {
  if (raw === null || raw.trim() === '') {
    if (required)
      throw new AdminRefusal('bot.admin.err.targetNoGuild', 'bot.admin.err.targetNoGuildBody');
    return null;
  }
  const id = parseSnowflake(raw);
  if (!id || ctx.deps.identity.getGuildStatus(id) === null) {
    throw new AdminRefusal('bot.admin.err.targetNoGuild', 'bot.admin.err.targetNoGuildBody');
  }
  return id;
}

function targetGuilds(ctx: ChatCtx, raw: string | null): string[] {
  const one = knownGuild(ctx, raw, false);
  return one === null ? allowedGuildIds(ctx) : [one];
}

function knownMember(ctx: ChatCtx, guildId: string, rawUser: string): string {
  const id = parseSnowflake(rawUser);
  if (!id || !ctx.deps.economy.hasAccount(guildId, id)) {
    throw new AdminRefusal('bot.admin.err.targetNoMember', 'bot.admin.err.targetNoMemberBody', {
      uid: id ?? rawUser,
      guild: guildLabel(ctx, guildId),
    });
  }
  return id;
}

/** `channel_id` needs `guild_id`; the channel must be one the bot can post to. */
async function postableChannel(
  ctx: ChatCtx,
  client: Client,
  guildId: string,
  rawChannel: string | null,
): Promise<string | null> {
  const fallback = ctx.deps.notifyConfig?.getGuildConfig(guildId).effectiveChannelId || null;
  const wanted = rawChannel && rawChannel.trim() !== '' ? parseSnowflake(rawChannel) : fallback;
  if (rawChannel && rawChannel.trim() !== '' && wanted === null) {
    throw new AdminRefusal('bot.admin.err.targetNoChannel', 'bot.admin.err.targetNoChannelBody');
  }
  if (wanted === null) return null;
  const channel = await fetchSendable(client, wanted, guildId);
  return channel ? wanted : null;
}

function needGuildForChannel(guildRaw: string | null, channelRaw: string | null): void {
  if (channelRaw && channelRaw.trim() !== '' && (guildRaw === null || guildRaw.trim() === '')) {
    throw new AdminRefusal('bot.admin.err.needGuildTitle', 'bot.admin.err.needGuild');
  }
}

async function post(
  ctx: ChatCtx,
  client: Client,
  guildId: string,
  channelRaw: string | null,
  payload: { embeds: EmbedBuilder[]; components?: ActionRowBuilder<ButtonBuilder>[] },
): Promise<boolean> {
  const channelId = await postableChannel(ctx, client, guildId, channelRaw);
  if (channelId === null) return false;
  const channel = await fetchSendable(client, channelId, guildId);
  if (!channel) return false;
  await channel.send({ ...payload, allowedMentions: { parse: [] } } as never);
  return true;
}

// ------------------------------------------------------------------ modal parameters

const FORM_TTL_MS = 900_000;
const FORM_MAX = 200;

/** Parameters of a slash command carried to its modal; a modal nobody submits must not leak them. */
class FormParams<V> {
  private readonly entries = new Map<string, { value: V; expiresAt: number }>();

  get size(): number {
    return this.entries.size;
  }

  set(key: string, value: V, now: number): void {
    for (const [k, e] of this.entries) if (e.expiresAt <= now) this.entries.delete(k);
    while (this.entries.size >= FORM_MAX) {
      const oldest = this.entries.keys().next().value;
      if (oldest === undefined) break;
      this.entries.delete(oldest);
    }
    this.entries.set(key, { value, expiresAt: now + FORM_TTL_MS });
  }

  /** The stored value, once: absent when unknown or past its TTL. */
  take(key: string, now: number): V | undefined {
    const entry = this.entries.get(key);
    this.entries.delete(key);
    return entry !== undefined && entry.expiresAt > now ? entry.value : undefined;
  }
}

/** Modal parameter sets currently held (for tests). */
export function pendingFormCount(): number {
  return modalParams.size + announceParams.size;
}

// ------------------------------------------------------------------ pending confirmations

interface Pending {
  userId: string;
  expiresAt: number;
  run(interaction: ButtonInteraction): Promise<void>;
}

const PENDING_TTL_MS = 300_000;
const pending = new Map<string, Pending>();

function remember(token: string, userId: string, run: Pending['run']): void {
  const now = Date.now();
  for (const [key, value] of pending) if (value.expiresAt <= now) pending.delete(key);
  pending.set(token, { userId, expiresAt: now + PENDING_TTL_MS, run });
}

/** An ephemeral prompt with a danger button; the action runs only when its owner presses it. */
async function confirm(
  ctx: ChatCtx,
  interaction: ChatInputCommandInteraction | ModalSubmitInteraction,
  options: {
    title: string;
    body: string;
    button: string;
    run: Pending['run'];
    extra?: EmbedBuilder[];
  },
): Promise<void> {
  const token = interaction.id;
  remember(token, interaction.user.id, options.run);
  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(cid('adm', 'ok', token))
      .setLabel(options.button)
      .setStyle(ButtonStyle.Danger),
    new ButtonBuilder()
      .setCustomId(cid('adm', 'no', token))
      .setLabel(t(ctx.locale, 'bot.admin.btnCancel'))
      .setStyle(ButtonStyle.Secondary),
  );
  await reply(interaction, {
    embeds: [embed('warning', options.title, options.body), ...(options.extra ?? [])],
    components: [row],
    flags: EPHEMERAL,
  });
}

async function adminButton(
  ctx: ChatCtx,
  interaction: ButtonInteraction,
  id: ParsedCid,
): Promise<void> {
  const { locale } = ctx;
  if (!isOwner(ctx.deps, interaction.user.id)) {
    throw new AppError('forbidden', { reason: 'owner_only' });
  }
  const token = id.args[0] ?? '';
  const action = pending.get(token);
  if (!action || action.expiresAt <= Date.now()) {
    pending.delete(token);
    await updateMessage(interaction, {
      embeds: [embed('neutral', t(locale, 'error.expired'))],
      components: [],
    });
    return;
  }
  if (action.userId !== interaction.user.id) {
    throw new AppError('forbidden', { reason: 'owner_only' });
  }
  pending.delete(token);
  if (id.action === 'no') {
    await updateMessage(interaction, {
      embeds: [embed('neutral', t(locale, 'bot.admin.cancelled'))],
      components: [],
    });
    return;
  }
  await action.run(interaction);
}

async function done(
  interaction: ChatInputCommandInteraction | ButtonInteraction | ModalSubmitInteraction,
  e: EmbedBuilder,
): Promise<void> {
  if ('isButton' in interaction && interaction.isButton()) {
    await updateMessage(interaction, { embeds: [e], components: [] });
    return;
  }
  await reply(interaction, { embeds: [e], flags: EPHEMERAL });
}

// ------------------------------------------------------------------ economy

async function grant(ctx: ChatCtx, interaction: ChatInputCommandInteraction): Promise<void> {
  const { locale } = ctx;
  const guildId = knownGuild(ctx, interaction.options.getString('guild_id', true), true);
  const userId = knownMember(ctx, guildId, interaction.options.getString('user_id', true));
  const amount = interaction.options.getInteger('amount', true);
  const reason = interaction.options.getString('reason')?.trim() ?? '';
  const res = ctx.deps.economy.credit({
    guildId,
    userId,
    amount,
    reason: 'admin_grant',
    refType: 'admin',
    refId: interaction.user.id,
    idempotencyKey: idemKeyOf(interaction),
    meta: { note: `付与（管理）${reason}`.trim(), by: interaction.user.id },
  });
  await reply(interaction, {
    embeds: [
      embed(
        'success',
        t(locale, 'bot.admin.grant.title'),
        t(locale, 'bot.admin.grant.body', {
          guild: guildLabel(ctx, guildId),
          mention: `<@${userId}>`,
          amount: formatPelica(locale, amount),
          balance: formatPelica(locale, res.entry.balanceAfter),
        }),
      ),
    ],
    flags: EPHEMERAL,
  });
}

function setBalance(
  ctx: ChatCtx,
  args: {
    guildId: string;
    userId: string;
    amount: number;
    reason: string;
    key: string;
    by: string;
  },
): { before: number; after: number; debt: number | null } {
  const run = <T>(fn: () => T): T => (ctx.deps.store ? ctx.deps.store.transaction(fn) : fn());
  return run(() => setBalanceInTransaction(ctx, args));
}

function setBalanceInTransaction(
  ctx: ChatCtx,
  args: {
    guildId: string;
    userId: string;
    amount: number;
    reason: string;
    key: string;
    by: string;
  },
): { before: number; after: number; debt: number | null } {
  const { economy } = ctx.deps;
  const before = economy.getBalance(args.guildId, args.userId);
  const note = `残高の設定（管理）${args.reason}`.trim();
  const target = Math.max(0, args.amount);
  const delta = target - before;
  const common = {
    guildId: args.guildId,
    userId: args.userId,
    refType: 'admin_set_balance',
    refId: args.by,
    meta: { note, by: args.by },
  };
  if (delta > 0) {
    economy.credit({
      ...common,
      amount: delta,
      reason: 'admin_grant',
      idempotencyKey: `${args.key}:bal`,
    });
  } else if (delta < 0) {
    economy.debit({
      ...common,
      amount: -delta,
      reason: 'admin_revoke',
      idempotencyKey: `${args.key}:bal`,
    });
  }
  let debt: number | null = null;
  if (args.amount < 0) {
    ctx.deps.finance?.teiai.adminSetDebt(args.guildId, args.userId, -args.amount);
    debt = -args.amount;
  }
  return { before, after: economy.getBalance(args.guildId, args.userId), debt };
}

async function setBalanceCommand(
  ctx: ChatCtx,
  interaction: ChatInputCommandInteraction,
): Promise<void> {
  const { locale } = ctx;
  const guildId = knownGuild(ctx, interaction.options.getString('guild_id', true), true);
  const userId = knownMember(ctx, guildId, interaction.options.getString('user_id', true));
  const amount = interaction.options.getInteger('amount', true);
  const reason = interaction.options.getString('reason')?.trim() ?? '';
  const key = idemKeyOf(interaction);
  await confirm(ctx, interaction, {
    title: t(locale, 'bot.admin.setBalance.confirmTitle'),
    body: t(locale, 'bot.admin.setBalance.confirmBody', {
      guild: guildLabel(ctx, guildId),
      mention: `<@${userId}>`,
      before: formatPelica(locale, ctx.deps.economy.getBalance(guildId, userId)),
      amount:
        amount < 0
          ? t(locale, 'bot.admin.setBalance.debtTarget', { debt: formatNumber(locale, -amount) })
          : formatPelica(locale, amount),
    }),
    button: t(locale, 'bot.admin.setBalance.btn'),
    run: async (button) => {
      const res = setBalance(ctx, {
        guildId,
        userId,
        amount,
        reason,
        key,
        by: interaction.user.id,
      });
      await done(
        button,
        embed(
          'success',
          t(locale, 'bot.admin.setBalance.title'),
          t(locale, 'bot.admin.setBalance.body', {
            guild: guildLabel(ctx, guildId),
            mention: `<@${userId}>`,
            before: formatNumber(locale, res.before),
            after: formatNumber(locale, res.after),
          }) +
            (res.debt === null
              ? ''
              : `\n${t(locale, 'bot.admin.setBalance.debtNote', { debt: formatNumber(locale, res.debt) })}`),
        ),
      );
    },
  });
}

// ------------------------------------------------------------------ events, RTP, features

function gameLabel(locale: Locale, game: CasinoGame): string {
  return t(locale, `bot.admin.game.${game}`);
}

async function eventStart(ctx: ChatCtx, interaction: ChatInputCommandInteraction): Promise<void> {
  const { locale } = ctx;
  const store = requireStore(ctx);
  const gameRaw = interaction.options.getString('game', true);
  const guildRaw = interaction.options.getString('guild_id');
  const channelRaw = interaction.options.getString('channel_id');
  needGuildForChannel(guildRaw, channelRaw);
  if (!isCasinoGame(gameRaw)) throw new AppError('invalid_payload');
  const nowMs = nowOf(ctx.deps);
  const event = makeManualEvent({
    game: gameRaw,
    boostPct: interaction.options.getInteger('boost') ?? MANUAL_BOOST_PCT.default,
    minutes: interaction.options.getInteger('minutes') ?? MANUAL_MINUTES.default,
    nowMs,
  });
  if (event === null) throw new AppError('invalid_payload');
  const guilds = targetGuilds(ctx, guildRaw);
  let announced = 0;
  for (const guildId of guilds) {
    store
      .stmt(
        `INSERT INTO casino_events (guild_id, game, boost_pct, starts_at, ends_at, channel_id) VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT (guild_id) DO UPDATE SET game = excluded.game, boost_pct = excluded.boost_pct,
           starts_at = excluded.starts_at, ends_at = excluded.ends_at, channel_id = excluded.channel_id`,
      )
      .run(guildId, event.game, event.boostPct, event.startsAt, event.endsAt, channelRaw ?? null);
    const ok = await post(ctx, interaction.client, guildId, channelRaw, {
      embeds: [
        embed(
          'gold',
          t(locale, 'bot.admin.event.announceTitle', { game: gameLabel(locale, event.game) }),
          t(locale, 'bot.admin.event.announceBody', {
            boost: event.boostPct,
            ends: `<t:${Math.floor(event.endsAt / 1000)}:R>`,
          }),
        ),
      ],
      components: [activityRow(locale, event.game === 'slots' ? 'slots' : event.game)],
    }).catch(() => false);
    if (ok) announced += 1;
  }
  await reply(interaction, {
    embeds: [
      embed(
        'success',
        t(locale, 'bot.admin.event.started'),
        t(locale, 'bot.admin.event.startedBody', {
          game: gameLabel(locale, event.game),
          boost: event.boostPct,
          minutes: Math.round((event.endsAt - event.startsAt) / 60_000),
          guilds: guilds.length,
          announced,
        }),
      ),
    ],
    flags: EPHEMERAL,
  });
}

async function eventStop(ctx: ChatCtx, interaction: ChatInputCommandInteraction): Promise<void> {
  const { locale } = ctx;
  const store = requireStore(ctx);
  const guilds = targetGuilds(ctx, interaction.options.getString('guild_id'));
  let stopped = 0;
  for (const guildId of guilds) {
    stopped += store.stmt('DELETE FROM casino_events WHERE guild_id = ?').run(guildId).changes;
  }
  await reply(interaction, {
    embeds: [
      embed(
        stopped > 0 ? 'success' : 'neutral',
        t(locale, stopped > 0 ? 'bot.admin.event.stopped' : 'bot.admin.event.noneRunning'),
        stopped > 0 ? t(locale, 'bot.admin.event.stoppedBody', { n: stopped }) : undefined,
      ),
    ],
    flags: EPHEMERAL,
  });
}

const PROFILES: Partial<Record<CasinoGame, RtpProfile>> = {
  chinchiro: CHINCHIRO_PROFILE,
  blackjack: BLACKJACK_PROFILE,
  pachinko: pachinko.PACHINKO_PROFILE,
  slots: slots.SLOTS_PROFILE,
};

function rtpTable(ctx: ChatCtx, guildId: string): string {
  const casino = ctx.deps.casino;
  const { locale } = ctx;
  return CASINO_GAMES.map((game) => {
    const level = casino ? casino.core.rtpLevel(guildId, game) : 3;
    const profile = PROFILES[game];
    const approx = profile ? ` ≈ ${(approxRtp(profile, level) * 100).toFixed(1)}%` : '';
    return `${gameLabel(locale, game)}: **${level}** ${t(locale, `bot.admin.rtp.level.${level as 1}`)}${approx}`;
  }).join('\n');
}

async function rtpSet(ctx: ChatCtx, interaction: ChatInputCommandInteraction): Promise<void> {
  const { locale } = ctx;
  if (!ctx.deps.casino) throw new AppError('internal');
  const guildId = knownGuild(ctx, interaction.options.getString('guild_id', true), true);
  const gameRaw = interaction.options.getString('game', true);
  const level = interaction.options.getInteger('level', true);
  const games: readonly CasinoGame[] =
    gameRaw === '*' ? CASINO_GAMES : isCasinoGame(gameRaw) ? [gameRaw] : [];
  if (games.length === 0) throw new AppError('invalid_payload');
  for (const game of games) ctx.deps.casino.core.setRtpLevel(guildId, game, level);
  await reply(interaction, {
    embeds: [
      embed(
        'success',
        t(locale, 'bot.admin.rtp.changed'),
        `${t(locale, 'bot.admin.rtp.changedBody', {
          guild: guildLabel(ctx, guildId),
          games: games.map((g) => gameLabel(locale, g)).join(', '),
          level,
          name: t(locale, `bot.admin.rtp.level.${level as 1}`),
        })}\n\n${rtpTable(ctx, guildId)}`,
      ).setFooter({ text: t(locale, 'bot.admin.rtp.footer') }),
    ],
    flags: EPHEMERAL,
  });
}

async function rtpList(ctx: ChatCtx, interaction: ChatInputCommandInteraction): Promise<void> {
  const { locale } = ctx;
  const guilds = targetGuilds(ctx, interaction.options.getString('guild_id')).slice(0, 10);
  const embeds = guilds.map((guildId) =>
    embed(
      'info',
      t(locale, 'bot.admin.rtp.listTitle', {
        guild: ctx.deps.identity.getGuildName(guildId) ?? guildId,
      }),
      rtpTable(ctx, guildId),
    ),
  );
  await reply(interaction, {
    embeds: embeds.length > 0 ? embeds : [embed('neutral', t(locale, 'bot.admin.noGuilds'))],
    flags: EPHEMERAL,
  });
}

function featureNames(locale: Locale, features: readonly Feature[]): string {
  return features.map((f) => t(locale, `bot.admin.feature.${f}`)).join(', ');
}

function featureTable(ctx: ChatCtx, guildId: string): string {
  const store = requireStore(ctx);
  const off = new Set(
    (
      store.stmt('SELECT feature FROM guild_features_off WHERE guild_id = ?').all(guildId) as {
        feature: string;
      }[]
    ).map((r) => r.feature),
  );
  return FEATURES.map(
    (f) =>
      `${off.has(featureKey(f)) ? '⏸️' : '▶️'} ${t(ctx.locale, `bot.admin.feature.${f}`)}\u3000${t(
        ctx.locale,
        off.has(featureKey(f)) ? 'bot.admin.feature.paused' : 'bot.admin.feature.running',
      )}`,
  ).join('\n');
}

async function featureToggle(
  ctx: ChatCtx,
  interaction: ChatInputCommandInteraction,
  turnOn: boolean,
): Promise<void> {
  const { locale } = ctx;
  const store = requireStore(ctx);
  const guildId = knownGuild(ctx, interaction.options.getString('guild_id', true), true);
  const raw = interaction.options.getString('feature', true);
  const chosen: readonly Feature[] =
    raw === '*' ? FEATURES : (FEATURES as readonly string[]).includes(raw) ? [raw as Feature] : [];
  if (chosen.length === 0) throw new AppError('invalid_payload');
  for (const feature of chosen) {
    if (turnOn) {
      store
        .stmt('DELETE FROM guild_features_off WHERE guild_id = ? AND feature = ?')
        .run(guildId, featureKey(feature));
    } else {
      store
        .stmt('INSERT OR IGNORE INTO guild_features_off (guild_id, feature) VALUES (?, ?)')
        .run(guildId, featureKey(feature));
    }
  }
  const names = featureNames(locale, chosen);
  const guild = guildLabel(ctx, guildId);
  await reply(interaction, {
    embeds: [
      embed(
        turnOn ? 'success' : 'warning',
        t(locale, turnOn ? 'bot.admin.feature.onTitle' : 'bot.admin.feature.offTitle'),
        `${t(locale, turnOn ? 'bot.admin.feature.onBody' : 'bot.admin.feature.offBody', { guild, names })}\n\n${featureTable(ctx, guildId)}`,
      ),
    ],
    flags: EPHEMERAL,
  });
}

async function featureList(ctx: ChatCtx, interaction: ChatInputCommandInteraction): Promise<void> {
  const { locale } = ctx;
  const guilds = targetGuilds(ctx, interaction.options.getString('guild_id')).slice(0, 10);
  const embeds = guilds.map((guildId) =>
    embed('info', ctx.deps.identity.getGuildName(guildId) ?? guildId, featureTable(ctx, guildId)),
  );
  await reply(interaction, {
    embeds: embeds.length > 0 ? embeds : [embed('neutral', t(locale, 'bot.admin.noGuilds'))],
    flags: EPHEMERAL,
  });
}

// ------------------------------------------------------------------ diagnostics

async function pachinkoStats(
  ctx: ChatCtx,
  interaction: ChatInputCommandInteraction,
): Promise<void> {
  const { locale } = ctx;
  const store = requireStore(ctx);
  const guilds = targetGuilds(ctx, interaction.options.getString('guild_id'));
  const days = interaction.options.getInteger('days');
  const since = days === null ? 0 : nowOf(ctx.deps) - days * 86_400_000;
  const marks = guilds.map(() => '?').join(', ');
  if (guilds.length === 0) {
    await reply(interaction, {
      embeds: [embed('neutral', t(locale, 'bot.admin.noGuilds'))],
      flags: EPHEMERAL,
    });
    return;
  }
  const sets = store
    .stmt(
      `SELECT COUNT(*) AS n, COALESCE(SUM(starts), 0) AS starts, COALESCE(SUM(raw), 0) AS raw,
              COALESCE(SUM(CASE WHEN raw > 0 THEN 1 ELSE 0 END), 0) AS hitSets
         FROM pachinko_sets WHERE guild_id IN (${marks}) AND created_at >= ?`,
    )
    .get(...guilds, since) as { n: number; starts: number; raw: number; hitSets: number };
  const spinRows = (key: 'omen' | 'tier') =>
    store
      .stmt(
        `SELECT p.${key} AS k, COUNT(*) AS n, COALESCE(SUM(p.hit), 0) AS hits
           FROM pachinko_spins p JOIN pachinko_sets s ON s.round_id = p.round_id AND s.set_index = p.set_index
          WHERE s.guild_id IN (${marks}) AND s.created_at >= ? GROUP BY p.${key} ORDER BY p.${key}`,
      )
      .all(...guilds, since) as { k: string; n: number; hits: number }[];
  const pct = (a: number, b: number): string => (b > 0 ? `${((a / b) * 100).toFixed(2)}%` : '–');
  const spins = spinRows('omen').reduce((a, r) => ({ n: a.n + r.n, hits: a.hits + r.hits }), {
    n: 0,
    hits: 0,
  });
  const small = (n: number): string => (n < 100 ? t(locale, 'bot.admin.pachinko.reference') : '');
  const breakdown = (
    rows: { k: string; n: number; hits: number }[],
    kind: 'omen' | 'tier',
  ): string =>
    rows
      .map(
        (r) =>
          `${t(locale, `bot.admin.pachinko.${kind}.${r.k === '' ? 'none' : r.k}` as 'bot.admin.pachinko.omen.none')}: ${formatNumber(locale, r.n)} / ${pct(r.hits, r.n)}${small(r.n)}`,
      )
      .join('\n') || '–';
  const e = embed(
    'info',
    t(locale, 'bot.admin.pachinko.title', {
      scope:
        guilds.length === 1
          ? (ctx.deps.identity.getGuildName(guilds[0] as string) ?? (guilds[0] as string))
          : t(locale, 'bot.admin.pachinko.allGuilds'),
      days:
        days === null
          ? t(locale, 'bot.admin.pachinko.allTime')
          : t(locale, 'bot.admin.pachinko.lastDays', { days }),
    }),
  ).addFields(
    {
      name: t(locale, 'bot.admin.pachinko.startRate'),
      value: `${pct(sets.starts, sets.n * pachinko.BALLS_PER_SET)} / ${(pachinko.P_START * 100).toFixed(2)}%${small(sets.n)}`,
      inline: true,
    },
    {
      name: t(locale, 'bot.admin.pachinko.setHit'),
      value: `${pct(sets.hitSets, sets.n)} / ${(pachinko.hitRate() * 100).toFixed(2)}%${small(sets.n)}`,
      inline: true,
    },
    {
      name: t(locale, 'bot.admin.pachinko.rtp'),
      value: `${sets.n > 0 ? ((sets.raw / sets.n) * 100).toFixed(1) : '–'}% / ${(pachinko.rtp() * 100).toFixed(1)}%${small(sets.n)}`,
      inline: true,
    },
    {
      name: t(locale, 'bot.admin.pachinko.spinHit'),
      value: `${pct(spins.hits, spins.n)} / ${(pachinko.HIT_TARGET * 100).toFixed(2)}%${small(spins.n)}`,
      inline: true,
    },
    { name: t(locale, 'bot.admin.pachinko.omens'), value: breakdown(spinRows('omen'), 'omen') },
    { name: t(locale, 'bot.admin.pachinko.tiers'), value: breakdown(spinRows('tier'), 'tier') },
  );
  await reply(interaction, { embeds: [e], flags: EPHEMERAL });
}

async function clickHistory(ctx: ChatCtx, interaction: ChatInputCommandInteraction): Promise<void> {
  const { locale } = ctx;
  if (!ctx.deps.games) throw new AppError('internal');
  const guildId = knownGuild(ctx, interaction.options.getString('guild_id', true), true);
  const userId = knownMember(ctx, guildId, interaction.options.getString('user_id', true));
  const hours = interaction.options.getInteger('hours') ?? 24;
  const rows = ctx.deps.games.work.clickHistory(guildId, userId, hours);
  const lines = rows.slice(0, 24).map((r) => {
    const when = `<t:${r.hour * 3600}:f>`;
    const cv = r.cv === null ? '–' : r.cv.toFixed(2);
    return `${when}\u3000${t(locale, 'bot.admin.clicks.line', {
      clicks: r.clicks,
      pay: formatNumber(locale, r.pay),
      cv,
    })}${r.mechanical ? ' ⚠️' : ''}`;
  });
  await reply(interaction, {
    embeds: [
      embed(
        'info',
        t(locale, 'bot.admin.clicks.title', { hours }),
        lines.length === 0 ? t(locale, 'bot.admin.clicks.none') : lines.join('\n'),
      ).setFooter({ text: t(locale, 'bot.admin.clicks.footer') }),
    ],
    flags: EPHEMERAL,
  });
}

// ------------------------------------------------------------------ hosting

async function hostRace(ctx: ChatCtx, interaction: ChatInputCommandInteraction): Promise<void> {
  const { locale } = ctx;
  if (!ctx.deps.games) throw new AppError('internal');
  const guildRaw = interaction.options.getString('guild_id', true);
  const channelRaw = interaction.options.getString('channel_id');
  const guildId = knownGuild(ctx, guildRaw, true);
  const entryMin = interaction.options.getInteger('entry_min') ?? 5;
  const betMin = interaction.options.getInteger('bet_min') ?? 5;
  const raceId = ctx.deps.games.race.hostSpecial(guildId, entryMin, betMin);
  const card = ctx.deps.games.race.card(raceId);
  const ok = await post(ctx, interaction.client, guildId, channelRaw, {
    embeds: [
      embed(
        'race',
        t(locale, 'bot.admin.race.announceTitle', { id: raceId }),
        t(locale, 'bot.admin.race.announceBody', {
          entry: `<t:${Math.floor(card.race.entry_close / 1000)}:R>`,
          bet: `<t:${Math.floor(card.race.bet_close / 1000)}:R>`,
          start: `<t:${Math.floor(card.race.start_at / 1000)}:R>`,
        }),
      ),
    ],
    components: [activityRow(locale, 'horse')],
  }).catch(() => false);
  await reply(interaction, {
    embeds: [
      embed(
        'success',
        t(locale, 'bot.admin.race.opened', { id: raceId }),
        t(locale, ok ? 'bot.admin.posted' : 'bot.admin.notPosted'),
      ),
    ],
    flags: EPHEMERAL,
  });
}

async function hostArena(ctx: ChatCtx, interaction: ChatInputCommandInteraction): Promise<void> {
  const { locale } = ctx;
  if (!ctx.deps.games) throw new AppError('internal');
  const guildId = knownGuild(ctx, interaction.options.getString('guild_id', true), true);
  const channelRaw = interaction.options.getString('channel_id');
  const fmtRaw = interaction.options.getString('fmt');
  const fmt = fmtRaw === 'duel' || fmtRaw === 'royale' ? fmtRaw : undefined;
  const created = ctx.deps.games.arena.ensureToday(guildId);
  const advanced =
    interaction.options.getBoolean('advance') === true
      ? ctx.deps.games.arena.advanceNow(guildId, fmt)
      : [];
  const ok = await post(ctx, interaction.client, guildId, channelRaw, {
    embeds: [
      embed(
        'primary',
        t(
          locale,
          advanced.length > 0 ? 'bot.admin.arena.advancedTitle' : 'bot.admin.arena.openTitle',
        ),
        t(locale, 'bot.admin.arena.body'),
      ),
    ],
    components: [activityRow(locale, 'arena')],
  }).catch(() => false);
  await reply(interaction, {
    embeds: [
      embed(
        'success',
        t(locale, 'bot.admin.arena.done', { created: created.length, advanced: advanced.length }),
        t(locale, ok ? 'bot.admin.posted' : 'bot.admin.notPosted'),
      ),
    ],
    flags: EPHEMERAL,
  });
}

// ------------------------------------------------------------------ raffle

function raffleMessage(
  ctx: ChatCtx,
  raffle: { id: number; fee: number; closes_at: number; entrants: string[] },
) {
  const { locale } = ctx;
  const e = embed(
    'gold',
    t(locale, 'bot.admin.raffle.title', { id: raffle.id }),
    t(locale, 'bot.admin.raffle.body', {
      fee: formatPelica(locale, raffle.fee),
      closes: `<t:${Math.floor(raffle.closes_at / 1000)}:R>`,
      n: raffle.entrants.length,
    }),
  );
  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(cid('raf', 'join', raffle.id))
      .setLabel(t(locale, 'bot.admin.raffle.btnJoin'))
      .setStyle(ButtonStyle.Success),
  );
  return { embeds: [e], components: [row] };
}

async function raffleStart(ctx: ChatCtx, interaction: ChatInputCommandInteraction): Promise<void> {
  const { locale } = ctx;
  if (!ctx.deps.games) throw new AppError('internal');
  const guildId = knownGuild(ctx, interaction.options.getString('guild_id', true), true);
  const fee = interaction.options.getInteger('fee') ?? undefined;
  if (fee !== undefined && fee < MIN_FEE) throw new AppError('invalid_payload');
  const raffle = ctx.deps.games.lottery.host({
    guildId,
    hostId: interaction.user.id,
    ...(fee === undefined ? {} : { fee }),
    ...(interaction.options.getInteger('minutes') === null
      ? {}
      : { minutes: interaction.options.getInteger('minutes') as number }),
  });
  const ok = await post(
    ctx,
    interaction.client,
    guildId,
    interaction.options.getString('channel_id'),
    raffleMessage(ctx, raffle),
  ).catch(() => false);
  await reply(interaction, {
    embeds: [
      embed(
        'success',
        t(locale, 'bot.admin.raffle.started', { id: raffle.id }),
        t(locale, ok ? 'bot.admin.posted' : 'bot.admin.notPosted'),
      ),
    ],
    flags: EPHEMERAL,
  });
}

async function raffleRepost(ctx: ChatCtx, interaction: ChatInputCommandInteraction): Promise<void> {
  const { locale } = ctx;
  if (!ctx.deps.games) throw new AppError('internal');
  const guildId = knownGuild(ctx, interaction.options.getString('guild_id', true), true);
  const raffle = ctx.deps.games.lottery.current(guildId);
  if (!raffle) {
    await reply(interaction, {
      embeds: [embed('warning', t(locale, 'bot.admin.raffle.none'))],
      flags: EPHEMERAL,
    });
    return;
  }
  const ok = await post(
    ctx,
    interaction.client,
    guildId,
    interaction.options.getString('channel_id'),
    raffleMessage(ctx, raffle),
  ).catch(() => false);
  await reply(interaction, {
    embeds: [
      embed(ok ? 'success' : 'warning', t(locale, ok ? 'bot.admin.posted' : 'bot.admin.notPosted')),
    ],
    flags: EPHEMERAL,
  });
}

async function raffleCancel(ctx: ChatCtx, interaction: ChatInputCommandInteraction): Promise<void> {
  const { locale } = ctx;
  if (!ctx.deps.games) throw new AppError('internal');
  const guildId = knownGuild(ctx, interaction.options.getString('guild_id', true), true);
  const raffle = ctx.deps.games.lottery.current(guildId);
  if (!raffle) {
    await reply(interaction, {
      embeds: [embed('warning', t(locale, 'bot.admin.raffle.none'))],
      flags: EPHEMERAL,
    });
    return;
  }
  await confirm(ctx, interaction, {
    title: t(locale, 'bot.admin.raffle.cancelTitle'),
    body: t(locale, 'bot.admin.raffle.cancelBody', {
      id: raffle.id,
      n: raffle.entrants.length,
      guild: guildLabel(ctx, guildId),
    }),
    button: t(locale, 'bot.admin.raffle.cancelBtn'),
    run: async (button) => {
      const cancelled = ctx.deps.games?.lottery.cancel(guildId);
      await done(
        button,
        embed(
          'success',
          t(locale, 'bot.admin.raffle.cancelled', { id: cancelled?.id ?? raffle.id }),
        ),
      );
    },
  });
}

export async function raffleJoin(
  ctx: ChatCtx,
  interaction: ButtonInteraction,
  raffleId: number,
): Promise<void> {
  const { locale } = ctx;
  if (!ctx.deps.games || !interaction.guildId) throw new AppError('internal');
  ctx.deps.economy.ensureMember(interaction.guildId, interaction.user.id);
  ctx.deps.games.lottery.join(interaction.guildId, interaction.user.id, raffleId);
  await reply(interaction, {
    embeds: [embed('success', t(locale, 'bot.admin.raffle.joined', { id: raffleId }))],
    flags: EPHEMERAL,
  });
}

// ------------------------------------------------------------------ quizzes

const ATTACHMENT_HOSTS: ReadonlySet<string> = new Set([
  'cdn.discordapp.com',
  'media.discordapp.net',
]);
const FETCH_TIMEOUT_MS = 10_000;

/**
 * Download an attached text file: https on Discord's attachment CDN only, no redirects, a
 * timeout, and the body read as a stream that stops once it passes `maxBytes`.
 */
export async function fetchAttachmentText(
  rawUrl: string,
  maxBytes: number,
  fetchImpl: typeof fetch = fetch,
): Promise<string> {
  const tooBig = () =>
    new AdminRefusal('bot.admin.err.bulkBadFile', 'bot.admin.err.bulkBadFileBody');
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw tooBig();
  }
  if (
    url.protocol !== 'https:' ||
    url.username !== '' ||
    url.password !== '' ||
    url.port !== '' ||
    !ATTACHMENT_HOSTS.has(url.hostname)
  ) {
    throw tooBig();
  }
  const res = await fetchImpl(url, {
    redirect: 'error',
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!res.ok) throw new AppError('not_found');
  const declared = Number(res.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > maxBytes) {
    await res.body?.cancel().catch(() => undefined);
    throw tooBig();
  }
  const reader = res.body?.getReader();
  if (!reader) throw tooBig();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => undefined);
      throw tooBig();
    }
    chunks.push(value);
  }
  const buf = new Uint8Array(total);
  let at = 0;
  for (const c of chunks) {
    buf.set(c, at);
    at += c.byteLength;
  }
  return new TextDecoder('utf-8', { fatal: true }).decode(buf);
}

const hooks = {
  /** Download an attached text file; replaced in tests. */
  fetchText: (url: string, maxBytes: number): Promise<string> => fetchAttachmentText(url, maxBytes),
};
export function setAdminFetch(fn: typeof hooks.fetchText): void {
  hooks.fetchText = fn;
}

const BULK_MAX_BYTES = 200 * 1024;

const modalParams = new FormParams<{
  announce: boolean;
  guild: string | null;
  channel: string | null;
}>();

async function announceQuiz(
  ctx: ChatCtx,
  client: Client,
  quiz: Parameters<typeof quizMessage>[1],
  guild: string | null,
  channel: string | null,
): Promise<number> {
  let posted = 0;
  for (const guildId of targetGuilds(ctx, guild)) {
    const ok = await post(
      ctx,
      client,
      guildId,
      guild === null ? null : channel,
      quizMessage(ctx, quiz, 'pub'),
    ).catch(() => false);
    if (ok) posted += 1;
  }
  return posted;
}

async function quizAddModal(ctx: ChatCtx, interaction: ChatInputCommandInteraction): Promise<void> {
  const { locale } = ctx;
  const guild = interaction.options.getString('guild_id');
  const channel = interaction.options.getString('channel_id');
  needGuildForChannel(guild, channel);
  knownGuild(ctx, guild, false);
  modalParams.set(
    interaction.id,
    { announce: (interaction.options.getInteger('announce') ?? 1) === 1, guild, channel },
    nowOf(ctx.deps),
  );
  const field = (
    id: string,
    label: string,
    style: TextInputStyle,
    required: boolean,
    max: number,
  ) =>
    new ActionRowBuilder<TextInputBuilder>().addComponents(
      new TextInputBuilder()
        .setCustomId(id)
        .setLabel(label.slice(0, 45))
        .setStyle(style)
        .setRequired(required)
        .setMaxLength(max),
    );
  await interaction.showModal(
    new ModalBuilder()
      .setCustomId(cid('admq', 'add', interaction.id))
      .setTitle(t(locale, 'bot.admin.quiz.modalTitle'))
      .addComponents(
        field(
          'question',
          t(locale, 'bot.quiz.modal.question'),
          TextInputStyle.Paragraph,
          true,
          500,
        ),
        field('choices', t(locale, 'bot.quiz.modal.choices'), TextInputStyle.Paragraph, true, 340),
        field(
          'explanation',
          t(locale, 'bot.quiz.modal.explanation'),
          TextInputStyle.Paragraph,
          false,
          800,
        ),
        field('reward', t(locale, 'bot.quiz.modal.reward'), TextInputStyle.Short, false, 9),
        field('duration', t(locale, 'bot.quiz.modal.duration'), TextInputStyle.Short, false, 12),
      ),
  );
}

export async function adminModalSubmit(
  ctx: ChatCtx,
  interaction: ModalSubmitInteraction,
  id: ParsedCid,
  parseDuration: (raw: string) => number | null,
): Promise<boolean> {
  const { locale } = ctx;
  if (!isOwner(ctx.deps, interaction.user.id))
    throw new AppError('forbidden', { reason: 'owner_only' });
  const field = (name: string): string => {
    try {
      return interaction.fields.getTextInputValue(name);
    } catch {
      return '';
    }
  };
  if (id.namespace === 'admq' && id.action === 'add') {
    if (!ctx.deps.games) throw new AppError('internal');
    const params = modalParams.take(id.args[0] ?? '', nowOf(ctx.deps)) ?? {
      announce: false,
      guild: null,
      channel: null,
    };
    const rawReward = field('reward').normalize('NFKC').replace(/,/g, '').trim();
    const rawDuration = field('duration').trim();
    const minutes = rawDuration === '' ? null : parseDuration(rawDuration);
    if (rawDuration !== '' && minutes === null) throw new AppError('invalid_payload');
    const quiz = ctx.deps.games.quiz.addOfficial({
      question: field('question'),
      choices: field('choices')
        .split(/\r?\n/)
        .map((c) => c.trim())
        .filter((c) => c !== ''),
      explanation: field('explanation'),
      ...(rawReward === '' ? {} : { reward: Number(rawReward) }),
      minutes,
    });
    const posted = params.announce
      ? await announceQuiz(ctx, interaction.client, quiz, params.guild, params.channel)
      : 0;
    await reply(interaction, {
      embeds: [
        embed(
          'success',
          t(locale, 'bot.admin.quiz.added', { id: quiz.id }),
          t(locale, 'bot.admin.quiz.addedBody', { posted }),
        ),
      ],
      flags: EPHEMERAL,
    });
    return true;
  }
  if (id.namespace === 'admn' && id.action === 'announce') {
    const params = announceParams.take(id.args[0] ?? '', nowOf(ctx.deps));
    if (!params) throw new AppError('expired');
    const body = field('body').trim();
    if (body === '') throw new AppError('invalid_payload');
    const preview = embed('primary', params.title, body);
    if (params.image) preview.setImage(params.image);
    await confirm(ctx, interaction, {
      title: t(locale, 'bot.admin.announce.confirmTitle'),
      body: t(locale, 'bot.admin.announce.confirmBody', {
        n: params.guilds.length,
        names: params.guilds
          .map((g) => ctx.deps.identity.getGuildName(g) ?? g)
          .join(', ')
          .slice(0, 900),
      }),
      button: t(locale, 'bot.admin.announce.btnSend'),
      extra: [preview],
      run: async (button) => {
        let sent = 0;
        for (const guildId of params.guilds) {
          const ok = await post(
            ctx,
            button.client,
            guildId,
            params.guilds.length === 1 ? params.channel : null,
            { embeds: [preview] },
          ).catch(() => false);
          if (ok) sent += 1;
        }
        await done(
          button,
          embed(
            'success',
            t(locale, 'bot.admin.announce.sent'),
            t(locale, 'bot.admin.announce.sentBody', { sent, total: params.guilds.length }),
          ),
        );
      },
    });
    return true;
  }
  return false;
}

async function quizBulk(ctx: ChatCtx, interaction: ChatInputCommandInteraction): Promise<void> {
  const { locale } = ctx;
  if (!ctx.deps.games) throw new AppError('internal');
  const guild = interaction.options.getString('guild_id');
  const channel = interaction.options.getString('channel_id');
  needGuildForChannel(guild, channel);
  knownGuild(ctx, guild, false);
  const file = interaction.options.getAttachment('file', true);
  const name = file.name?.toLowerCase() ?? '';
  const textual = /\.(txt|md|text)$/.test(name) || (file.contentType ?? '').startsWith('text/');
  if (!textual || (file.size ?? 0) > BULK_MAX_BYTES) {
    throw new AdminRefusal('bot.admin.err.bulkBadFile', 'bot.admin.err.bulkBadFileBody');
  }
  let text: string;
  try {
    text = (await hooks.fetchText(file.url, BULK_MAX_BYTES)).replace(/^\uFEFF/, '');
  } catch (error) {
    if (error instanceof AdminRefusal || error instanceof AppError) throw error;
    throw new AdminRefusal('bot.admin.err.bulkBadEncoding', 'bot.admin.err.bulkBadEncodingBody');
  }
  const parsed = parseBulk(text);
  if (parsed.errors.length > 0) {
    await reply(interaction, {
      embeds: [
        embed(
          'error',
          t(locale, 'bot.admin.quiz.bulkErrors', { n: parsed.errors.length }),
          parsed.errors
            .slice(0, 15)
            .map((e) => `・${e}`)
            .join('\n'),
        ),
      ],
      flags: EPHEMERAL,
    });
    return;
  }
  const announce = (interaction.options.getInteger('announce') ?? 0) === 1;
  await confirm(ctx, interaction, {
    title: t(locale, 'bot.admin.quiz.bulkConfirmTitle', { n: parsed.questions.length }),
    body: parsed.questions
      .slice(0, 10)
      .map((q, i) => `${i + 1}. ${q.question.slice(0, 60)}`)
      .join('\n'),
    button: t(locale, 'bot.admin.quiz.bulkBtn'),
    run: async (button) => {
      const res = ctx.deps.games?.quiz.importOfficial(text) ?? {
        imported: 0,
        errors: [] as string[],
      };
      if (res.errors.length > 0) {
        await done(
          button,
          embed(
            'error',
            t(locale, 'bot.admin.quiz.bulkErrors', { n: res.errors.length }),
            res.errors
              .slice(0, 15)
              .map((e) => `・${e}`)
              .join('\n'),
          ),
        );
        return;
      }
      if (announce) {
        for (const quiz of ctx.deps.games?.quiz.listOpen(200).slice(-res.imported) ?? []) {
          await announceQuiz(ctx, button.client, quiz, guild, channel);
        }
      }
      await done(
        button,
        embed('success', t(locale, 'bot.admin.quiz.bulkDone', { n: res.imported })),
      );
    },
  });
}

async function quizList(ctx: ChatCtx, interaction: ChatInputCommandInteraction): Promise<void> {
  const { locale } = ctx;
  if (!ctx.deps.games) throw new AppError('internal');
  const rows = ctx.deps.games.quiz.listOpen(25);
  await reply(interaction, {
    embeds: [
      embed(
        'info',
        t(locale, 'bot.admin.quiz.listTitle'),
        rows.length === 0
          ? t(locale, 'bot.admin.quiz.listNone')
          : rows
              .map((q) =>
                t(locale, 'bot.admin.quiz.listLine', {
                  id: q.id,
                  question: q.question.replace(/\s+/g, ' ').slice(0, 50),
                  reward: formatNumber(locale, q.reward),
                  answers: q.answers,
                  kind: t(
                    locale,
                    q.authorId === null ? 'bot.admin.quiz.official' : 'bot.admin.quiz.user',
                  ),
                }),
              )
              .join('\n'),
      ),
    ],
    flags: EPHEMERAL,
  });
}

async function quizDelete(ctx: ChatCtx, interaction: ChatInputCommandInteraction): Promise<void> {
  const { locale } = ctx;
  if (!ctx.deps.games) throw new AppError('internal');
  const quizId = interaction.options.getInteger('quiz_id', true);
  const open = ctx.deps.games.quiz.listOpen(500).find((q) => q.id === quizId);
  if (!open) throw new AppError('not_found');
  await confirm(ctx, interaction, {
    title: t(locale, 'bot.admin.quiz.deleteTitle', { id: quizId }),
    body: open.question.slice(0, 200),
    button: t(locale, 'bot.admin.quiz.deleteBtn'),
    run: async (button) => {
      ctx.deps.games?.quiz.deleteQuiz(quizId);
      await done(button, embed('success', t(locale, 'bot.admin.quiz.deleted', { id: quizId })));
    },
  });
}

// ------------------------------------------------------------------ announce / purge

const announceParams = new FormParams<{
  guilds: string[];
  channel: string | null;
  title: string;
  image: string | null;
}>();

async function announce(ctx: ChatCtx, interaction: ChatInputCommandInteraction): Promise<void> {
  const { locale } = ctx;
  const guildRaw = interaction.options.getString('guild_id');
  const channelRaw = interaction.options.getString('channel_id');
  needGuildForChannel(guildRaw, channelRaw);
  const guilds = targetGuilds(ctx, guildRaw);
  const image = interaction.options.getAttachment('image');
  if (
    image &&
    !((image.contentType ?? '').startsWith('image/') && (image.size ?? 0) <= 8 * 1024 * 1024)
  ) {
    throw new AdminRefusal('bot.admin.err.announceBadImage', 'bot.admin.err.announceBadImageBody');
  }
  const title = (
    interaction.options.getString('title')?.trim() || t(locale, 'bot.admin.announce.defaultTitle')
  ).slice(0, 200);
  announceParams.set(
    interaction.id,
    { guilds, channel: channelRaw, title, image: image?.url ?? null },
    nowOf(ctx.deps),
  );
  await interaction.showModal(
    new ModalBuilder()
      .setCustomId(cid('admn', 'announce', interaction.id))
      .setTitle(t(locale, 'bot.admin.announce.modalTitle'))
      .addComponents(
        new ActionRowBuilder<TextInputBuilder>().addComponents(
          new TextInputBuilder()
            .setCustomId('body')
            .setLabel(t(locale, 'bot.admin.announce.modalBody'))
            .setStyle(TextInputStyle.Paragraph)
            .setRequired(true)
            .setMaxLength(2000),
        ),
      ),
  );
}

const purging = new Set<string>();
/** At most 50 pages (5,000 messages) are scanned per purge. */
const PURGE_MAX_PAGES = 50;
/** Discord refuses to bulk-delete messages older than 14 days. */
const BULK_DELETE_MAX_AGE_MS = 14 * 86_400_000 - 60_000;

interface PurgeMessage {
  id: string;
  author: { id: string };
  createdTimestamp?: number;
  delete(): Promise<unknown>;
}

async function purgeMessages(
  ctx: ChatCtx,
  interaction: ChatInputCommandInteraction,
): Promise<void> {
  const { locale } = ctx;
  const guildId = knownGuild(ctx, interaction.options.getString('guild_id', true), true);
  const channelId = parseSnowflake(interaction.options.getString('channel_id', true));
  const channel =
    channelId === null ? null : await fetchSendable(interaction.client, channelId, guildId);
  if (channelId === null || !channel) {
    throw new AdminRefusal('bot.admin.err.purgeNoPerm', 'bot.admin.err.purgeNoPermBody', {
      ch: channelId ?? '?',
    });
  }
  await confirm(ctx, interaction, {
    title: t(locale, 'bot.admin.purge.confirmTitle'),
    body: t(locale, 'bot.admin.purge.confirmBody', {
      guild: guildLabel(ctx, guildId),
      channel: `<#${channelId}>`,
    }),
    button: t(locale, 'bot.admin.purge.btn'),
    run: async (button) => {
      if (purging.has(channelId)) {
        await done(button, embed('warning', t(locale, 'bot.admin.purge.running')));
        return;
      }
      purging.add(channelId);
      let scanned = 0;
      let deleted = 0;
      try {
        await updateMessage(button, {
          embeds: [embed('neutral', t(locale, 'bot.admin.purge.progress', { deleted, scanned }))],
          components: [],
        });
        const me = button.client.user?.id;
        const freshAfter = nowOf(ctx.deps) - BULK_DELETE_MAX_AGE_MS;
        const messages = channel.messages as unknown as {
          fetch(o: { limit: number; before?: string }): Promise<Map<string, PurgeMessage>>;
        };
        let before: string | undefined;
        for (let page = 0; page < PURGE_MAX_PAGES; page++) {
          const batch = await messages.fetch({
            limit: 100,
            ...(before === undefined ? {} : { before }),
          });
          if (batch.size === 0) break;
          const fresh: string[] = [];
          const old: PurgeMessage[] = [];
          for (const message of batch.values()) {
            scanned += 1;
            before = message.id;
            if (message.author.id !== me) continue;
            if ((message.createdTimestamp ?? 0) > freshAfter) fresh.push(message.id);
            else old.push(message);
          }
          // Messages younger than 14 days go in bulk (explicit ids: only the bot's own).
          if (fresh.length === 1) {
            const one = batch.get(fresh[0]!)!;
            await one
              .delete()
              .then(() => (deleted += 1))
              .catch(() => undefined);
          } else if (fresh.length > 1) {
            await channel
              .bulkDelete(fresh)
              .then(() => (deleted += fresh.length))
              .catch(() => undefined);
          }
          for (const message of old) {
            await message
              .delete()
              .then(() => (deleted += 1))
              .catch(() => undefined);
          }
          if (deleted > 0) {
            await button
              .editReply({
                embeds: [
                  embed('neutral', t(locale, 'bot.admin.purge.progress', { deleted, scanned })),
                ],
              })
              .catch(() => undefined);
          }
          if (batch.size < 100) break;
        }
      } finally {
        purging.delete(channelId);
      }
      await button
        .editReply({
          embeds: [
            embed(
              'success',
              t(locale, 'bot.admin.purge.done'),
              t(locale, 'bot.admin.purge.doneBody', { deleted, scanned }),
            ),
          ],
        })
        .catch(() => undefined);
    },
  });
}

// ------------------------------------------------------------------ servers

async function serverList(ctx: ChatCtx, interaction: ChatInputCommandInteraction): Promise<void> {
  const { locale } = ctx;
  const store = requireStore(ctx);
  const rows = store
    .stmt('SELECT guild_id, name, status FROM guilds ORDER BY created_at, guild_id')
    .all() as {
    guild_id: string;
    name: string | null;
    status: 'pending' | 'approved' | 'denied';
  }[];
  const group = (status: 'approved' | 'pending' | 'denied'): string =>
    rows
      .filter(
        (r) =>
          r.status === status ||
          (status === 'approved' &&
            ctx.deps.allowedGuildIds.has(r.guild_id) &&
            r.status !== 'denied'),
      )
      .filter((r, i, all) => all.findIndex((x) => x.guild_id === r.guild_id) === i)
      .map((r) => `${r.name ?? '?'} \`${r.guild_id}\``)
      .join('\n') || '–';
  const e = embed(
    'info',
    t(locale, 'bot.admin.servers.title'),
    t(locale, 'bot.admin.servers.mode', {
      mode: t(locale, ctx.deps.requireApproval ? 'bot.admin.notify.on' : 'bot.admin.notify.off'),
      joined: interaction.client.guilds?.cache?.size ?? 0,
    }),
  ).addFields(
    { name: t(locale, 'bot.admin.servers.allowed'), value: group('approved').slice(0, 1000) },
    { name: t(locale, 'bot.admin.servers.pending'), value: group('pending').slice(0, 1000) },
    { name: t(locale, 'bot.admin.servers.denied'), value: group('denied').slice(0, 1000) },
  );
  await reply(interaction, { embeds: [e], flags: EPHEMERAL });
}

function snowflakeOrRefuse(raw: string): string {
  if (!/^\d+$/.test(raw.trim())) {
    throw new AdminRefusal('bot.admin.err.serverIdInvalid', 'bot.admin.err.serverIdInvalidBody');
  }
  const id = parseSnowflake(raw);
  if (!id)
    throw new AdminRefusal('bot.admin.err.serverIdInvalid', 'bot.admin.err.serverIdInvalidBody');
  return id;
}

async function serverAllow(ctx: ChatCtx, interaction: ChatInputCommandInteraction): Promise<void> {
  const { locale } = ctx;
  const id = snowflakeOrRefuse(interaction.options.getString('guild_id', true));
  const { identity } = ctx.deps;
  if (identity.getGuildStatus(id) === null) identity.ensureGuild(id, 'approved');
  identity.setGuildStatus(id, 'approved', interaction.user.id);
  const joined = interaction.client.guilds?.cache?.get(id);
  if (joined) {
    identity.setGuildName(id, joined.name);
    const channelId =
      ctx.deps.notifyConfig?.getGuildConfig(id).effectiveChannelId || joined.systemChannelId;
    if (channelId) {
      await post(ctx, interaction.client, id, channelId, {
        embeds: [
          embed(
            'success',
            t(locale, 'bot.admin.servers.approvedGuildTitle'),
            t(locale, 'bot.admin.servers.approvedGuildBody'),
          ),
        ],
      }).catch(() => false);
    }
  }
  await reply(interaction, {
    embeds: [
      embed(
        'success',
        t(locale, 'bot.admin.servers.approvedTitle'),
        t(locale, 'bot.admin.servers.approvedBody', { guild: guildLabel(ctx, id) }),
      ),
    ],
    flags: EPHEMERAL,
  });
}

async function serverRevoke(ctx: ChatCtx, interaction: ChatInputCommandInteraction): Promise<void> {
  const { locale } = ctx;
  const id = snowflakeOrRefuse(interaction.options.getString('guild_id', true));
  if (ctx.deps.allowedGuildIds.has(id)) {
    throw new AdminRefusal('bot.admin.err.revokePre', 'bot.admin.err.revokePreBody');
  }
  await confirm(ctx, interaction, {
    title: t(locale, 'bot.admin.servers.revokeTitle'),
    body: t(locale, 'bot.admin.servers.revokeBody', { guild: guildLabel(ctx, id) }),
    button: t(locale, 'bot.admin.servers.revokeBtn'),
    run: async (button) => {
      const { identity } = ctx.deps;
      if (identity.getGuildStatus(id) === null) identity.ensureGuild(id, 'denied');
      identity.setGuildStatus(id, 'denied', interaction.user.id);
      try {
        ctx.deps.onGuildRevoked?.(id);
      } catch (error) {
        ctx.deps.logger.warn({ err: error, guildId: id }, 'guild revoke hook failed');
      }
      const joined = button.client.guilds?.cache?.get(id);
      let left = false;
      if (joined)
        left = await joined
          .leave()
          .then(() => true)
          .catch(() => false);
      await done(
        button,
        embed(
          'success',
          t(locale, 'bot.admin.servers.deniedTitle'),
          `${t(locale, 'bot.admin.servers.deniedBody', { guild: guildLabel(ctx, id) })} ${t(locale, left ? 'bot.admin.servers.left' : 'bot.admin.servers.notJoined')}`,
        ),
      );
    },
  });
}

// ------------------------------------------------------------------ autocomplete

export async function adminAutocomplete(
  ctx: ChatCtx,
  interaction: AutocompleteInteraction,
): Promise<boolean> {
  if (!ctx.deps.store || !isOwner(ctx.deps, interaction.user.id)) {
    await interaction.respond([]);
    return true;
  }
  const focused = interaction.options.getFocused(true);
  const needle = String(focused.value).toLowerCase();
  const store = ctx.deps.store;
  if (focused.name === 'guild_id') {
    const rows = store
      .stmt('SELECT guild_id, name FROM guilds ORDER BY name, guild_id LIMIT 200')
      .all() as { guild_id: string; name: string | null }[];
    await interaction.respond(
      rows
        .filter(
          (r) =>
            needle === '' ||
            r.guild_id.includes(needle) ||
            (r.name ?? '').toLowerCase().includes(needle),
        )
        .slice(0, 25)
        .map((r) => ({
          name: `${r.name ?? r.guild_id} (${r.guild_id})`.slice(0, 100),
          value: r.guild_id,
        })),
    );
    return true;
  }
  if (focused.name === 'user_id') {
    const guildId = parseSnowflake(String(interaction.options.getString('guild_id') ?? ''));
    if (!guildId) {
      await interaction.respond([]);
      return true;
    }
    const rows = store
      .stmt(
        `SELECT m.user_id AS user_id, COALESCE(u.global_name, u.username, m.user_id) AS name
           FROM guild_members m LEFT JOIN users u ON u.user_id = m.user_id
          WHERE m.guild_id = ? ORDER BY name LIMIT 200`,
      )
      .all(guildId) as { user_id: string; name: string }[];
    await interaction.respond(
      rows
        .filter(
          (r) =>
            needle === '' || r.user_id.includes(needle) || r.name.toLowerCase().includes(needle),
        )
        .slice(0, 25)
        .map((r) => ({ name: `${r.name} (${r.user_id})`.slice(0, 100), value: r.user_id })),
    );
    return true;
  }
  await interaction.respond([]);
  return true;
}

// ------------------------------------------------------------------ entry points

export async function handleAdminCommand(
  ctx: ChatCtx,
  path: string,
  interaction: ChatInputCommandInteraction,
): Promise<boolean> {
  if (!path.startsWith('admin ') || path === 'admin notifications') return false;
  if (!isOwner(ctx.deps, interaction.user.id)) {
    throw new AppError('forbidden', { reason: 'owner_only' });
  }
  try {
    switch (path) {
      case 'admin grant':
        await grant(ctx, interaction);
        return true;
      case 'admin set-balance':
        await setBalanceCommand(ctx, interaction);
        return true;
      case 'admin pachinko-stats':
        await pachinkoStats(ctx, interaction);
        return true;
      case 'admin click-history':
        await clickHistory(ctx, interaction);
        return true;
      case 'admin host-race':
        await hostRace(ctx, interaction);
        return true;
      case 'admin host-arena':
        await hostArena(ctx, interaction);
        return true;
      case 'admin announce':
        await announce(ctx, interaction);
        return true;
      case 'admin purge-messages':
        await purgeMessages(ctx, interaction);
        return true;
      case 'admin server-list':
        await serverList(ctx, interaction);
        return true;
      case 'admin server-allow':
        await serverAllow(ctx, interaction);
        return true;
      case 'admin server-revoke':
        await serverRevoke(ctx, interaction);
        return true;
      case 'admin event start':
        await eventStart(ctx, interaction);
        return true;
      case 'admin event stop':
        await eventStop(ctx, interaction);
        return true;
      case 'admin rtp set':
        await rtpSet(ctx, interaction);
        return true;
      case 'admin rtp list':
        await rtpList(ctx, interaction);
        return true;
      case 'admin feature off':
        await featureToggle(ctx, interaction, false);
        return true;
      case 'admin feature on':
        await featureToggle(ctx, interaction, true);
        return true;
      case 'admin feature list':
        await featureList(ctx, interaction);
        return true;
      case 'admin raffle start':
        await raffleStart(ctx, interaction);
        return true;
      case 'admin raffle repost':
        await raffleRepost(ctx, interaction);
        return true;
      case 'admin raffle cancel':
        await raffleCancel(ctx, interaction);
        return true;
      case 'admin quiz add':
        await quizAddModal(ctx, interaction);
        return true;
      case 'admin quiz bulk':
        await quizBulk(ctx, interaction);
        return true;
      case 'admin quiz list':
        await quizList(ctx, interaction);
        return true;
      case 'admin quiz delete':
        await quizDelete(ctx, interaction);
        return true;
      default:
        return false;
    }
  } catch (error) {
    if (error instanceof AdminRefusal) {
      await reply(interaction, {
        embeds: [
          embed('error', t(ctx.locale, error.titleKey), t(ctx.locale, error.bodyKey, error.params)),
        ],
        flags: EPHEMERAL,
      });
      return true;
    }
    throw error;
  }
}

export async function handleAdminComponent(
  ctx: ChatCtx,
  interaction: ButtonInteraction,
  id: ParsedCid,
): Promise<boolean> {
  if (id.namespace === 'adm') {
    await adminButton(ctx, interaction, id);
    return true;
  }
  if (id.namespace === 'raf' && id.action === 'join') {
    await raffleJoin(ctx, interaction, Number(id.args[0]));
    return true;
  }
  return false;
}
