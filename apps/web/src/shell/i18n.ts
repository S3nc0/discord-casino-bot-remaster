import { useCallback } from 'react';
import type { ScreenId } from '@casino/shared';
import {
  dictionaries,
  formatPelica,
  resolveLocale,
  screenMessageKey,
  type Locale,
  type MessageParams,
} from '@casino/shared/i18n';
import { useSessionStore } from './stores/session.ts';
import { useSettingsStore } from './stores/settings.ts';

export interface LocaleInputs {
  /** Settings choice: 'auto' (or anything unknown) means "not chosen". */
  language: string | null | undefined;
  /** Discord client locale from the SDK. */
  sdkLocale: string | null | undefined;
  /** The guild's preferred locale. */
  guildLocale: string | null | undefined;
}

/** settings → SDK user locale → guild locale → en (same order as the bot). */
export function pickLocale({ language, sdkLocale, guildLocale }: LocaleInputs): Locale {
  return resolveLocale({
    user: language === 'auto' ? null : language,
    client: sdkLocale,
    guild: guildLocale,
  });
}

const hasKey = (dict: object, key: string) => Object.prototype.hasOwnProperty.call(dict, key);

/**
 * Translate with the shared dictionaries. Keys the build does not know (for example a toast
 * key from a newer server) are shown as is instead of throwing.
 */
export function translate(locale: Locale, key: string, params?: MessageParams): string {
  const dict: Record<string, string> = dictionaries[locale];
  if (!hasKey(dict, key)) return key;
  const text = dict[key] as string;
  if (!params) return text;
  return text.replace(/\{([A-Za-z0-9_]+)\}/g, (whole, name: string) => {
    const value = params[name];
    return value === undefined ? whole : String(value);
  });
}

export function screenName(locale: Locale, screen: ScreenId): string {
  return translate(locale, screenMessageKey(screen));
}

export { formatPelica };

/** The active locale; components re-render when the setting, SDK locale or guild locale changes. */
export function useLocale(): Locale {
  const language = useSettingsStore((s) => s.language);
  const sdkLocale = useSessionStore((s) => s.sdkLocale);
  const guildLocale = useSessionStore((s) => s.guildLocale);
  return pickLocale({ language, sdkLocale, guildLocale });
}

export type Translate = (key: string, params?: MessageParams) => string;

export function useT(): Translate {
  const locale = useLocale();
  return useCallback((key, params) => translate(locale, key, params), [locale]);
}

export function currentLocale(): Locale {
  const { language } = useSettingsStore.getState();
  const { sdkLocale, guildLocale } = useSessionStore.getState();
  return pickLocale({ language, sdkLocale, guildLocale });
}
