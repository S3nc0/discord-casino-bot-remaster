import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  type ButtonInteraction,
  type ChatInputCommandInteraction,
  type Client,
  type ModalSubmitInteraction,
} from 'discord.js';
import type { Logger } from 'pino';
import {
  STREAM_LIMITS,
  STREAM_ODDS_ONE,
  STREAM_PANEL_COLOR_LIVE,
  type StreamSide,
  type StreamView,
} from '@casino/shared';
import {
  dictionaries,
  errorMessageKey,
  formatPelica,
  resolveLocale,
  t,
  type Locale,
  type MessageKey,
} from '@casino/shared/i18n';
import type { IdentityRepo } from '../db/identity.ts';
import { GameRuleError } from '../games/progression/context.ts';
import { botColor } from '../notify/theme.ts';
import { AppError } from '../runtime/errors.ts';
import type { StreamChange, StreamService } from '../stream/service.ts';
import { fetchSendable } from './boards.ts';
import {
  EPHEMERAL,
  activityRow,
  cid,
  embed,
  formatNumber,
  idemKeyOf,
  reply,
  requireGuild,
  updateMessage,
  type ChatCtx,
  type ParsedCid,
} from './chat-kit.ts';

/** Custom-id namespace for all stream panel buttons, menus and modals. */
export const STREAM_CID_NAMESPACE = 'stm';

/** Coalescing window for panel message edits (spec §7: 2–3 s, latest state wins). */
export const STREAM_PANEL_DEBOUNCE_MS = 2_500;

const NO_MENTIONS = { parse: [] as never[] };

function requireStream(ctx: ChatCtx): StreamService {
  if (!ctx.deps.stream) throw new AppError('feature_disabled');
  return ctx.deps.stream;
}

function parsePosInt(raw: string | undefined): number | null {
  if (!raw || !/^\d{1,15}$/.test(raw)) return null;
  const n = Number(raw);
  return Number.isSafeInteger(n) && n > 0 ? n : null;
}

function parseTypedAmount(raw: string): number | null {
  const cleaned = raw.normalize('NFKC').replace(/[,\s_]/g, '');
  if (!/^\d{1,12}$/.test(cleaned)) return null;
  const n = Number(cleaned);
  return Number.isSafeInteger(n) && n > 0 ? n : null;
}

function modalField(interaction: ModalSubmitInteraction, name: string): string {
  try {
    return interaction.fields.getTextInputValue(name);
  } catch {
    return '';
  }
}

function roundLabel(locale: Locale, label: string): string {
  return label === '' ? t(locale, 'screen.stream.round.default') : label;
}

function sideLabel(locale: Locale, side: StreamSide): string {
  return t(locale, side === 'win' ? 'screen.stream.side.win' : 'screen.stream.side.lose');
}

function oddsText(locale: Locale, bps: number | null): string {
  if (bps === null) return '';
  return t(locale, 'screen.stream.odds', { odds: (bps / STREAM_ODDS_ONE).toFixed(2) });
}

function lookupRuleMessage(
  locale: Locale,
  rule: string,
  params: Record<string, string | number>,
): string {
  for (const prefix of ['screen.stream.rule.', 'screen.life.rule.', 'bot.rule.'] as const) {
    const key = `${prefix}${rule}`;
    if (Object.hasOwn(dictionaries[locale], key)) {
      return t(locale, key as MessageKey, params);
    }
  }
  const errKey = `error.${rule}`;
  if (Object.hasOwn(dictionaries[locale], errKey)) {
    return t(locale, errKey as MessageKey, params);
  }
  return t(locale, 'error.conflict');
}

function streamErrorText(locale: Locale, error: unknown): string {
  if (error instanceof GameRuleError) {
    return lookupRuleMessage(locale, error.rule, error.params);
  }
  if (error instanceof AppError) {
    return t(locale, errorMessageKey(error.code));
  }
  return t(locale, 'error.internal');
}

async function replyStreamError(
  interaction: ChatInputCommandInteraction | ButtonInteraction | ModalSubmitInteraction,
  locale: Locale,
  titleKey: MessageKey,
  error: unknown,
  useUpdate = false,
): Promise<void> {
  if (!(error instanceof AppError)) throw error;
  const e = embed('error', t(locale, titleKey), streamErrorText(locale, error));
  if (useUpdate && interaction.isButton()) {
    await updateMessage(interaction, { embeds: [e], components: [] });
    return;
  }
  await reply(interaction, { embeds: [e], flags: EPHEMERAL });
}

