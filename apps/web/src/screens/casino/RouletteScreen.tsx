import { useEffect, useMemo, useState } from 'react';
import { Banner, Button, isReducedMotionActive, Tag, TextField } from '@casino/ui';
import type {
  RouletteBetAccepted,
  RouletteKindView,
  RouletteTableData,
  SpinFrameView,
} from '@casino/shared';
import { useLocale, useT } from '../../shell/i18n.ts';
import { STEP_MS } from './anim.ts';
import { BetBar } from './BetBar.tsx';
import { ErrorLine } from './ErrorLine.tsx';
import { formatNumber } from './format.ts';
import { GameFrame } from './GameFrame.tsx';
import {
  useBetAmount,
  useCall,
  useCasinoSfx,
  useCountdown,
  useOverview,
  useTable,
  useUserId,
} from './hooks.ts';
import { RecentRounds } from './RecentRounds.tsx';
import { ResultBanner } from './Result.tsx';
import { PixelDigits } from './art/PixelDigits.tsx';
import { RouletteBoard, RouletteWheel } from './RouletteWheel.tsx';
import { useCasino } from './services.tsx';

const RED = new Set([1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36]);
const colorOf = (n: number): 'red' | 'black' | 'green' =>
  n === 0 ? 'green' : RED.has(n) ? 'red' : 'black';
const OUTSIDE: readonly RouletteKindView[] = [
  'red',
  'black',
  'even',
  'odd',
  'low',
  'high',
  'dozen1',
  'dozen2',
  'dozen3',
];

interface Slip {
  id: number;
  kind: RouletteKindView;
  number?: number;
  stake: number;
}

const slipKey = (l: { kind: string; number?: number | undefined }) => `${l.kind}:${l.number ?? ''}`;

/** The pocket the ball shows now: random while it starts, then the timeline's pockets in order. */
function usePocket(
  timeline: readonly SpinFrameView[] | null | undefined,
  result: number | null,
  key: string,
) {
  const [pocket, setPocket] = useState<number | null>(result);
  const [moving, setMoving] = useState(false);
  useEffect(() => {
    if (!timeline || timeline.length === 0) {
      setPocket(result);
      setMoving(false);
      return undefined;
    }
    if (isReducedMotionActive()) {
      setPocket(result);
      setMoving(false);
      return undefined;
    }
    const started = Date.now();
    const last = timeline[timeline.length - 1]?.atMs ?? 0;
    setMoving(true);
    const id = setInterval(() => {
      const elapsed = Date.now() - started;
      if (elapsed >= last) {
        clearInterval(id);
        setPocket(result);
        setMoving(false);
        return;
      }
      const frame = [...timeline]
        .reverse()
        .find((f) => f.atMs <= elapsed && f.pocket !== undefined);
      setPocket(frame?.pocket ?? (Math.floor(elapsed / STEP_MS) * 7) % 37);
    }, STEP_MS);
    return () => clearInterval(id);
    // The timeline of one spin never changes: its round id is the key.
  }, [key, result]);
  return { pocket, moving };
}

