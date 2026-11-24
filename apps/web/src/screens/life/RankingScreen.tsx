import { useState } from 'react';
import {
  Avatar,
  Banner,
  Button,
  Dialog,
  List,
  ListItem,
  PixelScene,
  SceneLayer,
  Tabs,
  Tag,
  useSceneFrame,
} from '@casino/ui';
import {
  BALANCE_SHEET_PART_KEYS,
  type BalanceSheetGroups,
  type BalanceSheetPartKey,
  type BalanceSheetParts,
  type FinanceDebtStatus,
} from '@casino/shared';
import { formatPelica, useLocale, useT, type Translate } from '../../shell/i18n.ts';
import { useLifeApi } from './api.tsx';
import { formatDuration, monthDay, signed } from './format.ts';
import { useLoad, useNow } from './hooks.ts';
import { Await, LifeFrame } from './ui.tsx';
import { RANKING_CUP, RANKING_CUP_AT, RANKING_MEDALS, RANKING_PODIUM } from './ranking-art.ts';
import './social.css';

type RankingTab = 'weekly' | 'net' | 'liquid';
type NetWorthTab = Exclude<RankingTab, 'weekly'>;

/** Ranking-row status emoji (`docs/teiai.md`: 🟡 / 🟤 / 🔴 next to names; Clean has none). */
const STATUS_EMOJI: Record<FinanceDebtStatus, string> = {
  katagi: '',
  wealthy: '🟡',
  underground: '🟤',
  bankrupt: '🔴',
};

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

/** `(current 12,345 · fixed 6,789 · liabilities 1,000)`; zero groups are left out. */
export function subtotalText(t: Translate, locale: string, g: BalanceSheetGroups): string {
  const n = (v: number) => new Intl.NumberFormat(locale).format(v);
  const bits: string[] = [];
  if (g.liquid !== 0) bits.push(t('bs.sub.liquid', { n: n(g.liquid) }));
  if (g.fixed !== 0) bits.push(t('bs.sub.fixed', { n: n(g.fixed) }));
  if (g.liabilities !== 0) bits.push(t('bs.sub.liabilities', { n: n(g.liabilities) }));
  return bits.length === 0 ? '' : t('bs.sub.wrap', { parts: bits.join(t('bs.sub.sep')) });
}

const LIQUID = BALANCE_SHEET_PART_KEYS.slice(0, 8);
const FIXED = BALANCE_SHEET_PART_KEYS.slice(8, 13);
const LIABILITIES = BALANCE_SHEET_PART_KEYS.slice(13);

/** The caller's balance sheet: current assets, fixed assets, total, liabilities, net assets. */
function SheetBody({ parts, groups }: { parts: BalanceSheetParts; groups: BalanceSheetGroups }) {
  const t = useT();
  const locale = useLocale();
  const money = (n: number) => formatPelica(locale, n);
  const section = (title: string, keys: readonly BalanceSheetPartKey[], sign: 1 | -1) => {
    const shown = keys.filter((k) => parts[k] !== 0);
    return (
      <>
        <h3 className="bb-eyebrow">{title}</h3>
        {shown.length === 0 ? (
          <p className="life__note">{t('bs.none')}</p>
        ) : (
          <List label={title}>
            {shown.map((k) => (
              <ListItem
                key={k}
                headline={t(`bs.part.${k}`)}
                trailing={<span className="num">{money(sign * parts[k])}</span>}
              />
            ))}
          </List>
        )}
      </>
    );
  };
  return (
    <div className="life__sheet">
      {section(`💧 ${t('bs.group.liquid')}`, LIQUID, 1)}
      {section(`🏛️ ${t('bs.group.fixed')}`, FIXED, 1)}
      <p className="life__note life__note--strong">
        {t('bs.group.gross')}: {money(groups.gross)}
      </p>
      {section(`📉 ${t('bs.group.liabilities')}`, LIABILITIES, -1)}
      <p className="life__note life__note--strong">
        🧾 {t('bs.group.net')}: {money(groups.net)}
      </p>
      <p className="life__note">{t('bs.footer.breakdown')}</p>
    </div>
  );
}