function extractConfirmMessage(interaction: ButtonInteraction): string {
  const first = (
    interaction as unknown as {
      message?: {
        embeds?: Array<{
          fields?: readonly { value?: string }[];
          toJSON?: () => { fields?: readonly { value?: string }[] };
        }>;
      };
    }
  ).message?.embeds?.[0];
  if (!first) return '';
  const fields = first.fields ?? first.toJSON?.().fields;
  return fields?.[0]?.value ?? '';
}

// ------------------------------------------------------------------ panel embed & buttons

/** Panel embed (spec §3): red while live, info when ended; location shown only when set. */
export function panelEmbed(locale: Locale, view: StreamView): EmbedBuilder {
  const live = view.status === 'live';
  const lines: string[] = [
    t(locale, 'bot.stream.panel.streamer', { streamer: `<@${view.streamerId}>` }),
  ];
  if (view.location) {
    lines.push(
      t(locale, 'bot.stream.panel.location', { channel: `<#${view.location.channelId}>` }),
    );
  }
  if (view.url) {
    lines.push(`📺 ${view.url}`);
  }
  lines.push(
    t(locale, 'bot.stream.panel.tips', {
      amount: formatPelica(locale, view.tips),
      count: formatNumber(locale, view.tipCount),
    }),
  );

  if (live && view.round) {
    const r = view.round;
    const status = t(
      locale,
      r.status === 'open' ? 'screen.stream.round.open' : 'screen.stream.round.locked',
    );
    lines.push(
      '',
      t(locale, 'bot.stream.panel.round', { label: roundLabel(locale, r.label), status }),
      t(locale, 'bot.stream.panel.win', {
        amount: formatPelica(locale, r.winTotal),
        odds: oddsText(locale, r.winOddsBps),
      }).trimEnd(),
      t(locale, 'bot.stream.panel.lose', {
        amount: formatPelica(locale, r.loseTotal),
        odds: oddsText(locale, r.loseOddsBps),
      }).trimEnd(),
      t(locale, 'bot.stream.panel.bettors', { count: formatNumber(locale, r.bettors) }),
    );
    if (r.status === 'open') {
      lines.push(
        t(locale, 'bot.stream.panel.autoLock', {
          time: `<t:${Math.floor(r.autoLockAt / 1000)}:R>`,
        }),
      );
    }
  } else if (live) {
    lines.push('', t(locale, 'bot.stream.panel.noRound'));
  }

  if (live) {
    lines.push(
      '',
      t(locale, 'bot.stream.panel.closes', {
        time: `<t:${Math.floor(view.endsAt / 1000)}:R>`,
      }),
    );
  }

  const e = new EmbedBuilder()
    .setColor(live ? STREAM_PANEL_COLOR_LIVE : botColor('info'))
    .setTitle(
      t(locale, live ? 'bot.stream.panel.titleLive' : 'bot.stream.panel.titleEnded', {
        title: view.title,
      }),
    )
    .setDescription(lines.join('\n'));

  if (live) {
    e.setFooter({
      text: t(locale, 'bot.stream.panel.footer', {
        rake: `${Math.floor(STREAM_LIMITS.rakeBps / 100)}%`,
        max: formatNumber(locale, STREAM_LIMITS.betMax),
      }),
    });
  }
  return e;
}

/** Persistent panel buttons (restart-proof via `cid('stm', ...)`) plus Activity launch row. */
export function panelRows(locale: Locale, streamId: number): ActionRowBuilder<ButtonBuilder>[] {
  const actions = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(cid(STREAM_CID_NAMESPACE, 'tip', streamId))
      .setEmoji('💸')
      .setLabel(t(locale, 'bot.stream.btn.tip'))
      .setStyle(ButtonStyle.Danger),
    new ButtonBuilder()
      .setCustomId(cid(STREAM_CID_NAMESPACE, 'win', streamId))
      .setEmoji('🏆')
      .setLabel(t(locale, 'bot.stream.btn.win'))
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId(cid(STREAM_CID_NAMESPACE, 'lose', streamId))
      .setEmoji('💀')
      .setLabel(t(locale, 'bot.stream.btn.lose'))
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(cid(STREAM_CID_NAMESPACE, 'menu', streamId))
      .setEmoji('🎛️')
      .setLabel(t(locale, 'bot.stream.btn.menu'))
      .setStyle(ButtonStyle.Primary),
  );
  return [actions, activityRow(locale, 'stream')];
}

