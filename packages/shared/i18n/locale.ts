export const LOCALES = ['en', 'ja'] as const;
export type Locale = (typeof LOCALES)[number];
export const DEFAULT_LOCALE: Locale = 'en';

/**
 * Map a Discord locale code (`en-US`, `en-GB`, `ja`, ...) or a stored setting to a supported
 * locale. Returns null for anything we do not ship, so the resolver falls through.
 */
export function normalizeLocale(input: string | null | undefined): Locale | null {
  if (!input) return null;
  const tag = input.trim().toLowerCase();
  for (const locale of LOCALES) {
    if (tag === locale || tag.startsWith(`${locale}-`) || tag.startsWith(`${locale}_`)) {
      return locale;
    }
  }
  return null;
}

export interface LocaleSources {
  /** The user's explicit choice in settings. null or 'auto' means "not chosen". */
  user?: string | null | undefined;
  /** Discord client locale: `interaction.locale` in the bot, the SDK user locale in the Activity. */
  client?: string | null | undefined;
  /** The guild's preferred locale (`guild.preferredLocale` or the per-guild config). */
  guild?: string | null | undefined;
}

/** Detection order: user setting → Discord client locale → guild preferred locale → en. */
export function resolveLocale(sources: LocaleSources): Locale {
  return (
    normalizeLocale(sources.user) ??
    normalizeLocale(sources.client) ??
    normalizeLocale(sources.guild) ??
    DEFAULT_LOCALE
  );
}
