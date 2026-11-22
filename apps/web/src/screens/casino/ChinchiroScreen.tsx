import { useEffect, useMemo, useState } from 'react';
import { Banner, Button, Tabs, Tag } from '@casino/ui';
import type {
  ChinchiroRollView,
  ChinchiroSeatAccepted,
  ChinchiroTableData,
  ChinchiroView,
} from '@casino/shared';
import { useLocale, useT } from '../../shell/i18n.ts';
import { useSessionStore } from '../../shell/stores/session.ts';
import { useReveal } from './anim.ts';
import { BetBar } from './BetBar.tsx';
import { DiceRow, handLabel } from './DiceRow.tsx';
import { ErrorLine } from './ErrorLine.tsx';
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
import { useCasino } from './services.tsx';
import { RecentRounds } from './RecentRounds.tsx';
import { ResultBanner } from './Result.tsx';
import { formatNumber } from './format.ts';

const lastOf = (rolls: readonly ChinchiroRollView[]): ChinchiroRollView | null =>
  rolls[rolls.length - 1] ?? null;

function SoloTable({ minBet, onSettled }: { minBet: number; onSettled: () => void }) {
  const t = useT();
  const { client } = useCasino();
  const sfx = useCasinoSfx();
  const bet = useBetAmount('chinchiro', minBet);
  const { busy, errorKey, run } = useCall();
  const [view, setView] = useState<ChinchiroView | null>(null);
  const [step, setStep] = useState(0);
  const seconds = useCountdown(view?.status === 'player_turn' ? view.deadline : null);

  const finished = view?.status === 'settled';
  const playing = view?.status === 'player_turn';
  const dealer = view ? lastOf(view.dealerRolls) : null;
  const mine = view ? lastOf(view.playerRolls) : null;

  const apply = (next: ChinchiroView) => {
    setView(next);
    setStep((n) => n + 1);
    sfx.play('diceRoll');
    if (next.status === 'settled') {
      sfx.play(next.result && next.result.settlement.net > 0 ? 'smallWin' : 'lose');
      onSettled();
    }
  };

  const deal = () => {
    sfx.arm();
    void run(async () => {
      const out = await client.bet<ChinchiroView>('chinchiro', { stake: bet.amount });
      apply(out.result);
    });
  };
  const roll = () => {
    if (!view) return;
    sfx.arm();
    void run(async () => {
      const out = await client.action<ChinchiroView>('chinchiro', view.roundId, 'roll');
      apply(out.result);
    });
  };

  return (
    <div className="cc-stack">
      {!view || finished ? <p className="cc-intro">{t('screen.casino.chinchiro.intro')}</p> : null}
      {view ? (
        <div className="cc-table" data-phase={view.status}>
          <DiceRow
            roll={dealer}
            rollKey={`${view.roundId}-d`}
            caption={t('screen.casino.chinchiro.dealer')}
          />
          <DiceRow
            roll={mine}
            rollKey={`${view.roundId}-p${view.playerRolls.length}-${step}`}
            caption={t('screen.casino.chinchiro.you')}
          />
          {playing ? (
            <p className="cc-status">
              {mine && mine.hand.kind === 'menashi'
                ? t('screen.casino.chinchiro.reroll', { count: view.rollsLeft })
                : t('screen.casino.chinchiro.prompt')}{' '}
              <Tag solid>{t('screen.casino.chinchiro.rollsLeft', { count: view.rollsLeft })}</Tag>{' '}
              {seconds !== null ? (
                <Tag hue="orange" solid>
                  {t('screen.casino.chinchiro.timeLeft', { seconds })}
                </Tag>
              ) : null}
            </p>
          ) : null}
        </div>
      ) : null}

      {finished && view?.result ? (
        <>
          <ResultBanner
            settlement={view.result.settlement}
            detail={`${t(`screen.casino.chinchiro.result.${view.result.outcome}`)}${
              mine ? ` · ${handLabel(t, mine)}` : ''
            }`}
          />
          {view.result.penalty > 0 ? (
            <p className="cc-note">
              {t('screen.casino.chinchiro.penalty', { amount: view.result.penalty })}
            </p>
          ) : null}
        </>
      ) : null}

      <ErrorLine errorKey={errorKey} />

      {playing ? (
        <Button variant="filled" onClick={roll} disabled={busy} className="cc-cta">
          {t('screen.casino.chinchiro.roll')}
        </Button>
      ) : (
        <>
          <BetBar
            value={bet.amount}
            onChange={bet.setAmount}
            minBet={bet.minBet}
            balance={bet.balance}
            disabled={busy}
          />
          <Button variant="filled" onClick={deal} disabled={busy || !bet.valid} className="cc-cta">
            {finished ? t('screen.casino.again') : t('screen.casino.chinchiro.deal')}
          </Button>
        </>
      )}
    </div>
  );
}

