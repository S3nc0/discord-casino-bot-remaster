import { Avatar, Banner, List, ListItem, Tag } from '@casino/ui';
import { useLocale, useT } from '../../shell/i18n.ts';
import { useLifeApi } from './api.tsx';
import { formatDuration, monthDay, signed } from './format.ts';
import { useLoad, useNow } from './hooks.ts';
import { Await, LifeFrame } from './ui.tsx';

const MEDALS = ['🥇', '🥈', '🥉'];

export default function RankingScreen() {
  const t = useT();
  const locale = useLocale();
  const api = useLifeApi();
  const state = useLoad(() => api.ranking(), 60_000);
  const now = useNow(1000);
  return (
    <LifeFrame screen="ranking" icon="trophy">
      <Await state={state}>
        {(v) => (
          <>
            <div className="life__row">
              <h2 className="bb-eyebrow">
                {t('screen.life.ranking.title')} ·{' '}
                {t('screen.life.ranking.range', {
                  from: monthDay(v.week),
                  to: monthDay(v.weekEnd),
                })}
              </h2>
              <Tag hue="sky">
                {t('screen.life.ranking.endsIn', { time: formatDuration(t, v.endsAt - now) })}
              </Tag>
            </div>
            {v.champion ? (
              <Banner
                variant="info"
                title={t('screen.life.ranking.champion', {
                  name: v.champion.name,
                  wins: v.champion.wins,
                })}
              >
                {signed(locale, v.champion.net)}
              </Banner>
            ) : null}
            {v.self ? (
              <p className="life__note life__note--strong">
                {t('screen.life.ranking.yourRank', { rank: v.self.rank, total: v.self.total })}
                {' · '}
                {signed(locale, v.self.net)}
              </p>
            ) : (
              <p className="life__note">{t('screen.life.ranking.noRank')}</p>
            )}
            {v.rows.length === 0 ? (
              <p className="life__empty">{t('screen.life.ranking.empty')}</p>
            ) : (
              <List label={t('screen.life.ranking.title')}>
                {v.rows.map((r) => (
                  <ListItem
                    key={r.userId}
                    headline={
                      <>
                        {r.name}
                        {r.net === v.self?.net && r.rank === v.self.rank ? (
                          <span className="life__you"> · {t('screen.life.you')}</span>
                        ) : null}
                      </>
                    }
                    supportingText={
                      <>
                        {t('screen.life.ranking.plays', { n: r.plays })}
                        {r.qualified ? (
                          <>
                            {' '}
                            <Tag hue="yellow">{t('screen.life.ranking.contender')}</Tag>
                          </>
                        ) : null}
                      </>
                    }
                    leading={<Avatar>{MEDALS[r.rank - 1] ?? String(r.rank)}</Avatar>}
                    trailing={
                      <span className={r.net >= 0 ? 'life__plus' : 'life__minus'}>
                        {signed(locale, r.net)}
                      </span>
                    }
                  />
                ))}
              </List>
            )}
            <p className="life__note">{t('screen.life.ranking.footer')}</p>
            <p className="life__note">{t('screen.life.ranking.titleRule', { min: v.minPlays })}</p>
          </>
        )}
      </Await>
    </LifeFrame>
  );
}
