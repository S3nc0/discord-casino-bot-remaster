import { Type, type Static } from 'typebox';
import { EpochMs, Snowflake } from './ids.ts';
import { DomainEvent, type DomainEventType } from './events.ts';

/** Opt-in DM kinds. The same events also land in the in-Activity inbox and as live toasts. */
export const NOTIFICATION_KINDS = [
  'race_result',
  'horse_retired',
  'loan_due',
  'bankruptcy_grace',
  'daily_ready',
  'mission_complete',
  'order_filled',
  'marketplace_outbid',
  'horse_foaled',
] as const;
export const NotificationKind = Type.Enum(NOTIFICATION_KINDS);
export type NotificationKind = (typeof NOTIFICATION_KINDS)[number];

/** Which domain event produces which notification kind. */
export const NOTIFICATION_SOURCE: Readonly<Record<NotificationKind, DomainEventType>> = {
  race_result: 'RaceFinished',
  horse_retired: 'HorseRetired',
  loan_due: 'LoanDue',
  bankruptcy_grace: 'BankruptcyGraceStarted',
  daily_ready: 'DailyReady',
  mission_complete: 'MissionCompleted',
  order_filled: 'OrderFilled',
  marketplace_outbid: 'MarketplaceOutbid',
  horse_foaled: 'HorseFoaled',
};

/**
 * Inbox-only kinds written by the system, not by a domain event. They have no DM preference
 * (there is nothing to opt into) and are never DMed.
 * - `dm_disabled`: Discord refused a DM because the user's DMs are closed (API error 50007,
 *   send-failure reason `dm_closed`), so every DM kind was switched off for that user.
 */
export const SYSTEM_INBOX_KINDS = ['dm_disabled'] as const;
export const SystemInboxKind = Type.Enum(SYSTEM_INBOX_KINDS);
export type SystemInboxKind = (typeof SYSTEM_INBOX_KINDS)[number];

/** Every kind an inbox item can have: the notification kinds plus the system kinds. */
export const INBOX_KINDS = [...NOTIFICATION_KINDS, ...SYSTEM_INBOX_KINDS] as const;
export const InboxKind = Type.Enum(INBOX_KINDS);
export type InboxKind = (typeof INBOX_KINDS)[number];

/** Payload of a `dm_disabled` inbox item. Shaped like an event so clients can read `type`. */
export const DmDisabledNotice = Type.Object({
  type: Type.Literal('DmDisabled'),
  guildId: Snowflake,
  at: EpochMs,
  userId: Snowflake,
  /** Why the DM failed: Discord's "cannot send messages to this user" (50007). */
  reason: Type.Literal('dm_closed'),
});
export type DmDisabledNotice = Static<typeof DmDisabledNotice>;

/** What an inbox item carries: the domain event behind it, or a system notice. */
export const InboxPayload = Type.Union([DomainEvent, DmDisabledNotice]);
export type InboxPayload = Static<typeof InboxPayload>;

export const InboxItem = Type.Object({
  id: Type.Integer({ minimum: 1 }),
  guildId: Snowflake,
  kind: InboxKind,
  event: InboxPayload,
  createdAt: EpochMs,
  readAt: Type.Union([EpochMs, Type.Null()]),
});
export type InboxItem = Static<typeof InboxItem>;

export const Toast = Type.Object({
  /** Toasts go to `user:{id}`; the client drops ones for a guild other than its session's. */
  guildId: Snowflake,
  tone: Type.Enum(['info', 'success', 'warning', 'error']),
  /** An i18n message key; the client renders it in the viewer's locale. */
  messageKey: Type.String({ maxLength: 96 }),
  params: Type.Optional(Type.Record(Type.String(), Type.Union([Type.String(), Type.Integer()]))),
});
export type Toast = Static<typeof Toast>;