/** Full panel payload: embed + buttons while live, buttons removed when ended. */
export function panelMessage(locale: Locale, view: StreamView) {
  return {
    embeds: [panelEmbed(locale, view)],
    components: view.status === 'live' ? panelRows(locale, view.id) : [],
    allowedMentions: NO_MENTIONS,
  };
}

// ------------------------------------------------------------------ modals & menus

function tipModal(locale: Locale, streamId: number): ModalBuilder {
  const amount = new TextInputBuilder()
    .setCustomId('amount')
    .setLabel(
      t(locale, 'bot.stream.tip.amount', { min: formatNumber(locale, STREAM_LIMITS.tipMin) }).slice(
        0,
        45,
      ),
    )
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setMaxLength(9);
  const message = new TextInputBuilder()
    .setCustomId('message')
    .setLabel(t(locale, 'bot.stream.tip.message').slice(0, 45))
    .setStyle(TextInputStyle.Paragraph)
    .setRequired(false)
    .setMaxLength(STREAM_LIMITS.tipMessageMax);
  return new ModalBuilder()
    .setCustomId(cid(STREAM_CID_NAMESPACE, 'mtip', streamId))
    .setTitle(t(locale, 'bot.stream.tip.modal').slice(0, 45))
    .addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(amount),
      new ActionRowBuilder<TextInputBuilder>().addComponents(message),
    );
}

function betModal(
  locale: Locale,
  streamId: number,
  roundId: number,
  side: StreamSide,
): ModalBuilder {
  const amount = new TextInputBuilder()
    .setCustomId('amount')
    .setLabel(
      t(locale, 'bot.stream.bet.amount', {
        min: formatNumber(locale, STREAM_LIMITS.betMin),
        max: formatNumber(locale, STREAM_LIMITS.betMax),
      }).slice(0, 45),
    )
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setMaxLength(9)
    .setValue(String(STREAM_LIMITS.betMin));
  return new ModalBuilder()
    .setCustomId(cid(STREAM_CID_NAMESPACE, 'mbet', streamId, roundId, side))
    .setTitle(t(locale, 'bot.stream.bet.modal', { side: sideLabel(locale, side) }).slice(0, 45))
    .addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(amount));
}

function roundModal(locale: Locale, streamId: number): ModalBuilder {
  const label = new TextInputBuilder()
    .setCustomId('label')
    .setLabel(t(locale, 'bot.stream.round.label').slice(0, 45))
    .setStyle(TextInputStyle.Short)
    .setRequired(false)
    .setMaxLength(STREAM_LIMITS.roundLabelMax);
  return new ModalBuilder()
    .setCustomId(cid(STREAM_CID_NAMESPACE, 'mopen', streamId))
    .setTitle(t(locale, 'bot.stream.round.modal').slice(0, 45))
    .addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(label));
}

/**
 * Ephemeral streamer menu. Per decision D3, win/lose buttons are only offered when the round is
 * locked; while open only lock, void and end are offered.
 */
