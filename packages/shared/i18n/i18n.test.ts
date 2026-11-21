import { describe, expect, it } from 'vitest';
import { ERROR_CODES } from '../src/errors.ts';
import { checkParity, en, errorMessageKey, formatPelica, ja, resolveLocale, t } from './index.ts';

describe('resolveLocale', () => {
  it('follows user setting → client locale → guild locale → en', () => {
    expect(resolveLocale({ user: 'ja', client: 'en-US', guild: 'en-GB' })).toBe('ja');
    expect(resolveLocale({ user: null, client: 'ja', guild: 'en-US' })).toBe('ja');
    expect(resolveLocale({ user: 'auto', client: 'fr', guild: 'ja' })).toBe('ja');
    expect(resolveLocale({ client: 'de', guild: 'ko' })).toBe('en');
    expect(resolveLocale({})).toBe('en');
  });
});

describe('messages', () => {
  it('has the seed strings', () => {
    expect(t('en', 'app.name')).toBe('Discord Casino Remaster');
    expect(t('en', 'currency.name')).toBe('Pelica');
    expect(t('ja', 'currency.name')).toBe('ペリカ');
    expect(formatPelica('en', 12400)).toBe('12,400 Pelica');
    expect(formatPelica('ja', 3000)).toBe('3,000ペリカ');
  });

  it('has a message for every error code in both languages', () => {
    for (const code of ERROR_CODES) {
      expect(t('en', errorMessageKey(code))).not.toBe('');
      expect(t('ja', errorMessageKey(code))).not.toBe('');
    }
  });

  it('en and ja are in parity', () => {
    expect(checkParity({ en, ja })).toEqual([]);
  });

  it('reports a key missing from one language', () => {
    const broken: Record<string, string> = { ...ja };
    delete broken['common.ok'];
    expect(checkParity({ en, ja: broken })).toEqual([
      { locale: 'ja', key: 'common.ok', problem: 'missing' },
    ]);
  });

  it('reports placeholder drift', () => {
    const broken = { ...ja, 'currency.amount': '{count}ペリカ' };
    expect(checkParity({ en, ja: broken })[0]?.problem).toBe('placeholders');
  });
});