export default function RouletteScreen() {
  const t = useT();
  const locale = useLocale();
  const { client } = useCasino();
  const sfx = useCasinoSfx();
  const me = useUserId();
  const { overview, refresh } = useOverview();
  const { snapshot, offsetMs } = useTable('roulette');
  const bet = useBetAmount('roulette', overview?.minBet);
  const { busy, errorKey, run } = useCall();
  const [slip, setSlip] = useState<Slip[]>([]);
  const [numberText, setNumberText] = useState('');
  const [nextId, setNextId] = useState(1);

  const data = (snapshot?.data ?? null) as RouletteTableData | null;
  const phase = snapshot?.phase ?? 'idle';
  const seconds = useCountdown(phase === 'betting' ? (data?.deadline ?? null) : null, offsetMs);
  const result = data?.result ?? null;
  const { pocket, moving } = usePocket(
    phase === 'spinning' || phase === 'result' ? data?.timeline : null,
    result,
    `${snapshot?.roundId ?? ''}-${phase === 'spinning' || phase === 'result' ? 'spin' : 'wait'}`,
  );
  const shown = pocket ?? result;

  const mine = useMemo(() => (data?.bets ?? []).filter((b) => b.userId === me), [data, me]);
  const myLines = mine.flatMap((b) => b.lines);
  const myStake = mine.reduce((n, b) => n + b.stake, 0);
  const players = new Set((data?.bets ?? []).map((b) => b.userId)).size;
  const myPayout = (data?.payouts ?? []).filter((p) => p.userId === me);
  const open = phase === 'idle' || phase === 'betting';
  const total = slip.reduce((n, l) => n + l.stake, 0);

  useEffect(() => {
    if (phase === 'result') {
      refresh();
      if (myPayout.length > 0) sfx.play(myPayout.some((p) => p.net > 0) ? 'smallWin' : 'lose');
    }
    if (phase === 'spinning') sfx.play('reelTick');
  }, [phase]);

  const addLine = (kind: RouletteKindView, number?: number) => {
    sfx.arm();
    sfx.play('chip');
    setSlip((prev) => {
      const key = slipKey({ kind, number });
      if (prev.some((l) => slipKey(l) === key)) return prev;
      return [
        ...prev,
        { id: nextId, kind, ...(number === undefined ? {} : { number }), stake: bet.amount },
      ];
    });
    setNextId((n) => n + 1);
  };

  const kindName = (kind: RouletteKindView, number?: number) =>
    t(`screen.casino.roulette.kind.${kind}`, { number: number ?? 0 });

  const numberValue = numberText === '' ? null : Number(numberText);
  const numberOk =
    numberValue !== null && Number.isInteger(numberValue) && numberValue >= 0 && numberValue <= 36;

  const place = () => {
    sfx.arm();
    void run(async () => {
      const out = await client.bet<RouletteBetAccepted>('roulette', {
        stake: total,
        bets: slip.map((l) => ({
          kind: l.kind,
          targets: l.kind === 'number' ? [l.number as number] : [],
          stake: l.stake,
        })),
        ...(phase === 'betting' && snapshot?.roundId ? { roundId: snapshot.roundId } : {}),
      });
      setSlip([]);
      return out;
    });
  };

  const disabled = overview?.disabled.includes('roulette') ?? false;
  const history = data?.history ?? [];

  return (
    <GameFrame screen="roulette" jackpot={overview?.jackpotPool ?? null}>
      {disabled ? <Banner variant="warning" title={t('screen.casino.disabled')} /> : null}
      {!snapshot ? (
        <p className="cc-status">{t('screen.casino.loadingTable')}</p>
      ) : (
        <>
          <div className="cc-wheel" data-phase={phase} data-moving={moving}>
            <RouletteWheel
              pocket={shown}
              moving={moving}
              highlight={phase === 'result' ? result : null}
            />
            <div
              className="cc-wheel__ball"
              data-color={shown === null ? 'none' : colorOf(shown)}
              role="img"
              aria-label={
                shown === null
                  ? t('screen.casino.working')
                  : t('screen.casino.roulette.wheel', { number: shown })
              }
            >
              <PixelDigits text={shown === null ? '-' : String(shown)} />
            </div>
          </div>
          <RouletteBoard
            chips={[
              ...myLines.map((l) => ({ kind: l.kind, number: l.number, placed: true })),
              ...(open ? slip.map((l) => ({ kind: l.kind, number: l.number, placed: false })) : []),
            ]}
          />
          <p className="cc-status" aria-live="polite">
            {phase === 'idle' ? t('screen.casino.roulette.idle') : null}
            {phase === 'betting' && seconds !== null
              ? t('screen.casino.roulette.betting', { seconds })
              : null}
            {phase === 'spinning' ? t('screen.casino.roulette.spinning') : null}
            {phase === 'result' && result !== null
              ? t('screen.casino.roulette.resultPhase', { number: result })
              : null}
            {players > 0 ? (
              <>
                {' '}
                <Tag solid>{t('screen.casino.roulette.players', { count: players })}</Tag>
              </>
            ) : null}
          </p>
          {history.length > 0 ? (
            <section className="cc-history" aria-labelledby="cc-rl-hist">
              <h2 className="bb-eyebrow" id="cc-rl-hist">
                {t('screen.casino.roulette.history')}
              </h2>
              <ul className="cc-numbers">
                {history.map((n, i) => (
                  <li key={`${i}-${n}`} data-color={colorOf(n)}>
                    <PixelDigits text={String(n)} />
                    <span className="cc-num cc-sr">{n}</span>
                    <span className="cc-sr">{t(`screen.casino.roulette.color.${colorOf(n)}`)}</span>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
          {mine.length > 0 ? (
            <section aria-labelledby="cc-rl-mine">
              <h2 className="bb-eyebrow" id="cc-rl-mine">
                {t('screen.casino.roulette.placed')}
              </h2>
              <ul className="cc-lines">
                {myLines.map((l, i) => (
                  <li key={i}>
                    <span>{kindName(l.kind, l.number)}</span> <b>{formatNumber(locale, l.stake)}</b>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
          {phase === 'result' && myPayout.length > 0 ? (
            <ResultBanner
              settlement={{
                net: myPayout.reduce((n, p) => n + p.net, 0),
                payout: myPayout.reduce((n, p) => n + p.payout, 0),
                jackpot: 0,
                tier: null,
                stake: myStake,
              }}
            />
          ) : null}
          <ErrorLine errorKey={errorKey} />
          {open && !disabled ? (
            <>
              <BetBar
                value={bet.amount}
                onChange={bet.setAmount}
                minBet={bet.minBet}
                balance={bet.balance}
                disabled={busy}
              />
              <p className="cc-note">
                {t('screen.casino.roulette.chipsPer', { amount: formatNumber(locale, bet.amount) })}
              </p>
              <div className="cc-kinds" role="group" aria-label={t('screen.casino.bet')}>
                {OUTSIDE.map((kind) => (
                  <Button
                    key={kind}
                    variant="tonal"
                    disabled={busy || !bet.valid}
                    onClick={() => addLine(kind)}
                  >
                    {kindName(kind)}
                  </Button>
                ))}
              </div>
              <div className="cc-numberpick">
                <TextField
                  label={t('screen.casino.roulette.numberField')}
                  inputMode="numeric"
                  value={numberText}
                  onChange={(e) =>
                    setNumberText(e.currentTarget.value.replace(/[^0-9]/g, '').slice(0, 2))
                  }
                  disabled={busy}
                />
                <Button
                  variant="tonal"
                  disabled={busy || !bet.valid || !numberOk}
                  onClick={() => {
                    addLine('number', numberValue as number);
                    setNumberText('');
                  }}
                >
                  {t('screen.casino.roulette.numberAdd')}
                </Button>
              </div>
              <section className="cc-slip" aria-labelledby="cc-rl-slip">
                <h2 className="bb-eyebrow" id="cc-rl-slip">
                  {t('screen.casino.roulette.slip')}
                </h2>
                {slip.length === 0 ? (
                  <p>{t('screen.casino.roulette.slip.empty')}</p>
                ) : (
                  <ul className="cc-lines">
                    {slip.map((l) => (
                      <li key={l.id}>
                        <span>{kindName(l.kind, l.number)}</span>{' '}
                        <b>{formatNumber(locale, l.stake)}</b>
                        <button
                          type="button"
                          className="cc-link"
                          onClick={() => setSlip((prev) => prev.filter((x) => x.id !== l.id))}
                          aria-label={t('screen.casino.roulette.slip.remove', {
                            name: kindName(l.kind, l.number),
                          })}
                        >
                          ✕
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
              <Button
                variant="filled"
                className="cc-cta"
                disabled={
                  busy || slip.length === 0 || (bet.balance !== null && total > bet.balance)
                }
                onClick={place}
              >
                {t('screen.casino.roulette.place')}
                {slip.length > 0
                  ? ` · ${t('screen.casino.roulette.slip.total', { amount: formatNumber(locale, total) })}`
                  : ''}
              </Button>
            </>
          ) : null}
        </>
      )}
      <RecentRounds overview={overview} game="roulette" />
    </GameFrame>
  );
}
