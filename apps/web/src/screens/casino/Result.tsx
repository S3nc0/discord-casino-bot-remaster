import { Banner, Tag } from '@casino/ui';
import type { SettlementView } from '@casino/shared';
import { useLocale, useT } from '../../shell/i18n.ts';
import { formatNumber } from './format.ts';

export interface ResultBannerProps {
  settlement: Pick<SettlementView, 'net' | 'payout' | 'jackpot' | 'tier' | 'stake'>;
  /** Extra line under the headline (the hand, the label of the reels). */
  detail?: string;
}

/** Won, lost or even, with the payout, a jackpot and a big-win tag. Always words, not colour alone. */
export function ResultBanner({ settlement, detail }: ResultBannerProps) {
  const t = useT();
  const locale = useLocale();
  const { net, payout, jackpot, tier } = settlement;
  const variant = net > 0 ? 'success' : net < 0 ? 'error' : 'info';
  const title =
    net > 0
      ? t('screen.casino.won', { amount: formatNumber(locale, net) })
      : net < 0
        ? t('screen.casino.lost', { amount: formatNumber(locale, -net) })
        : t('screen.casino.even');
  return (
    <Banner variant={variant} title={title} role="status" className="cc-result" data-net={net}>
      <p className="cc-result__line">
        {detail ? <span>{detail}</span> : null}
        {payout > 0 ? (
          <span>{t('screen.casino.payout', { amount: formatNumber(locale, payout) })}</span>
        ) : null}
      </p>
      <p className="cc-result__tags">
        {jackpot > 0 ? (
          <Tag hue="yellow" solid>
            {t('screen.casino.jackpotHit', { amount: formatNumber(locale, jackpot) })}
          </Tag>
        ) : null}
        {tier === 'big' || tier === 'super' || tier === 'jackpot' ? (
          <Tag hue="green" solid>
            {t('screen.casino.bigWin')}
          </Tag>
        ) : null}
      </p>
    </Banner>
  );
}
