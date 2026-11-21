import { describe, expect, it } from 'vitest';
import { SCREEN_IDS } from '@casino/shared';
import { checkParity } from '@casino/shared/i18n';
import { pickLocale, translate } from './i18n.ts';
import { enShell, jaShell } from './messages.ts';

describe('locale fallback order', () => {
  it('prefers the settings choice over everything', () => {
    expect(pickLocale({ language: 'ja', sdkLocale: 'en-US', guildLocale: 'en' })).toBe('ja');
    expect(pickLocale({ language: 'en', sdkLocale: 'ja', guildLocale: 'ja' })).toBe('en');
  });

  it('uses the SDK user locale when the setting is auto', () => {
    expect(pickLocale({ language: 'auto', sdkLocale: 'ja', guildLocale: 'en' })).toBe('ja');
    expect(pickLocale({ language: 'auto', sdkLocale: 'en-GB', guildLocale: 'ja' })).toBe('en');
  });

  it('falls to the guild locale when the SDK locale is missing or unsupported', () => {
    expect(pickLocale({ language: 'auto', sdkLocale: null, guildLocale: 'ja' })).toBe('ja');
    expect(pickLocale({ language: 'auto', sdkLocale: 'fr', guildLocale: 'ja' })).toBe('ja');
    expect(pickLocale({ language: 'auto', sdkLocale: '', guildLocale: 'ja' })).toBe('ja');
  });

  it('ends at en', () => {
    expect(pickLocale({ language: 'auto', sdkLocale: 'de', guildLocale: 'fr' })).toBe('en');
    expect(pickLocale({ language: undefined, sdkLocale: undefined, guildLocale: undefined })).toBe(
      'en',
    );
  });
});

describe('translate', () => {
  it('reads shell and shared keys and fills placeholders', () => {
    expect(translate('ja', 'screen.blackjack')).toBe('ブラックジャック');
    expect(translate('en', 'presence.playing', { screen: 'Slots' })).toBe('Playing Slots');
    expect(translate('ja', 'error.rate_limited')).not.toBe('error.rate_limited');
  });

  it('shows an unknown key as is', () => {
    expect(translate('en', 'toast.from.the.future')).toBe('toast.from.the.future');
  });
});

describe('shell dictionaries', () => {
  it('have the same keys and placeholders in en and ja, and a name for every screen', () => {
    expect(checkParity({ en: enShell, ja: jaShell })).toEqual([]);
    for (const id of SCREEN_IDS) expect(enShell[`screen.${id}`]).toBeTruthy();
  });
});
