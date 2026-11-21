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
};

export const InboxItem = Type.Object({
  id: Type.Integer({ minimum: 1 }),
  guildId: Snowflake,
  kind: NotificationKind,
  event: DomainEvent,
  createdAt: EpochMs,
  readAt: Type.Union([EpochMs, Type.Null()]),
});
export type InboxItem = Static<typeof InboxItem>;

export const Toast = Type.Object({
  tone: Type.Enum(['info', 'success', 'warning', 'error']),
  /** An i18n message key; the client renders it in the viewer's locale. */
  messageKey: Type.String({ maxLength: 96 }),
  params: Type.Optional(Type.Record(Type.String(), Type.Union([Type.String(), Type.Number()]))),
});
export type Toast = Static<typeof Toast>;
