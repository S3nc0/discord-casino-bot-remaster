import { useCallback, useEffect, useRef, useState } from 'react';
import { Button, Card, GameIcon, Tag, type GameIconName } from '@casino/ui';
import type { CasinoGameId, CasinoOverview, DailyClaimResponse, DailyStatus } from '@casino/shared';
import { screenName, useLocale, useT } from '../../shell/i18n.ts';
import { useBalanceStore } from '../../shell/stores/balance.ts';
import { useNavStore } from '../../shell/stores/nav.ts';
import { formatNumber, splitWait } from './format.ts';
import { errorKeyOf } from './hooks.ts';
import { useCasinoOptional } from './services.tsx';
import './home.css';

const PIPS = 7;

/** Filled pips of the seven-day bar: day 1..7, then it starts over. */
export function pipsFor(streak: number): number {
  return streak <= 0 ? 0 : ((streak - 1) % PIPS) + 1;
}

/** Streak bar, the claim button and the link to the history. Nothing renders without the app. */
export function DailyBonus() {
  const services = useCasinoOptional();
  const t = useT();
  const locale = useLocale();
  const go = useNavStore((s) => s.go);
  const [status, setStatus] = useState<DailyStatus | null>(null);
  const [claimed, setClaimed] = useState<DailyClaimResponse | null>(null);
  const [busy, setBusy] = useState(false);
  const [errorKey, setErrorKey] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const alive = useRef(true);
  const api = services?.api ?? null;

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const load = useCallback(() => {
    api
      ?.daily()
      .then((next) => {
        if (alive.current) setStatus(next);
      })
      .catch((error: unknown) => {
        if (alive.current) setErrorKey(errorKeyOf(error));
      });
  }, [api]);
  useEffect(load, [load]);

  // The wait until the next slot ticks once a minute; at zero the slot is open again.
  useEffect(() => {
    if (!status || status.claimable) return undefined;
    const id = setInterval(() => {
      setNow(Date.now());
      if (Date.now() >= status.nextSlotAt) load();
    }, 30_000);
    return () => clearInterval(id);
  }, [status, load]);

  if (!api) return null;

  const claim = () => {
    setBusy(true);
    setErrorKey(null);
    api
      .claimDaily()
      .then((response) => {
        if (!alive.current) return;
        setClaimed(response);
        setStatus({ claimable: false, nextSlotAt: response.nextSlotAt, streak: response.streak });
        useBalanceStore.getState().set(response.balance);
      })
      .catch((error: unknown) => {
        if (!alive.current) return;
        setErrorKey(errorKeyOf(error));
        load();
      })
      .finally(() => {
        if (alive.current) setBusy(false);
      });
  };

  const streak = status?.streak ?? 0;
  const filled = pipsFor(streak);
  const wait = status && !status.claimable ? splitWait(status.nextSlotAt - now) : null;
  const waitText = wait
    ? wait.h > 0
      ? t('screen.casino.time.hm', { h: wait.h, m: wait.m })
      : wait.m > 0
        ? t('screen.casino.time.m', { m: wait.m })
        : t('screen.casino.time.now')
    : '';

  return (
    <section className="daily" aria-labelledby="home-daily">
      <div className="daily__head">
        <h2 className="bb-eyebrow" id="home-daily">
          {t('screen.casino.home.daily.title')}
        </h2>
        <p className="daily__streak">
          {streak > 0
            ? t('screen.casino.home.daily.streak', { days: streak })
            : t('screen.casino.home.daily.streakNone')}
        </p>
      </div>
      <ul
        className="daily__pips"
        role="img"
        aria-label={t('screen.casino.home.daily.pips', { day: filled })}
      >
        {Array.from({ length: PIPS }, (_, i) => (
          <li key={i} className="daily__pip" data-filled={i < filled} />
        ))}
      </ul>
      <div className="daily__actions">
        {status?.claimable ? (
          <Button variant="filled" onClick={claim} disabled={busy}>
            {busy ? t('screen.casino.home.daily.claiming') : t('screen.casino.home.daily.claim')}
          </Button>
        ) : (
          <p className="daily__wait" role="status">
            {claimed
              ? t('screen.casino.home.daily.claimed', {
                  amount: formatNumber(locale, claimed.amount),
                })
              : wait
                ? t('screen.casino.home.daily.wait', { time: waitText })
                : errorKey
                  ? t('screen.casino.home.daily.loadError')
                  : t('common.loading')}
          </p>
        )}
        <Button variant="outlined" onClick={() => go('history')}>
          {t('screen.casino.home.daily.history')}
        </Button>
      </div>
      {claimed && wait ? (
        <p className="daily__wait">{t('screen.casino.home.daily.wait', { time: waitText })}</p>
      ) : null}
      {errorKey && status?.claimable ? <p role="alert">{t(errorKey)}</p> : null}
    </section>
  );
}

const FEATURED: ReadonlyArray<{ game: CasinoGameId; icon: GameIconName }> = [
  { game: 'slots', icon: 'slots' },
  { game: 'chinchiro', icon: 'dice' },
  { game: 'blackjack', icon: 'cards' },
  { game: 'roulette', icon: 'roulette' },
  { game: 'pachinko', icon: 'coin' },
];

/** The featured game rotates by day; its card shows the jackpot pool and opens the game. */
export function featuredFor(nowMs: number) {
  const entry = FEATURED[Math.floor(nowMs / 86_400_000) % FEATURED.length];
  return entry ?? (FEATURED[0] as (typeof FEATURED)[number]);
}

export function FeaturedGame() {
  const services = useCasinoOptional();
  const t = useT();
  const locale = useLocale();
  const go = useNavStore((s) => s.go);
  const [overview, setOverview] = useState<CasinoOverview | null>(null);
  const api = services?.api ?? null;
  useEffect(() => {
    let alive = true;
    api
      ?.overview()
      .then((next) => {
        if (alive) setOverview(next);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [api]);
  if (!api) return null;

  const { game, icon } = featuredFor(Date.now());
  const off = overview?.disabled.includes(game) ?? false;
  return (
    <section className="featured" aria-labelledby="home-featured">
      <h2 className="bb-eyebrow" id="home-featured">
        {t('screen.casino.home.featured')}
      </h2>
      <Card
        variant="outlined"
        title={screenName(locale, game)}
        actions={
          <Button variant="filled" onClick={() => go(game)} disabled={off}>
            {t('screen.casino.home.featured.play')}
          </Button>
        }
      >
        <div className="featured__body">
          <GameIcon name={icon} />
          <p>{t(`screen.casino.home.blurb.${game}`)}</p>
        </div>
        {overview ? (
          <Tag hue="yellow" className="featured__jackpot">
            {t('screen.casino.home.featured.jackpot', {
              amount: formatNumber(locale, overview.jackpotPool),
            })}
          </Tag>
        ) : null}
      </Card>
    </section>
  );
}
