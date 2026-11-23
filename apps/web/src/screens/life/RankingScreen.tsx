import {
  Avatar,
  Banner,
  List,
  ListItem,
  PixelScene,
  SceneLayer,
  Tag,
  useSceneFrame,
} from '@casino/ui';
import { useLocale, useT } from '../../shell/i18n.ts';
import { useLifeApi } from './api.tsx';
import { formatDuration, monthDay, signed } from './format.ts';
import { useLoad, useNow } from './hooks.ts';
import { Await, LifeFrame } from './ui.tsx';
import { RANKING_CUP, RANKING_CUP_AT, RANKING_MEDALS, RANKING_PODIUM } from './ranking-art.ts';
import './social.css';

/** The podium under a sunburst; a glint sweeps over the trophy (still under reduced motion). */
function Podium() {
  const glint = useSceneFrame(RANKING_CUP.frames.length, 160);
  return (
    <div className="sc-scene">
      <PixelScene art={RANKING_PODIUM} scale={2}>
        <SceneLayer art={RANKING_CUP} frame={glint} x={RANKING_CUP_AT.x} y={RANKING_CUP_AT.y} />
      </PixelScene>
    </div>
  );
}

/** Gold, silver and bronze medals for places 1 to 3, the number otherwise. */
function Place({ rank }: { rank: number }) {
  if (rank >= 1 && rank <= RANKING_MEDALS.frames.length)
    return (
      <Avatar className="sc-medal">
        <PixelScene art={RANKING_MEDALS} frame={rank - 1} scale={2} label={String(rank)} />
      </Avatar>
    );
  return <Avatar>{String(rank)}</Avatar>;
}

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
            <Podium />
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
                    leading={<Place rank={r.rank} />}
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
