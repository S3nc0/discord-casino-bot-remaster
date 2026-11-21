import {
  EmbedBuilder,
  MessageFlags,
  type ButtonInteraction,
  type ChatInputCommandInteraction,
  type InteractionReplyOptions,
  type InteractionUpdateOptions,
  type ModalSubmitInteraction,
  type StringSelectMenuInteraction,
} from 'discord.js';
import type { ScreenId } from '@casino/shared';
import { dictionaries, formatPelica, t, type Locale, type MessageKey } from '@casino/shared/i18n';
import type { ServiceResult } from '../finance/teiai-service.ts';
import { GameRuleError } from '../games/progression/context.ts';
import { buildLaunchActivityRow } from '../notify/discord-port.ts';
import { botColor, type EmbedRole } from '../notify/theme.ts';
import { AppError } from '../runtime/errors.ts';
import type { BotRouterDeps } from './router.ts';

/** Everything the chat handlers share: the router's dependencies and the caller's language. */
export interface ChatCtx {
  deps: BotRouterDeps;
  locale: Locale;
}

export type ComponentInteraction = ButtonInteraction | StringSelectMenuInteraction;
export type ReplyTarget =
  ChatInputCommandInteraction | ComponentInteraction | ModalSubmitInteraction;

/** Custom ids of every component the chat commands post: `b:<namespace>:<action>[:<arg>...]`. */
export const CID_PREFIX = 'b';
export const CID_MAX_LENGTH = 100;

export function cid(namespace: string, action: string, ...args: (string | number)[]): string {
  const id = [CID_PREFIX, namespace, action, ...args].join(':');
  if (id.length > CID_MAX_LENGTH) throw new Error(`custom id too long: ${id}`);
  return id;
}

export interface ParsedCid {
  namespace: string;
  action: string;
  args: string[];
}

export function parseCid(customId: string): ParsedCid | null {
  const parts = customId.split(':');
  if (parts[0] !== CID_PREFIX || parts.length < 3) return null;
  return { namespace: parts[1] as string, action: parts[2] as string, args: parts.slice(3) };
}

/** Idempotency keys: one per Discord interaction, so a redelivered interaction never pays twice. */
export function idemKeyOf(interaction: { id: string }, scope = 'cmd'): string {
  return `${scope}:${interaction.id}`;
}

export function requireGuild(interaction: { guildId: string | null }): string {
  if (!interaction.guildId) throw new AppError('forbidden', { reason: 'guild_only' });
  return interaction.guildId;
}

export function isOwner(deps: Pick<BotRouterDeps, 'ownerIds'>, userId: string): boolean {
  return deps.ownerIds.has(userId);
}

export function embed(role: EmbedRole, title?: string, description?: string): EmbedBuilder {
  const e = new EmbedBuilder().setColor(botColor(role));
  if (title !== undefined) e.setTitle(title);
  if (description !== undefined) e.setDescription(description);
  return e;
}

export function activityRow(locale: Locale, screen: ScreenId) {
  return buildLaunchActivityRow(locale, screen);
}

/** Reply once, then follow up. Component interactions are answered with a fresh message. */
export async function reply(
  interaction: ReplyTarget,
  options: InteractionReplyOptions,
): Promise<void> {
  if (interaction.replied || interaction.deferred) {
    await interaction.followUp(options);
    return;
  }
  await interaction.reply(options);
}

export const EPHEMERAL = MessageFlags.Ephemeral;

/**
 * Answer a button or select menu by rewriting the message it sits on. Falls back to a plain reply
 * when the interaction has already been answered.
 */
export async function updateMessage(
  interaction: ComponentInteraction,
  options: InteractionUpdateOptions,
): Promise<void> {
  if (interaction.replied || interaction.deferred) {
    await interaction.editReply(options);
    return;
  }
  await interaction.update(options);
}

/** Map a finance `ServiceResult` failure onto the shared error codes. */
export function unwrapService<T>(res: ServiceResult<T>): T {
  if (res.ok) return res.data;
  const reason = res.reason;
  if (reason === 'insufficient_funds') throw new AppError('insufficient_funds');
  if (
    reason.includes('debtor_blocked') ||
    reason.includes('katagi_only') ||
    reason.includes('forbidden') ||
    reason.includes('not_buyer') ||
    reason.includes('not_borrower')
  ) {
    throw new AppError('forbidden', { reason });
  }
  if (reason.includes('not_found') || reason === 'no_debt') {
    throw new AppError('not_found', { reason });
  }
  if (reason.includes('expired')) throw new AppError('expired', { reason });
  if (
    reason.includes('invalid') ||
    reason.includes('min_') ||
    reason.includes('too_small') ||
    reason.includes('too_low') ||
    reason.includes('out_of_range') ||
    reason.includes('self_')
  ) {
    throw new AppError('invalid_payload', { reason });
  }
  throw new AppError('conflict', { reason });
}

/** Game-rule failures (`GameRuleError`) already carry a shared error code. */
export function isGameRuleError(error: unknown): error is GameRuleError {
  return error instanceof GameRuleError;
}

export function formatNumber(locale: Locale, value: number): string {
  return value.toLocaleString(locale === 'ja' ? 'ja-JP' : 'en-US');
}

export function signedPelica(locale: Locale, amount: number): string {
  return `${amount > 0 ? '+' : ''}${formatPelica(locale, amount)}`;
}

export function tr(
  ctx: ChatCtx,
  key: MessageKey,
  params?: Record<string, string | number>,
): string {
  return t(ctx.locale, key, params);
}

/** Time a player has before an unattended interactive message stops being honoured. */
export const COMPONENT_TTL_MS = 15 * 60_000;

/** A game rule's own message (`bot.rule.<rule>`), when the dictionary has one. */
export function ruleMessage(locale: Locale, error: unknown): string | null {
  if (!(error instanceof GameRuleError)) return null;
  const key = `bot.rule.${error.rule}`;
  if (!Object.hasOwn(dictionaries[locale], key)) return null;
  return t(locale, key as MessageKey, error.params);
}