function streamerMenuMessage(locale: Locale, view: StreamView, notice?: string) {
  const r = view.round;
  const buttons: ButtonBuilder[] = [];
  if (r === null) {
    buttons.push(
      new ButtonBuilder()
        .setCustomId(cid(STREAM_CID_NAMESPACE, 'open', view.id))
        .setLabel(t(locale, 'bot.stream.menu.open'))
        .setStyle(ButtonStyle.Primary),
    );
  } else if (r.status === 'open') {
    buttons.push(
      new ButtonBuilder()
        .setCustomId(cid(STREAM_CID_NAMESPACE, 'lock', view.id, r.id))
        .setLabel(t(locale, 'bot.stream.menu.lock'))
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId(cid(STREAM_CID_NAMESPACE, 'void', view.id, r.id))
        .setLabel(t(locale, 'bot.stream.menu.void'))
        .setStyle(ButtonStyle.Secondary),
    );
  } else {
    buttons.push(
      new ButtonBuilder()
        .setCustomId(cid(STREAM_CID_NAMESPACE, 'swin', view.id, r.id))
        .setLabel(t(locale, 'bot.stream.menu.win'))
        .setStyle(ButtonStyle.Success),
      new ButtonBuilder()
        .setCustomId(cid(STREAM_CID_NAMESPACE, 'slose', view.id, r.id))
        .setLabel(t(locale, 'bot.stream.menu.lose'))
        .setStyle(ButtonStyle.Danger),
      new ButtonBuilder()
        .setCustomId(cid(STREAM_CID_NAMESPACE, 'void', view.id, r.id))
        .setLabel(t(locale, 'bot.stream.menu.void'))
        .setStyle(ButtonStyle.Secondary),
    );
  }
  buttons.push(
    new ButtonBuilder()
      .setCustomId(cid(STREAM_CID_NAMESPACE, 'end', view.id))
      .setLabel(t(locale, 'bot.stream.menu.end'))
      .setStyle(ButtonStyle.Danger),
  );
  return {
    embeds: [embed('primary', t(locale, 'bot.stream.menu.title'), notice)],
    components: [new ActionRowBuilder<ButtonBuilder>().addComponents(buttons)],
  };
}

function confirmMessage(
  locale: Locale,
  title: string,
  body: string,
  yesId: string,
  yesLabel: string,
  extraField?: { name: string; value: string },
) {
  const e = embed('warning', title, body);
  if (extraField) e.addFields(extraField);
  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(yesId).setLabel(yesLabel).setStyle(ButtonStyle.Danger),
    new ButtonBuilder()
      .setCustomId(cid(STREAM_CID_NAMESPACE, 'no'))
      .setLabel(t(locale, 'common.cancel'))
      .setStyle(ButtonStyle.Secondary),
  );
  return { embeds: [e], components: [row] };
}

// ------------------------------------------------------------------ /stream start

/** Handle `/stream start title [url]` (`/配信 開始`). */
export async function handleStreamCommand(
  ctx: ChatCtx,
  path: string,
  interaction: ChatInputCommandInteraction,
): Promise<boolean> {
  if (path !== 'stream start') return false;
  const { locale } = ctx;
  const service = requireStream(ctx);
  const guildId = requireGuild(interaction);
  const title = interaction.options.getString('title', true);
  const url = interaction.options.getString('url');

  let view: StreamView;
  try {
    const res = service.start(
      { guildId, userId: interaction.user.id },
      {
        title,
        ...(url !== null ? { url } : {}),
        channelId: interaction.channelId,
        idempotencyKey: idemKeyOf(interaction, STREAM_CID_NAMESPACE),
      },
    );
    view = res.stream;
  } catch (error) {
    await replyStreamError(interaction, locale, 'bot.stream.startErrTitle', error);
    return true;
  }

  await reply(interaction, panelMessage(locale, view));
  try {
    const posted = await interaction.fetchReply();
    const channelId = posted.channelId ?? interaction.channelId;
    if (channelId) {
      service.attachPanel(guildId, view.id, channelId, posted.id);
    }
  } catch (error) {
    ctx.deps.logger.warn(
      { err: error, guildId, streamId: view.id },
      'failed to record stream panel message',
    );
  }
  return true;
}

// ------------------------------------------------------------------ buttons

function requireLiveStreamer(
  service: StreamService,
  actor: { guildId: string; userId: string },
  streamId: number,
): StreamView {
  const view = service.liveView(actor, streamId);
  if (!view) throw new GameRuleError('stream_ended', {}, 'not_found');
  if (!view.me.isStreamer) throw new GameRuleError('stream_not_streamer', {}, 'forbidden');
  return view;
}