function useNames() {
  const participants = useSessionStore((s) => s.participants);
  return useMemo(() => {
    const map = new Map<string, string>();
    for (const p of participants) map.set(p.id, p.globalName ?? p.username);
    return map;
  }, [participants]);
}

function SharedTable({ minBet, onSettled }: { minBet: number; onSettled: () => void }) {
  const t = useT();
  const locale = useLocale();
  const { client } = useCasino();
  const sfx = useCasinoSfx();
  const me = useUserId();
  const names = useNames();
  const { snapshot, offsetMs } = useTable('chinchiro');
  const bet = useBetAmount('chinchiro', minBet);
  const { busy, errorKey, run } = useCall();

  const data = (snapshot?.data ?? null) as ChinchiroTableData | null;
  const phase = snapshot?.phase ?? 'idle';
  const seated = snapshot?.seats.some((s) => s.userId === me) ?? false;
  const seconds = useCountdown(phase === 'lobby' ? (data?.deadline ?? null) : null, offsetMs);
  const dealerRolls = data?.dealerRolls ?? [];
  const hands = data?.hands ?? [];
  const total =
    phase === 'playing' || phase === 'result'
      ? dealerRolls.length + hands.reduce((n, h) => n + h.rolls.length, 0)
      : null;
  const revealKey = `${snapshot?.roundId ?? ''}-${phase === 'playing' || phase === 'result' ? 'go' : 'wait'}`;
  const revealed = useReveal(total, data?.stepMs ?? 900, revealKey);
  const shownAll = phase === 'result' ? (total ?? 0) : revealed;

  useEffect(() => {
    if (phase === 'result') onSettled();
  }, [phase, onSettled]);

  const sit = () => {
    sfx.arm();
    const stake = phase === 'lobby' && data?.bet ? data.bet : bet.amount;
    void run(async () => {
      const out = await client.bet<ChinchiroSeatAccepted>('chinchiro', {
        stake,
        args: { table: true },
        ...(phase === 'lobby' && snapshot?.roundId ? { roundId: snapshot.roundId } : {}),
      });
      sfx.play('chip');
      return out;
    });
  };
  const act = (action: 'stand' | 'begin') => {
    if (!snapshot?.roundId) return;
    sfx.arm();
    void run(() => client.action('chinchiro', snapshot.roundId as string, action));
  };

  const nameOf = (userId: string | null, index: number) =>
    userId === null
      ? t('screen.casino.chinchiro.table.free')
      : userId === me
        ? t('screen.casino.chinchiro.you')
        : (names.get(userId) ?? t('screen.casino.chinchiro.table.seat', { n: index + 1 }));

  let cursor = dealerRolls.length;
  const seatViews = hands.map((hand) => {
    const start = cursor;
    cursor += hand.rolls.length;
    return { hand, start };
  });
  const dealerShown = Math.min(shownAll, dealerRolls.length);
  const verdictOf = (userId: string) => data?.verdicts?.find((v) => v.userId === userId);
  const myVerdict = me ? verdictOf(me) : undefined;

  if (!snapshot) return <p className="cc-status">{t('screen.casino.loadingTable')}</p>;

  return (
    <div className="cc-stack">
      {phase === 'idle' ? (
        <>
          <p className="cc-intro">
            {data?.closedEmpty
              ? t('screen.casino.chinchiro.table.empty')
              : t('screen.casino.chinchiro.table.idle')}
          </p>
          <BetBar
            value={bet.amount}
            onChange={bet.setAmount}
            minBet={bet.minBet}
            balance={bet.balance}
            disabled={busy}
          />
          <Button variant="filled" onClick={sit} disabled={busy || !bet.valid} className="cc-cta">
            {t('screen.casino.chinchiro.table.open')}
          </Button>
        </>
      ) : null}

      {phase === 'lobby' && data ? (
        <>
          <p className="cc-status">
            <Tag hue="yellow" solid>
              {t('screen.casino.chinchiro.table.lobby', {
                amount: formatNumber(locale, data.bet ?? 0),
              })}
            </Tag>{' '}
            {seconds !== null ? (
              <Tag hue="orange" solid>
                {t('screen.casino.chinchiro.table.waiting', { seconds })}
              </Tag>
            ) : null}
          </p>
          <ul
            className="cc-seats"
            aria-label={t('screen.casino.chinchiro.table.seats', {
              taken: snapshot.seats.filter((s) => s.userId !== null).length,
              max: snapshot.seats.length,
            })}
          >
            {snapshot.seats.map((seat) => (
              <li key={seat.index} className="cc-seat" data-free={seat.userId === null}>
                <span>{nameOf(seat.userId, seat.index)}</span>
                {seat.userId !== null && seat.userId === data.hostId ? (
                  <Tag solid>{t('screen.casino.chinchiro.table.host')}</Tag>
                ) : null}
              </li>
            ))}
          </ul>
          <ErrorLine errorKey={errorKey} />
          {seated ? (
            <div className="cc-actions">
              <Button variant="outlined" onClick={() => act('stand')} disabled={busy}>
                {t('screen.casino.chinchiro.table.leave')}
              </Button>
              {data.hostId === me ? (
                <Button variant="filled" onClick={() => act('begin')} disabled={busy}>
                  {t('screen.casino.chinchiro.table.begin')}
                </Button>
              ) : null}
            </div>
          ) : (
            <Button variant="filled" onClick={sit} disabled={busy} className="cc-cta">
              {t('screen.casino.chinchiro.table.sit', {
                amount: formatNumber(locale, data.bet ?? 0),
              })}
            </Button>
          )}
        </>
      ) : null}

      {(phase === 'playing' || phase === 'result') && data ? (
        <div className="cc-table" data-phase={phase}>
          <p className="cc-status">
            {phase === 'playing' ? t('screen.casino.chinchiro.table.rolling') : null}
          </p>
          <DiceRow
            roll={dealerShown > 0 ? (dealerRolls[dealerShown - 1] ?? null) : null}
            rollKey={`${snapshot.roundId}-d${dealerShown}`}
            caption={t('screen.casino.chinchiro.dealer')}
          />
          {seatViews.map(({ hand, start }, i) => {
            const count = Math.max(0, Math.min(hand.rolls.length, shownAll - start));
            const verdict = phase === 'result' ? verdictOf(hand.userId) : undefined;
            return (
              <div key={hand.roundId} className="cc-seatroll" data-me={hand.userId === me}>
                <DiceRow
                  roll={count > 0 ? (hand.rolls[count - 1] ?? null) : null}
                  rollKey={`${hand.roundId}-${count}`}
                  caption={nameOf(hand.userId, i)}
                />
                {verdict && count === hand.rolls.length ? (
                  <Tag
                    hue={
                      verdict.result === 'win'
                        ? 'green'
                        : verdict.result === 'lose'
                          ? 'red'
                          : 'neutral'
                    }
                    solid
                  >
                    {t(`screen.casino.chinchiro.table.${verdict.result}`)}
                  </Tag>
                ) : null}
              </div>
            );
          })}
        </div>
      ) : null}

      {phase === 'result' && myVerdict ? (
        <ResultBanner
          settlement={{
            net: myVerdict.net,
            payout: myVerdict.payout,
            jackpot: 0,
            tier: null,
            stake: data?.bet ?? 0,
          }}
          detail={t(`screen.casino.chinchiro.result.${myVerdict.result}`)}
        />
      ) : null}
      {phase !== 'lobby' ? <ErrorLine errorKey={errorKey} /> : null}
    </div>
  );
}

export default function ChinchiroScreen() {
  const t = useT();
  const [mode, setMode] = useState<'solo' | 'table'>('solo');
  const { overview, refresh } = useOverview();
  const minBet = overview?.minBet ?? 10;
  const disabled = overview?.disabled.includes('chinchiro') ?? false;
  return (
    <GameFrame screen="chinchiro" jackpot={overview?.jackpotPool ?? null}>
      {disabled ? (
        <Banner variant="warning" title={t('screen.casino.disabled')} />
      ) : (
        <>
          <Tabs
            label={t('screen.casino.chinchiro.tabs')}
            activeId={mode}
            onChange={(id) => setMode(id as 'solo' | 'table')}
            tabs={[
              { id: 'solo', label: t('screen.casino.chinchiro.tab.solo') },
              { id: 'table', label: t('screen.casino.chinchiro.tab.table') },
            ]}
          />
          {mode === 'solo' ? (
            <SoloTable minBet={minBet} onSettled={refresh} />
          ) : (
            <SharedTable minBet={minBet} onSettled={refresh} />
          )}
        </>
      )}
      <RecentRounds overview={overview} game="chinchiro" />
    </GameFrame>
  );
}
