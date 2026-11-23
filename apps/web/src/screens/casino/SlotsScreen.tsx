import { useEffect, useState } from 'react';
import { Banner, Button } from '@casino/ui';
import type { SlotsResultView } from '@casino/shared';
import { useT } from '../../shell/i18n.ts';
import { useReveal } from './anim.ts';
import { PixelScene, Pixels } from './art/PixelArt.tsx';
import { SYMBOL_ART } from './art/slots-art.ts';
import { BetBar } from './BetBar.tsx';
import { ErrorLine } from './ErrorLine.tsx';
import { GameFrame } from './GameFrame.tsx';
import { useBetAmount, useCall, useCasinoSfx, useOverview } from './hooks.ts';
import { RecentRounds } from './RecentRounds.tsx';
import { ResultBanner } from './Result.tsx';
import { useCasino } from './services.tsx';
import { SlotMachine } from './SlotMachine.tsx';

/** Milliseconds between one reel stopping and the next. */
const REEL_GAP_MS = 600;

/** Reels that pay: all three in a triple, otherwise the cherries. */
function winningReels(result: SlotsResultView): number[] {
  if (result.multiplier <= 0) return [];
  if (result.label.kind === 'triple') return [0, 1, 2];
  return result.reels.flatMap((s, i) => (s === '🍒' ? [i] : []));
}

/** The pay table: symbols drawn as on the reels, and the multiplier. */
const PAYS: readonly (readonly [readonly string[], string])[] = [
  [['🍒', '🍒', '🍒'], '×5'],
  [['🍋', '🍋', '🍋'], '×8'],
  [['🍇', '🍇', '🍇'], '×15'],
  [['🔔', '🔔', '🔔'], '×30'],
  [['💎', '💎', '💎'], '×100'],
  [['7️⃣', '7️⃣', '7️⃣'], '×500'],
  [['🍒', '🍒'], '×1.5'],
  [['🍒'], '×0.3'],
];

function PaySymbols({ symbols }: { symbols: readonly string[] }) {
  const size = 32;
  return (
    <PixelScene w={size * symbols.length} h={size} className="cc-paytable__art">
      {symbols.map((s, i) => {
        const art = SYMBOL_ART[s];
        return art ? <Pixels key={i} sprite={art} x={i * size} y={0} /> : null;
      })}
    </PixelScene>
  );
}

function labelText(t: ReturnType<typeof useT>, result: SlotsResultView): string {
  const { kind, symbol } = result.label;
  if (kind === 'triple') return t('screen.casino.slots.label.triple', { symbol: symbol ?? '' });
  return t(`screen.casino.slots.label.${kind}`);
}

export default function SlotsScreen() {
  const t = useT();
  const { client } = useCasino();
  const sfx = useCasinoSfx();
  const { overview, refresh } = useOverview();
  const bet = useBetAmount('slots', overview?.minBet);
  const { busy, errorKey, run } = useCall();
  const [result, setResult] = useState<SlotsResultView | null>(null);
  const [spinKey, setSpinKey] = useState('idle');
  const stoppedCount = useReveal(result ? 3 : null, REEL_GAP_MS, spinKey);
  const done = result !== null && stoppedCount >= 3;
  const spinning = result !== null && !done;

  const spin = () => {
    sfx.arm();
    void run(async () => {
      const out = await client.bet<SlotsResultView>('slots', { stake: bet.amount });
      setResult(out.result);
      setSpinKey(out.result.roundId);
      sfx.play('reelTick');
      window.setTimeout(refresh, REEL_GAP_MS * 3 + 100);
      return out;
    });
  };

  // Sound at the end of the spin (the last stop and the verdict).
  const settledId = done && result ? result.roundId : null;
  const verdict = result?.settlement;
  const { play } = sfx;
  useEffect(() => {
    if (settledId === null || !verdict) return;
    play('reelStop');
    play(verdict.net > 0 ? (verdict.tier ? 'bigWin' : 'smallWin') : 'lose');
  }, [settledId, verdict, play]);

  const disabled = overview?.disabled.includes('slots') ?? false;
  return (
    <GameFrame screen="slots" jackpot={overview?.jackpotPool ?? null}>
      {disabled ? <Banner variant="warning" title={t('screen.casino.disabled')} /> : null}
      <p className="cc-intro">{t('screen.casino.slots.intro')}</p>
      <div
        className="cc-machine"
        role="img"
        aria-label={
          result && done
            ? t('screen.casino.slots.reels', { symbols: result.reels.join(' ') })
            : t('screen.casino.working')
        }
      >
        <SlotMachine
          reels={result ? result.reels : null}
          stopped={result ? stoppedCount : 0}
          spinKey={spinKey}
          winning={result && done ? winningReels(result) : []}
        />
      </div>
      {done && result ? (
        <ResultBanner
          settlement={result.settlement}
          detail={`${labelText(t, result)} · ×${result.multiplier}`}
        />
      ) : spinning ? (
        <p className="cc-status" aria-live="polite">
          {t('screen.casino.slots.spinning')}
        </p>
      ) : null}
      <ErrorLine errorKey={errorKey} />
      <BetBar
        value={bet.amount}
        onChange={bet.setAmount}
        minBet={bet.minBet}
        balance={bet.balance}
        disabled={busy || spinning || disabled}
      />
      <Button
        variant="filled"
        onClick={spin}
        disabled={busy || spinning || disabled || !bet.valid}
        className="cc-cta"
      >
        {result && done ? t('screen.casino.again') : t('screen.casino.slots.spin')}
      </Button>
      <section className="cc-paytable" aria-labelledby="cc-pay-title">
        <h2 className="bb-eyebrow" id="cc-pay-title">
          {t('screen.casino.slots.paytable')}
        </h2>
        <ul className="cc-paytable__list">
          {PAYS.map(([symbols, mult]) => (
            <li key={symbols.join('')}>
              <PaySymbols symbols={symbols} />
              <span className="cc-sr">{symbols.join('')}</span> <b>{mult}</b>
            </li>
          ))}
        </ul>
      </section>
      <RecentRounds overview={overview} game="slots" />
    </GameFrame>
  );
}