/** Handle persistent stream panel buttons, streamer menu actions and confirm steps. */
export async function handleStreamComponent(
  ctx: ChatCtx,
  interaction: ButtonInteraction,
  id: ParsedCid,
): Promise<boolean> {
  if (id.namespace !== STREAM_CID_NAMESPACE) return false;
  const { locale } = ctx;

  if (id.action === 'no') {
    await updateMessage(interaction, {
      embeds: [embed('neutral', undefined, t(locale, 'bot.stream.cancelled'))],
      components: [],
    });
    return true;
  }

  const service = requireStream(ctx);
  const guildId = requireGuild(interaction);
  const actor = { guildId, userId: interaction.user.id };
  const streamId = parsePosInt(id.args[0]);
  if (streamId === null) throw new AppError('invalid_payload');

  switch (id.action) {
    case 'tip': {
      if (!service.isEnabled(guildId)) {
        await replyStreamError(
          interaction,
          locale,
          'bot.stream.tip.errTitle',
          new AppError('feature_disabled'),
        );
        return true;
      }
      const view = service.liveView(actor, streamId);
      if (!view) {
        await replyStreamError(
          interaction,
          locale,
          'bot.stream.tip.errTitle',
          new GameRuleError('stream_ended'),
        );
        return true;
      }
      await interaction.showModal(tipModal(locale, streamId));
      return true;
    }

    case 'win':
    case 'lose': {
      if (!service.isEnabled(guildId)) {
        await replyStreamError(
          interaction,
          locale,
          'bot.stream.bet.errTitle',
          new AppError('feature_disabled'),
        );
        return true;
      }
      const view = service.liveView(actor, streamId);
      if (!view) {
        await replyStreamError(
          interaction,
          locale,
          'bot.stream.bet.errTitle',
          new GameRuleError('stream_ended'),
        );
        return true;
      }
      if (!view.round || view.round.status !== 'open') {
        await replyStreamError(
          interaction,
          locale,
          'bot.stream.bet.errTitle',
          new GameRuleError('stream_no_open_round'),
        );
        return true;
      }
      await interaction.showModal(betModal(locale, streamId, view.round.id, id.action));
      return true;
    }

    case 'menu': {
      const view = service.liveView(actor, streamId);
      if (!view) {
        await reply(interaction, {
          embeds: [embed('error', undefined, t(locale, 'screen.stream.rule.stream_ended'))],
          flags: EPHEMERAL,
        });
        return true;
      }
      if (!view.me.isStreamer) {
        await reply(interaction, {
          embeds: [embed('error', undefined, t(locale, 'bot.stream.menu.ownerOnlyButton'))],
          flags: EPHEMERAL,
        });
        return true;
      }
      await reply(interaction, { ...streamerMenuMessage(locale, view), flags: EPHEMERAL });
      return true;
    }

    case 'tipok': {
      const amount = parsePosInt(id.args[1]);
      if (amount === null) throw new AppError('invalid_payload');
      const message = extractConfirmMessage(interaction);
      try {
        const res = service.tip(actor, {
          streamId,
          amount,
          message,
          idempotencyKey: idemKeyOf(interaction, STREAM_CID_NAMESPACE),
        });
        await updateMessage(interaction, {
          embeds: [
            embed(
              'success',
              t(locale, 'bot.stream.tip.sentTitle'),
              t(locale, 'bot.stream.tip.sentBody', {
                fee: formatPelica(locale, res.fee),
                balance: formatPelica(locale, res.balance),
              }),
            ),
          ],
          components: [],
        });
      } catch (error) {
        await replyStreamError(interaction, locale, 'bot.stream.tip.errTitle', error, true);
      }
      return true;
    }

    case 'open': {
      try {
        const view = requireLiveStreamer(service, actor, streamId);
        if (view.round !== null) throw new GameRuleError('stream_round_active');
      } catch (error) {
        await replyStreamError(interaction, locale, 'bot.stream.settle.errTitle', error);
        return true;
      }
      await interaction.showModal(roundModal(locale, streamId));
      return true;
    }

    case 'lock': {
      const roundId = parsePosInt(id.args[1]);
      if (roundId === null) throw new AppError('invalid_payload');
      try {
        const res = service.lock(actor, {
          streamId,
          roundId,
          idempotencyKey: idemKeyOf(interaction, STREAM_CID_NAMESPACE),
        });
        await updateMessage(
          interaction,
          streamerMenuMessage(locale, res.stream, t(locale, 'bot.stream.menu.locked')),
        );
      } catch (error) {
        await replyStreamError(interaction, locale, 'bot.stream.settle.errTitle', error, true);
      }
      return true;
    }

    case 'swin':
    case 'slose':
    case 'void': {
      const roundId = parsePosInt(id.args[1]);
      if (roundId === null) throw new AppError('invalid_payload');
      try {
        const view = requireLiveStreamer(service, actor, streamId);
        if (!view.round) throw new GameRuleError('stream_no_round');
        if (view.round.id !== roundId) throw new GameRuleError('stream_round_changed');
        if (id.action !== 'void' && view.round.status === 'open') {
          throw new GameRuleError('stream_not_locked');
        }
      } catch (error) {
        await replyStreamError(interaction, locale, 'bot.stream.settle.errTitle', error, true);
        return true;
      }
      const confirmAction =
        id.action === 'swin' ? 'cwin' : id.action === 'slose' ? 'close' : 'cvoid';
      const body =
        id.action === 'void'
          ? t(locale, 'bot.stream.settle.voidBody')
          : t(locale, 'bot.stream.settle.sideBody', {
              side: sideLabel(locale, id.action === 'swin' ? 'win' : 'lose'),
            });
      await updateMessage(
        interaction,
        confirmMessage(
          locale,
          t(locale, 'bot.stream.settle.confirmTitle'),
          body,
          cid(STREAM_CID_NAMESPACE, confirmAction, streamId, roundId),
          t(locale, 'bot.stream.settle.yes'),
        ),
      );
      return true;
    }

    case 'end': {
      try {
        requireLiveStreamer(service, actor, streamId);
      } catch (error) {
        await replyStreamError(interaction, locale, 'bot.stream.settle.errTitle', error, true);
        return true;
      }
      await updateMessage(
        interaction,
        confirmMessage(
          locale,
          t(locale, 'bot.stream.end.confirmTitle'),
          t(locale, 'bot.stream.end.confirmBody'),
          cid(STREAM_CID_NAMESPACE, 'cend', streamId),
          t(locale, 'bot.stream.end.yes'),
        ),
      );
      return true;
    }

    case 'cwin':
    case 'close': {
      const roundId = parsePosInt(id.args[1]);
      if (roundId === null) throw new AppError('invalid_payload');
      try {
        service.settle(actor, {
          streamId,
          roundId,
          winner: id.action === 'cwin' ? 'win' : 'lose',
          idempotencyKey: idemKeyOf(interaction, STREAM_CID_NAMESPACE),
        });
        await updateMessage(interaction, {
          embeds: [embed('success', undefined, t(locale, 'bot.stream.settle.done'))],
          components: [],
        });
      } catch (error) {
        await replyStreamError(interaction, locale, 'bot.stream.settle.errTitle', error, true);
      }
      return true;
    }

    case 'cvoid': {
      const roundId = parsePosInt(id.args[1]);
      if (roundId === null) throw new AppError('invalid_payload');
      try {
        service.voidRound(actor, {
          streamId,
          roundId,
          idempotencyKey: idemKeyOf(interaction, STREAM_CID_NAMESPACE),
        });
        await updateMessage(interaction, {
          embeds: [embed('success', undefined, t(locale, 'bot.stream.settle.done'))],
          components: [],
        });
      } catch (error) {
        await replyStreamError(interaction, locale, 'bot.stream.settle.errTitle', error, true);
      }
      return true;
    }

    case 'cend': {
      try {
        service.end(actor, {
          streamId,
          idempotencyKey: idemKeyOf(interaction, STREAM_CID_NAMESPACE),
        });
        await updateMessage(interaction, {
          embeds: [embed('success', undefined, t(locale, 'bot.stream.end.done'))],
          components: [],
        });
      } catch (error) {
        await replyStreamError(interaction, locale, 'bot.stream.settle.errTitle', error, true);
      }
      return true;
    }

    default:
      return false;
  }
}

