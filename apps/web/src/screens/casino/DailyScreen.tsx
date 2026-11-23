import { useEffect, useRef, useState } from 'react';
import type { DailyStatus } from '@casino/shared';
import { PixelScene, SceneLayer, useSceneFrame, useSceneOnce } from '@casino/ui';
import { screenName, useLocale } from '../../shell/i18n.ts';
import { useBalanceStore } from '../../shell/stores/balance.ts';
import { DAILY_CELLS, DAILY_GIFT, DAILY_GIFT_AT, DAILY_ROOM, DAILY_STAMP } from './daily-art.ts';
import { DailyBonus, pipsFor } from './home.tsx';
import { useCasinoOptional } from './services.tsx';
import './daily.css';

/** Gift frames: still, wiggle left, wiggle right, lid up, opening, open. */
const WIGGLE = [0, 1, 0, 2, 0, 0] as const;
const OPEN = 5;

/**
 * The room above the bonus: the week's calendar stamped for each streak day, and the gift box,
 * which wiggles while the bonus is waiting and opens when it is claimed. Decorative: the streak
 * and the claim are in the card below. Reads the same status as the card and reloads it when
 * the balance changes (a claim).
 */
function Room() {
  const api = useCasinoOptional()?.api ?? null;
  const balance = useBalanceStore((s) => s.balance);
  const [status, setStatus] = useState<DailyStatus | null>(null);
  const [opens, setOpens] = useState(0);
  const was = useRef<boolean | null>(null);
  useEffect(() => {
    let alive = true;
    api
      ?.daily()
      .then((next) => {
        if (!alive) return;
        if (was.current === true && !next.claimable) setOpens((n) => n + 1);
        was.current = next.claimable;
        setStatus(next);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [api, balance]);
  const wiggle = useSceneFrame(WIGGLE.length, 180, status?.claimable === true);
  const opening = useSceneOnce({ frames: [3, 4, OPEN], ms: 160, trigger: opens, rest: OPEN });
  if (!api) return null;
  const gift = status === null ? 0 : status.claimable ? (WIGGLE[wiggle] ?? 0) : opening;
  const stamped = pipsFor(status?.streak ?? 0);
  return (
    <div className="sc-scene">
      <PixelScene art={DAILY_ROOM} scale={2}>
        {DAILY_CELLS.slice(0, stamped).map(([x, y], i) => (
          <SceneLayer key={i} art={DAILY_STAMP} x={x} y={y} />
        ))}
        <SceneLayer art={DAILY_GIFT} frame={gift} x={DAILY_GIFT_AT.x} y={DAILY_GIFT_AT.y} />
      </PixelScene>
    </div>
  );
}

/** The daily screen id: the room, then the Home bonus card on its own, under a title. */
export default function DailyScreen() {
  const locale = useLocale();
  return (
    <section className="cc-daily" data-screen="daily" aria-labelledby="daily-title">
      <h1 id="daily-title">{screenName(locale, 'daily')}</h1>
      <Room />
      <DailyBonus />
    </section>
  );
}
