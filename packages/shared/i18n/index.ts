import { en, type MessageKey, type Messages } from './en.ts';
import { ja } from './ja.ts';
import type { Locale } from './locale.ts';
import type { ErrorCode } from '../src/errors.ts';

export { en, ja };
export type { MessageKey, Messages };
export { LOCALES, DEFAULT_LOCALE, normalizeLocale, resolveLocale } from './locale.ts';
export type { Locale, LocaleSources } from './locale.ts';
export { checkParity } from './parity.ts';
export type { Dictionary, ParityProblem } from './parity.ts';

/** Compile-time guard: every ErrorCode has an `error.<code>` message. */
type ErrorMessageKey = `error.${ErrorCode}`;
const _everyErrorHasAMessage: Readonly<Record<ErrorMessageKey, string>> = en;
void _everyErrorHasAMessage;

export function errorMessageKey(code: ErrorCode): ErrorMessageKey & MessageKey {
  return `error.${code}`;
}

export const dictionaries: Readonly<Record<Locale, Messages>> = { en, ja };

export type MessageParams = Readonly<Record<string, string | number>>;

/** Look up a message and fill `{name}` placeholders. Unknown placeholders are left as is. */
export function t(locale: Locale, key: MessageKey, params?: MessageParams): string {
  const text = dictionaries[locale][key];
  if (!params) return text;
  return text.replace(/\{([A-Za-z0-9_]+)\}/g, (whole, name: string) => {
    const value = params[name];
    return value === undefined ? whole : String(value);
  });
}

const numberFormats: Readonly<Record<Locale, Intl.NumberFormat>> = {
  en: new Intl.NumberFormat('en-US'),
  ja: new Intl.NumberFormat('ja-JP'),
};

/** "12,400 Pelica" / "12,400ペリカ". */
export function formatPelica(locale: Locale, amount: number): string {
  return t(locale, 'currency.amount', { amount: numberFormats[locale].format(amount) });
}