// ------------------------------------------------------------------ modals

/** Handle tip, bet and open-round modal submissions. */
export async function handleStreamModal(
  ctx: ChatCtx,
  interaction: ModalSubmitInteraction,
  id: ParsedCid,
): Promise<boolean> {
  if (id.namespace !== STREAM_CID_NAMESPACE) return false;
  const { locale } = ctx;
  const service = requireStream(ctx);
  const guildId = requireGuild(interaction);
  const actor = { guildId, userId: interaction.user.id };
  const streamId = parsePosInt(id.args[0]);
  if (streamId === null) throw new AppError('invalid_payload');

  switch (id.action) {
    case 'mtip': {
      if (!service.isEnabled(guildId)) {
        await replyStreamError(
          interaction,
          locale,
          'bot.stream.tip.errTitle',
          new AppError('feature_disabled'),
        );
        return true;
      }
      const amount = parseTypedAmount(modalField(interaction, 'amount'));
      if (amount === null) {
        await reply(interaction, {
          embeds: [
            embed('error', t(locale, 'bot.stream.tip.errTitle'), t(locale, 'bot.stream.notNumber')),
          ],
          flags: EPHEMERAL,
        });
        return true;
      }
      const message = modalField(interaction, 'message').trim();
      if (message.length > STREAM_LIMITS.tipMessageMax) {
        await replyStreamError(
          interaction,
          locale,
          'bot.stream.tip.errTitle',
          new AppError('invalid_payload'),
        );
        return true;
      }
      const preview = service.previewTip(actor, streamId, amount);
      if (!preview.ok) {
        await reply(interaction, {
          embeds: [
            embed(
              'error',
              t(locale, 'bot.stream.tip.errTitle'),
              lookupRuleMessage(locale, preview.rule, preview.params),
            ),
          ],
          flags: EPHEMERAL,
        });
        return true;
      }
      if (preview.needsConfirm) {
        await reply(interaction, {
          ...confirmMessage(
            locale,
            t(locale, 'bot.stream.tip.confirmTitle'),
            t(locale, 'bot.stream.tip.confirmBody', {
              amount: formatPelica(locale, preview.amount),
              fee: formatPelica(locale, preview.fee),
              total: formatPelica(locale, preview.total),
            }),
            cid(STREAM_CID_NAMESPACE, 'tipok', streamId, preview.amount),
            t(locale, 'bot.stream.tip.confirmYes'),
            message === ''
              ? undefined
              : { name: t(locale, 'bot.stream.tip.message'), value: message },
          ),
          flags: EPHEMERAL,
        });
        return true;
      }
      try {
        const res = service.tip(actor, {
          streamId,
          amount,
          message,
          idempotencyKey: idemKeyOf(interaction, STREAM_CID_NAMESPACE),
        });
        await reply(interaction, {
          embeds: [
            embed(
              'success',
              t(locale, 'bot.stream.tip.sentTitle'),
              t(locale, 'bot.stream.tip.sentBody', {
                fee: formatPelica(locale, res.fee),
                balance: formatPelica(locale, res.balance),
              }),
            ),
          ],
          flags: EPHEMERAL,
        });
      } catch (error) {
        await replyStreamError(interaction, locale, 'bot.stream.tip.errTitle', error);
      }
      return true;
    }

    case 'mbet': {
      const roundId = parsePosInt(id.args[1]);
      const side = id.args[2];
      if (roundId === null || (side !== 'win' && side !== 'lose')) {
        throw new AppError('invalid_payload');
      }
      const amount = parseTypedAmount(modalField(interaction, 'amount'));
      if (amount === null) {
        await reply(interaction, {
          embeds: [
            embed('error', t(locale, 'bot.stream.bet.errTitle'), t(locale, 'bot.stream.notNumber')),
          ],
          flags: EPHEMERAL,
        });
        return true;
      }
      try {
        const res = service.bet(actor, {
          streamId,
          roundId,
          side,
          amount,
          idempotencyKey: idemKeyOf(interaction, STREAM_CID_NAMESPACE),
        });
        await reply(interaction, {
          embeds: [
            embed(
              'success',
              t(locale, 'bot.stream.bet.doneTitle'),
              t(locale, 'bot.stream.bet.doneBody', {
                amount: formatPelica(locale, amount),
                side: sideLabel(locale, side),
                balance: formatPelica(locale, res.balance),
              }),
            ),
          ],
          flags: EPHEMERAL,
        });
      } catch (error) {
        await replyStreamError(interaction, locale, 'bot.stream.bet.errTitle', error);
      }
      return true;
    }

    case 'mopen': {
      const label = modalField(interaction, 'label');
      try {
        const res = service.openRound(actor, {
          streamId,
          label,
          idempotencyKey: idemKeyOf(interaction, STREAM_CID_NAMESPACE),
        });
        const shown = roundLabel(locale, res.stream.round?.label ?? label.trim());
        await reply(interaction, {
          embeds: [embed('success', t(locale, 'bot.stream.round.openedTitle', { label: shown }))],
          flags: EPHEMERAL,
        });
      } catch (error) {
        await replyStreamError(interaction, locale, 'bot.stream.settle.errTitle', error);
      }
      return true;
    }

    default:
      return false;
  }
}

