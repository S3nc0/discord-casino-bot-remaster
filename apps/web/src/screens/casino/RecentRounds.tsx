import { useMemo } from 'react';
import { List, ListItem, Tag } from '@casino/ui';
import type { CasinoOverview, GameId } from '@casino/shared';
import { screenName, useLocale, useT } from '../../shell/i18n.ts';
import { formatNumber, formatSigned } from './format.ts';

export interface JackpotProps {
  pool: number | null;
}

/** The guild's jackpot pool as a small tag. */
export function Jackpot({ pool }: JackpotProps) {
  const t = useT();
  const locale = useLocale();
  if (pool === null) return null;
  return (
    <Tag hue="yellow" className="cc-jackpot">
      {t('screen.casino.jackpotPool', { amount: formatNumber(locale, pool) })}
    </Tag>
  );
}

export interface RecentRoundsProps {
  overview: CasinoOverview | null;
  /** Only rounds of these games (a screen shows its own game). */
  game?: GameId;
  limit?: number;
}

export function RecentRounds({ overview, game, limit = 5 }: RecentRoundsProps) {
  const t = useT();
  const locale = useLocale();
  const rows = useMemo(
    () =>
      (overview?.recent ?? []).filter((r) => game === undefined || r.game === game).slice(0, limit),
    [overview, game, limit],
  );
  return (
    <section className="cc-recent" aria-labelledby="cc-recent-title">
      <h2 className="bb-eyebrow" id="cc-recent-title">
        {t('screen.casino.last')}
      </h2>
      {rows.length === 0 ? (
        <p className="cc-recent__empty">{t('screen.casino.last.empty')}</p>
      ) : (
        <List label={t('screen.casino.last')}>
          {rows.map((round) => (
            <ListItem
              key={round.roundId}
              headline={screenName(locale, round.game)}
              supportingText={t('screen.casino.stake', {
                amount: formatNumber(locale, round.stake),
              })}
              trailing={
                <Tag hue={round.net > 0 ? 'green' : round.net < 0 ? 'red' : 'neutral'} solid>
                  {formatSigned(locale, round.net)}
                </Tag>
              }
            />
          ))}
        </List>
      )}
    </section>
  );
}
