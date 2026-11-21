import { normalizeLocale, resolveLocale, type Locale } from '@casino/shared/i18n';
import type { IdentityRepo } from '../db/identity.ts';

export interface BotLocaleInput {
  identity: Pick<IdentityRepo, 'getUserLocale' | 'getGuildLocale'>;
  userId: string;
  guildId: string | null;
  interactionLocale: string | null | undefined;
  guildPreferredLocale: string | null | undefined;
  /** Optional explicit user language override (used right after `/settings` saves). */
  userLocaleOverride?: string | null | undefined;
}

/**
 * Resolve the reply locale for a Discord interaction:
 * user setting → interaction.locale → guild locale (DB override, then Discord preferredLocale) → en.
 */
export function resolveBotLocale(input: BotLocaleInput): Locale {
  const userLocale =
    input.userLocaleOverride !== undefined
      ? input.userLocaleOverride
      : input.identity.getUserLocale(input.userId);
  const dbGuildLocale = input.guildId ? input.identity.getGuildLocale(input.guildId) : null;
  const guildLocale = normalizeLocale(dbGuildLocale) ?? input.guildPreferredLocale;

  return resolveLocale({
    user: userLocale,
    client: input.interactionLocale,
    guild: guildLocale,
  });
}
