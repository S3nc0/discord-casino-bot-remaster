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
            dealer
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
  const timed = phase === 'lobby' || phase === 'rolling';
  const seconds = useCountdown(timed ? (data?.deadline ?? null) : null, offsetMs);
  const hands = data?.hands ?? [];
  const myHand = hands.find((h) => h.userId === me);
  const rake = Math.round((data?.rakeBps ?? 1000) / 100);
  const minSeats = data?.minSeats ?? 2;

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
  const act = (action: 'stand' | 'begin' | 'table_roll') => {
    if (!snapshot?.roundId) return;
    sfx.arm();
    void run(async () => {
      const out = await client.action('chinchiro', snapshot.roundId as string, action);
      if (action === 'table_roll') sfx.play('diceRoll');
      return out;
    });
  };

  const nameOf = (userId: string | null, index: number) =>
    userId === null
      ? t('screen.casino.chinchiro.table.free')
      : userId === me
        ? t('screen.casino.chinchiro.you')
        : (names.get(userId) ?? t('screen.casino.chinchiro.table.seat', { n: index + 1 }));
  const seatIndex = (userId: string) => hands.findIndex((h) => h.userId === userId);
  const potLine = (
    <Tag hue="yellow" solid>
      {t('screen.casino.chinchiro.table.pot', {
        amount: formatNumber(locale, data?.bet ?? 0),
        rake,
      })}
    </Tag>
  );

  if (!snapshot) return <p className="cc-status">{t('screen.casino.loadingTable')}</p>;

  const results = data?.results ?? [];
  const winners = results.filter((r) => r.isWinner);
  const head =
    winners.length === results.length
      ? t('screen.casino.chinchiro.table.head.draw')
      : winners.length === 1 && winners[0]?.userId === me
        ? `👑 ${t('screen.casino.chinchiro.table.youWin')}`
        : winners.length === 1
          ? t('screen.casino.chinchiro.table.head.single', {
              name: nameOf(winners[0]?.userId ?? null, seatIndex(winners[0]?.userId ?? '')),
            })
          : t('screen.casino.chinchiro.table.head.split', {
              names: winners
                .map((w) => nameOf(w.userId, seatIndex(w.userId)))
                .join(locale === 'ja' ? '・' : ', '),
            });
  const mine = results.find((r) => r.userId === me);
  const myDetail = !mine
    ? ''
    : winners.length === results.length
      ? t('screen.casino.chinchiro.table.youDraw')
      : mine.isWinner
        ? t(`screen.casino.chinchiro.table.${winners.length === 1 ? 'youWin' : 'youSplit'}`)
        : t('screen.casino.chinchiro.table.youLose');

  return (
    <div className="cc-stack">
      {phase === 'idle' ? (
        <>
          <p className="cc-intro">
            {data?.folded
              ? t('screen.casino.chinchiro.table.folded', { min: minSeats })
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
            {potLine}{' '}
            {seconds !== null ? (
              <Tag hue="orange" solid>
                {t('screen.casino.chinchiro.table.waiting', { seconds })}
              </Tag>
            ) : null}
          </p>
          <p className="cc-note">{t('screen.casino.chinchiro.table.rule', { min: minSeats })}</p>
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

      {phase === 'rolling' && data ? (
        <>
          <p className="cc-status">
            {potLine}{' '}
            {seconds !== null ? (
              <Tag hue="orange" solid>
                {t('screen.casino.chinchiro.table.rollTime', { seconds })}
              </Tag>
            ) : null}
          </p>
          <p className="cc-note">{t('screen.casino.chinchiro.table.rolling')}</p>
          <div className="cc-table" data-phase={phase}>
            {hands.map((hand, i) => (
              <div key={hand.roundId} className="cc-seatroll" data-me={hand.userId === me}>
                <DiceRow
                  roll={lastOf(hand.rolls)}
                  rollKey={`${hand.roundId}-${hand.rolls.length}`}
                  caption={nameOf(hand.userId, i)}
                />
                {hand.rolled ? null : <Tag>{t('screen.casino.chinchiro.table.notRolled')}</Tag>}
              </div>
            ))}
          </div>
          <ErrorLine errorKey={errorKey} />
          {myHand && !myHand.rolled ? (
            <Button
              variant="filled"
              onClick={() => act('table_roll')}
              disabled={busy}
              className="cc-cta"
            >
              {t('screen.casino.chinchiro.table.roll')}
            </Button>
          ) : null}
        </>
      ) : null}

      {phase === 'result' && data ? (
        <>
          {data.refunded ? (
            <Banner variant="warning" title={t('screen.casino.chinchiro.table.refunded')} />
          ) : (
            <p className="cc-status">{head}</p>
          )}
          <div className="cc-table" data-phase={phase}>
            {results.map((r) => {
              const i = seatIndex(r.userId);
              const hand = hands[i];
              return (
                <div
                  key={r.userId}
                  className="cc-seatroll"
                  data-me={r.userId === me}
                  data-winner={r.isWinner}
                >
                  <DiceRow
                    roll={hand ? lastOf(hand.rolls) : null}
                    rollKey={`${hand?.roundId ?? r.userId}-${hand?.rolls.length ?? 0}`}
                    caption={`${r.isWinner ? '👑 ' : ''}${nameOf(r.userId, i)}`}
                  />
                  {data.refunded ? null : (
                    <Tag hue={r.net > 0 ? 'green' : r.net < 0 ? 'red' : 'neutral'} solid>
                      {r.isWinner ? `${t('screen.casino.chinchiro.table.winner')} ` : ''}
                      {r.net > 0 ? '+' : ''}
                      {formatNumber(locale, r.net)}
                    </Tag>
                  )}
                </div>
              );
            })}
          </div>
          {data.refunded ? null : (
            <p className="cc-note">
              {potLine}{' '}
              {t('screen.casino.chinchiro.table.rake', {
                amount: formatNumber(locale, data.rake ?? 0),
              })}
            </p>
          )}
          {mine && !data.refunded ? (
            <ResultBanner
              settlement={{
                net: mine.net,
                payout: mine.payout,
                jackpot: 0,
                tier: null,
                stake: data.bet ?? 0,
              }}
              detail={myDetail}
            />
          ) : null}
          <ErrorLine errorKey={errorKey} />
        </>
      ) : null}
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
