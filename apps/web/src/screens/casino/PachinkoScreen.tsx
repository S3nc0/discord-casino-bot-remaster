import { useEffect, useState } from 'react';
import { Banner, Button, IconButton, Tag } from '@casino/ui';
import { PACHINKO_BALLS_PER_SET, PACHINKO_MAX_SETS, type PachinkoResultView } from '@casino/shared';
import { useLocale, useT } from '../../shell/i18n.ts';
import { useReveal } from './anim.ts';
import { BetBar } from './BetBar.tsx';
import { ErrorLine } from './ErrorLine.tsx';
import { formatNumber } from './format.ts';
import { GameFrame } from './GameFrame.tsx';
import { useBetAmount, useCall, useCasinoSfx, useOverview } from './hooks.ts';
import { RecentRounds } from './RecentRounds.tsx';
import { ResultBanner } from './Result.tsx';
import { useCasino } from './services.tsx';

/** One reveal step: the launch, then one set at a time. */
const STEP_MS = 800;

const roundName = (mult: number) => (mult >= 30 ? 'kakuhen' : mult >= 10 ? 'big' : 'small');

/** Balls falling through the pegs: pixel dots that hop down in steps. */
function Board({ falling }: { falling: boolean }) {
  return (
    <div className="cc-board" data-falling={falling} aria-hidden="true">
      {[0, 1, 2, 3, 4, 5, 6].map((i) => (
        <span key={i} className="cc-ball" style={{ ['--i' as string]: i }} />
      ))}
    </div>
  );
}

function flavorKey(top: number): string {
  if (top >= 30) return 'kakuhen';
  if (top >= 10) return 'big';
  if (top > 0) return 'small';
  return 'miss';
}

export default function PachinkoScreen() {
  const t = useT();
  const locale = useLocale();
  const { client } = useCasino();
  const sfx = useCasinoSfx();
  const { overview, refresh } = useOverview();
  const bet = useBetAmount('pachinko', overview?.minBet);
  const { busy, errorKey, run } = useCall();
  const [sets, setSets] = useState(1);
  const [result, setResult] = useState<PachinkoResultView | null>(null);
  const total = result ? result.sets.length + 1 : null;
  const step = useReveal(total, STEP_MS, result?.roundId ?? 'idle');
  const done = result !== null && step >= (total ?? 0);
  const launching = result !== null && step === 0;

  const stake = bet.amount * sets;
  const balance = bet.balance;
  const affordable = balance === null || stake <= balance;

  const shoot = () => {
    sfx.arm();
    void run(async () => {
      const out = await client.bet<PachinkoResultView>('pachinko', {
        stake: bet.amount,
        args: { sets },
      });
      setResult(out.result);
      sfx.play('chip');
      return out;
    });
  };

  const settledId = done ? (result?.roundId ?? null) : null;
  const net = result?.settlement.net ?? 0;
  const { play } = sfx;
  useEffect(() => {
    if (settledId === null) return;
    play(net > 0 ? 'bigWin' : 'lose');
    refresh();
  }, [settledId, net, play, refresh]);

  const disabled = overview?.disabled.includes('pachinko') ?? false;
  const shown = result ? result.sets.slice(0, Math.max(0, step - 1)) : [];
  const starts = shown.reduce((n, s) => n + s.starts, 0);

  return (
    <GameFrame screen="pachinko" jackpot={overview?.jackpotPool ?? null}>
      {disabled ? <Banner variant="warning" title={t('screen.casino.disabled')} /> : null}
      <p className="cc-intro">{t('screen.casino.pachinko.intro')}</p>
      <Board falling={launching || busy} />
      {launching ? (
        <p className="cc-status" aria-live="polite">
          {t('screen.casino.pachinko.launching')}
        </p>
      ) : null}
      {shown.length > 0 ? (
        <ul className="cc-sets" aria-label={t('screen.casino.pachinko.sets')}>
          {shown.map((set, i) => {
            const hits = set.spins.filter((s) => s.hit);
            return (
              <li key={i} className="cc-set" data-hit={hits.length > 0}>
                <h3 className="cc-set__title">
                  {t('screen.casino.pachinko.set', { n: i + 1 })}
                  <Tag solid>{t('screen.casino.pachinko.spins', { count: set.starts })}</Tag>
                </h3>
                <p>
                  {set.starts === 0
                    ? t('screen.casino.pachinko.starts.none')
                    : t('screen.casino.pachinko.starts', { starts: set.starts })}
                </p>
                {hits.length === 0 && set.starts > 0 ? (
                  <p>{t('screen.casino.pachinko.allMiss', { starts: set.starts })}</p>
                ) : null}
                {hits.map((spin, j) => (
                  <p key={j} className="cc-chain">
                    <b>
                      {t('screen.casino.pachinko.chain', {
                        n: spin.rounds.length,
                        raw: spin.rounds.reduce((a, b) => a + b, 0),
                      })}
                    </b>{' '}
                    {spin.rounds.map((m, k) => (
                      <Tag key={k} hue={m >= 30 ? 'red' : m >= 10 ? 'orange' : 'neutral'} solid>
                        {t(`screen.casino.pachinko.round.${roundName(m)}`)} ×{m}
                      </Tag>
                    ))}
                  </p>
                ))}
              </li>
            );
          })}
        </ul>
      ) : null}
      {done && result ? (
        <>
          <p className="cc-status">
            {t('screen.casino.pachinko.starts', { starts })} ·{' '}
            {t(`screen.casino.pachinko.flavor.${flavorKey(result.topRound)}`)}
          </p>
          <ResultBanner
            settlement={result.settlement}
            detail={
              result.topRound > 0
                ? t('screen.casino.pachinko.top', { mult: result.topRound })
                : undefined
            }
          />
        </>
      ) : null}
      <ErrorLine errorKey={errorKey} />
      <BetBar
        value={bet.amount}
        onChange={bet.setAmount}
        minBet={bet.minBet}
        balance={null}
        disabled={busy || (result !== null && !done)}
        label={t('screen.casino.betAmount')}
      />
      <div className="cc-sets-pick" role="group" aria-label={t('screen.casino.pachinko.sets')}>
        <IconButton
          label={t('screen.casino.pachinko.setsLess')}
          variant="tonal"
          disabled={busy || sets <= 1}
          onClick={() => setSets((n) => Math.max(1, n - 1))}
        >
          −
        </IconButton>
        <span className="cc-sets-pick__value" aria-live="polite">
          {t('screen.casino.pachinko.sets')}: <b>{sets}</b> (
          {formatNumber(locale, sets * PACHINKO_BALLS_PER_SET)})
        </span>
        <IconButton
          label={t('screen.casino.pachinko.setsMore')}
          variant="tonal"
          disabled={busy || sets >= PACHINKO_MAX_SETS}
          onClick={() => setSets((n) => Math.min(PACHINKO_MAX_SETS, n + 1))}
        >
          +
        </IconButton>
      </div>
      <p className="cc-note">
        {t('screen.casino.pachinko.total', { amount: formatNumber(locale, stake) })}
      </p>
      <Button
        variant="filled"
        className="cc-cta"
        onClick={shoot}
        disabled={
          busy || disabled || (result !== null && !done) || bet.amount < bet.minBet || !affordable
        }
      >
        {t('screen.casino.pachinko.shoot')}
      </Button>
      <RecentRounds overview={overview} game="pachinko" />
    </GameFrame>
  );
}
