import { describe, expect, it } from 'vitest';
import { checkParity, en, ja, t } from './index.ts';

const REFUSALS = [
  'screen.finance.reason.margin_ratio_too_low',
  'screen.finance.reason.market_collateral_locked',
] as const;

describe('margin terms', () => {
  it('calls the account ratio 担保余裕度 / collateral headroom, never 維持率', () => {
    expect(t('ja', 'screen.finance.market.health')).toBe('担保余裕度');
    expect(t('en', 'screen.finance.market.health')).toBe('Collateral headroom');
    for (const text of Object.values(ja)) expect(text).not.toContain('維持率');
    for (const text of Object.values(en)) expect(text.toLowerCase()).not.toContain('margin health');
  });

  it('has a refusal text for both margin refusals in both languages', () => {
    for (const key of REFUSALS) {
      expect(en[key]).toBeTruthy();
      expect(ja[key]).toBeTruthy();
      expect(ja[key]).toContain('担保余裕度');
      expect(en[key].toLowerCase()).toContain('collateral headroom');
    }
    expect(checkParity({ en, ja })).toEqual([]);
  });

  it('quotes the ratio after the action and the 130% it needs', () => {
    const params = { ratio: 118, open_ratio: 130 };
    for (const key of REFUSALS) {
      expect(t('en', key, params)).toContain('118%');
      expect(t('en', key, params)).toContain('130%');
      expect(t('ja', key, params)).toContain('118%');
      expect(t('ja', key, params)).toContain('130%');
      expect(t('ja', key, params)).not.toContain('{');
    }
  });
});