// ------------------------------------------------------------------ debounced panel edits

export interface StreamPanelRefresher {
  /** Number of pending debounce timers (diagnostics and tests). */
  pendingTimers(): number;
  /** Unsubscribe and clear every pending timer (shutdown). */
  stop(): void;
}

/**
 * Debounced panel editor driven by `StreamService.onChange` (spec §7, §16).
 * At most one edit per panel every `debounceMs` (default 2.5 s); latest state wins; missing or
 * deleted panel messages are ignored quietly; timers are the only in-memory state and are cleared
 * when a stream ends or on shutdown.
 */
export function createStreamPanelRefresher(
  client: Client,
  stream: StreamService,
  identity: Pick<IdentityRepo, 'getGuildLocale'>,
  logger: Logger,
  debounceMs = STREAM_PANEL_DEBOUNCE_MS,
): StreamPanelRefresher {
  const timers = new Map<number, ReturnType<typeof setTimeout>>();
  let stopped = false;

  const editPanel = async (guildId: string, streamId: number): Promise<void> => {
    if (stopped || !client.isReady()) return;
    const panel = stream.panel(guildId, streamId);
    if (!panel?.channelId || !panel.messageId) return;

    let view: StreamView;
    try {
      view = stream.view({ guildId, userId: '' }, streamId);
    } catch {
      return;
    }

    const channel = await fetchSendable(client, panel.channelId, guildId);
    if (!channel) return;
    const message = await channel.messages.fetch(panel.messageId).catch(() => null);
    if (!message) return;

    const guildLocale =
      identity.getGuildLocale(guildId) ?? client.guilds.cache.get(guildId)?.preferredLocale ?? null;
    const locale = resolveLocale({ user: null, client: null, guild: guildLocale });

    try {
      await message.edit(panelMessage(locale, view));
    } catch (error) {
      logger.warn({ err: error, guildId, streamId }, 'stream panel edit failed');
    }
  };

  const onChange = (change: StreamChange): void => {
    if (stopped) return;
    if (change.kind === 'started' || change.kind === 'panel') return;

    if (change.kind === 'ended') {
      const existing = timers.get(change.streamId);
      if (existing !== undefined) {
        clearTimeout(existing);
        timers.delete(change.streamId);
      }
      void editPanel(change.guildId, change.streamId);
      return;
    }

    const panel = stream.panel(change.guildId, change.streamId);
    if (!panel?.channelId || !panel.messageId) return;
    if (timers.has(change.streamId)) return;

    const timer = setTimeout(() => {
      timers.delete(change.streamId);
      void editPanel(change.guildId, change.streamId);
    }, debounceMs);
    timer.unref?.();
    timers.set(change.streamId, timer);
  };

  const off = stream.onChange(onChange);

  return {
    pendingTimers: () => timers.size,
    stop: () => {
      if (stopped) return;
      stopped = true;
      off();
      for (const timer of timers.values()) clearTimeout(timer);
      timers.clear();
    },
  };
}

/** Attach debounced stream panel edits once the Discord client is ready. Returns the stop function. */
export function startStreamPanelRefresh(
  client: Client,
  stream: StreamService,
  identity: Pick<IdentityRepo, 'getGuildLocale'>,
  logger: Logger,
  debounceMs = STREAM_PANEL_DEBOUNCE_MS,
): () => void {
  const refresher = createStreamPanelRefresher(client, stream, identity, logger, debounceMs);
  return () => refresher.stop();
}