function NetWorthRanking({ view }: { view: NetWorthTab }) {
  const t = useT();
  const locale = useLocale();
  const api = useLifeApi();
  const state = useLoad(() => api.netWorth(view), 60_000, view);
  const [sheetOpen, setSheetOpen] = useState(false);
  return (
    <Await state={state}>
      {(v) => (
        <>
          <h2 className="bb-eyebrow">{t(`screen.life.ranking.nw.title.${view}`)}</h2>
          {v.self ? (
            <div className="life__row">
              <p className="life__note life__note--strong">
                {t('screen.life.ranking.yourRank', { rank: v.self.rank, total: v.total })}
                {' · '}
                {formatPelica(locale, v.self.value)}
              </p>
              <Button variant="tonal" onClick={() => setSheetOpen(true)}>
                {t('screen.life.ranking.nw.mine')}
              </Button>
            </div>
          ) : (
            <p className="life__note">{t('screen.life.ranking.nw.noRank')}</p>
          )}
          {v.rows.length === 0 ? (
            <p className="life__empty">{t('screen.life.ranking.nw.empty')}</p>
          ) : (
            <List label={t(`screen.life.ranking.nw.title.${view}`)}>
              {v.rows.map((r) => (
                <ListItem
                  key={r.userId}
                  headline={
                    <>
                      {r.name}
                      {r.status && STATUS_EMOJI[r.status] ? ` ${STATUS_EMOJI[r.status]}` : null}
                      {r.rank === v.self?.rank ? (
                        <span className="life__you"> · {t('screen.life.you')}</span>
                      ) : null}
                    </>
                  }
                  supportingText={subtotalText(t, locale, r.groups)}
                  leading={<Place rank={r.rank} />}
                  trailing={<span className="num">{formatPelica(locale, r.value)}</span>}
                />
              ))}
            </List>
          )}
          <p className="life__note">{t(`bs.footer.${view}`)}</p>
          {v.self ? (
            <Dialog
              open={sheetOpen}
              onClose={() => setSheetOpen(false)}
              title={t('screen.life.ranking.nw.sheetTitle')}
              actions={<Button onClick={() => setSheetOpen(false)}>{t('common.ok')}</Button>}
            >
              <SheetBody parts={v.self.parts} groups={v.self.groups} />
            </Dialog>
          ) : null}
        </>
      )}
    </Await>
  );
}

function WeeklyRanking() {
  const t = useT();
  const locale = useLocale();
  const api = useLifeApi();
  const state = useLoad(() => api.ranking(), 60_000);
  const now = useNow(1000);
  return (
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
                      {r.status && STATUS_EMOJI[r.status] ? ` ${STATUS_EMOJI[r.status]}` : null}
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
  );
}

/** Weekly game standings (the default), then the balance-sheet rankings by net and current assets. */
export default function RankingScreen() {
  const t = useT();
  const [tab, setTab] = useState<RankingTab>('weekly');
  return (
    <LifeFrame screen="ranking" icon="trophy">
      <Podium />
      <Tabs
        label={t('screen.ranking')}
        activeId={tab}
        onChange={(id) => setTab(id as RankingTab)}
        tabs={[
          {
            id: 'weekly',
            label: t('screen.life.ranking.tab.weekly'),
            panel: <WeeklyRanking />,
          },
          {
            id: 'net',
            label: t('screen.life.ranking.tab.net'),
            panel: <NetWorthRanking view="net" />,
          },
          {
            id: 'liquid',
            label: t('screen.life.ranking.tab.liquid'),
            panel: <NetWorthRanking view="liquid" />,
          },
        ]}
      />
    </LifeFrame>
  );
}
