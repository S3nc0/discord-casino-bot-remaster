export type Dictionary = Readonly<Record<string, string>>;

export interface ParityProblem {
  locale: string;
  key: string;
  problem: 'missing' | 'empty' | 'placeholders';
  detail?: string;
}

const PLACEHOLDER = /\{([A-Za-z0-9_]+)\}/g;

function placeholders(text: string): string {
  return [...text.matchAll(PLACEHOLDER)]
    .map((m) => m[1])
    .sort()
    .join(',');
}

/**
 * Compare dictionaries. Every key present in any language must exist, be non-empty and use the
 * same placeholders in every language. Returns an empty list when all languages agree.
 */
export function checkParity(dictionaries: Readonly<Record<string, Dictionary>>): ParityProblem[] {
  const locales = Object.keys(dictionaries).sort();
  const keys = new Set<string>();
  for (const locale of locales) {
    for (const key of Object.keys(dictionaries[locale] ?? {})) keys.add(key);
  }
  const problems: ParityProblem[] = [];
  for (const key of [...keys].sort()) {
    const reference = locales
      .map((l) => dictionaries[l]?.[key])
      .find((v): v is string => typeof v === 'string');
    for (const locale of locales) {
      const value = dictionaries[locale]?.[key];
      if (typeof value !== 'string') {
        problems.push({ locale, key, problem: 'missing' });
      } else if (value.trim() === '') {
        problems.push({ locale, key, problem: 'empty' });
      } else if (reference !== undefined && placeholders(value) !== placeholders(reference)) {
        problems.push({
          locale,
          key,
          problem: 'placeholders',
          detail: `{${placeholders(value)}} vs {${placeholders(reference)}}`,
        });
      }
    }
  }
  return problems;
}
