import { DOMAIN_EVENT_TYPES, type DomainEvent, type DomainEventType } from '@casino/shared';

/**
 * Domain events every member of the guild may see. This is an allowlist: a type that is not
 * listed is private to the users it names, so a new event type is never public by accident.
 */
const GUILD_PUBLIC = new Set<DomainEventType>([
  'BigWin',
  'Jackpot',
  'RaceScheduled',
  'RaceFinished',
  'MarketTick',
  'MarketMove',
  'TitleAwarded',
  'LotteryDrawn',
]);

export type Audience = { scope: 'guild' } | { scope: 'users'; userIds: string[] };

/** Who may receive `event` over the socket. */
export function audienceOf(event: DomainEvent): Audience {
  if (GUILD_PUBLIC.has(event.type)) return { scope: 'guild' };
  if (event.type === 'CompanyBankrupt') {
    return { scope: 'users', userIds: [...new Set([event.ownerId, ...event.investorIds])] };
  }
  return { scope: 'users', userIds: 'userId' in event ? [event.userId] : [] };
}

// Keep the allowlist honest: every entry must be a real event type.
for (const type of GUILD_PUBLIC) {
  if (!(DOMAIN_EVENT_TYPES as readonly string[]).includes(type)) {
    throw new Error(`unknown domain event type in the public allowlist: ${type}`);
  }
}
