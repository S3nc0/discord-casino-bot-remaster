import { useEffect, useMemo, useRef } from 'react';
import { Banner, Button, Tag } from '@casino/ui';
import type { BlackjackIdleData, BlackjackSeatView, BlackjackView, CardView } from '@casino/shared';
import { useT } from '../../shell/i18n.ts';
import { useSessionStore } from '../../shell/stores/session.ts';
import { BetBar } from './BetBar.tsx';
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
import { PlayingCard } from './PlayingCard.tsx';
import { RecentRounds } from './RecentRounds.tsx';
import { ResultBanner } from './Result.tsx';
import { useCasino } from './services.tsx';

const SEATS = 5;

function Hand({
  label,
  cards,
  value,
  seenBefore,
  tag,
}: {
  label: string;
  cards: readonly (CardView | null)[];
  value: number | null;
  /** Cards already on the table before this render: only newer ones flip in. */
  seenBefore: number;
  tag?: string | undefined;
}) {
  const t = useT();
  return (
    <div className="cc-hand">
      <p className="cc-hand__label">
        <b>{label}</b>
        {value !== null && value > 0 ? (
          <Tag solid>{t('screen.casino.blackjack.total', { value })}</Tag>
        ) : null}
        {tag ? (
          <Tag hue="yellow" solid>
            {tag}
          </Tag>
        ) : null}
      </p>
      <div className="cc-cards">
        {cards.length === 0 ? <span className="cc-card cc-card--empty" aria-hidden="true" /> : null}
        {cards.map((card, i) => (
          <PlayingCard key={i} card={card} fresh={i >= seenBefore} />
        ))}
      </div>
    </div>
  );
}

export default function BlackjackScreen() {
  const t = useT();
  const { client } = useCasino();
  const sfx = useCasinoSfx();
  const me = useUserId();
  const participants = useSessionStore((s) => s.participants);
  const { overview, refresh } = useOverview();
  const { snapshot, offsetMs } = useTable('blackjack');
  const bet = useBetAmount('blackjack', overview?.minBet);
  const { busy, errorKey, run } = useCall();

  const phase = snapshot?.phase ?? 'idle';
  const view = phase === 'idle' || !snapshot ? null : (snapshot.data as BlackjackView);
  const idle = (snapshot?.data ?? null) as BlackjackIdleData | null;
  const seats: readonly BlackjackSeatView[] = view?.seats ?? [];
  const mine = seats.find((s) => s.userId === me) ?? null;
  const myTurn =
    view !== null &&
    phase === 'player' &&
    mine !== null &&
    view.turn === mine.index &&
    mine.status === 'playing';
  const names = useMemo(() => {
    const map = new Map<string, string>();
    for (const p of participants) map.set(p.id, p.globalName ?? p.username);
    return map;
  }, [participants]);
  const nameOf = (seat: BlackjackSeatView) =>
    seat.userId === me
      ? t('screen.casino.blackjack.you')
      : (names.get(seat.userId) ?? t('screen.casino.blackjack.seat', { n: seat.index + 1 }));

  const betSeconds = useCountdown(phase === 'betting' ? (view?.deadline ?? null) : null, offsetMs);
  const turnSeconds = useCountdown(myTurn ? (view?.deadline ?? null) : null, offsetMs);

  // Cards that were already shown last render do not flip again.
  const counts = useRef(new Map<string, number>());
  const seenFor = (key: string, length: number) => Math.min(counts.current.get(key) ?? 0, length);
  const roundKey = view?.roundId ?? '';
  const dealerSeen = seenFor(`${roundKey}-d`, view?.dealer.length ?? 0);
  const seatSeen = seats.map((s) => seenFor(`${roundKey}-${s.userId}`, s.cards.length));
  const { play } = sfx;
  useEffect(() => {
    if (!view) {
      counts.current.clear();
      return;
    }
    const before = [...counts.current.values()].reduce((a, b) => a + b, 0);
    counts.current.set(`${view.roundId}-d`, view.dealer.length);
    for (const s of view.seats) counts.current.set(`${view.roundId}-${s.userId}`, s.cards.length);
    const after = [...counts.current.values()].reduce((a, b) => a + b, 0);
    if (after > before) play('cardDeal');
  }, [view, play]);

  const settledId = phase === 'settled' && mine?.settlement ? view?.roundId : null;
  const verdict = mine?.settlement;
  useEffect(() => {
    if (!settledId || !verdict) return;
    play(verdict.net > 0 ? 'smallWin' : verdict.net < 0 ? 'lose' : 'click');
    refresh();
  }, [settledId, verdict, play, refresh]);

  const sit = () => {
    sfx.arm();
    void run(async () => {
      const out = await client.bet('blackjack', {
        stake: bet.amount,
        ...(phase === 'betting' && view ? { roundId: view.roundId } : {}),
      });
      sfx.play('chip');
      return out;
    });
  };
  const act = (action: 'hit' | 'stand' | 'double' | 'deal') => {
    if (!view) return;
    sfx.arm();
    void run(() => client.action('blackjack', view.roundId, action));
  };

  const disabled = overview?.disabled.includes('blackjack') ?? false;
  const canJoin =
    (phase === 'idle' || phase === 'betting') && mine === null && seats.length < SEATS;
  const full = phase === 'betting' && mine === null && seats.length >= SEATS;
  const watching = (phase === 'player' || phase === 'settled') && mine === null;
  const canDouble = myTurn && mine !== null && mine.cards.length === 2 && !mine.doubled;

  return (
    <GameFrame screen="blackjack" jackpot={overview?.jackpotPool ?? null}>
      {disabled ? <Banner variant="warning" title={t('screen.casino.disabled')} /> : null}
      {!snapshot ? (
        <p className="cc-status">{t('screen.casino.loadingTable')}</p>
      ) : (
        <>
          <div className="cc-felt" data-phase={phase}>
            <Hand
              label={t('screen.casino.blackjack.dealer')}
              cards={view?.dealer ?? []}
              value={view?.dealerValue ?? null}
              seenBefore={dealerSeen}
            />
            {seats.map((seat, i) => (
              <Hand
                key={seat.userId}
                label={nameOf(seat)}
                cards={seat.cards}
                value={seat.value}
                seenBefore={seatSeen[i] ?? 0}
                tag={
                  seat.doubled
                    ? t('screen.casino.blackjack.doubled')
                    : seat.result
                      ? t(`screen.casino.blackjack.res.${seat.result}`)
                      : undefined
                }
              />
            ))}
          </div>
          <p className="cc-status" aria-live="polite">
            {phase === 'idle' ? t('screen.casino.blackjack.idle') : null}
            {phase === 'betting' && mine && betSeconds !== null
              ? t('screen.casino.blackjack.betting', { seconds: betSeconds })
              : null}
            {phase === 'betting' && !mine && betSeconds !== null
              ? t('screen.casino.blackjack.betting', { seconds: betSeconds })
              : null}
            {myTurn && turnSeconds !== null
              ? t('screen.casino.blackjack.yourTurn', { seconds: turnSeconds })
              : null}
            {phase === 'player' && !myTurn && view && view.turn >= 0 && mine
              ? t('screen.casino.blackjack.otherTurn', { n: view.turn + 1 })
              : null}
            {watching && phase === 'player' ? t('screen.casino.blackjack.watching') : null}
            {full ? t('screen.casino.blackjack.tableFull') : null}
          </p>
          {phase === 'settled' && mine?.settlement ? (
            <ResultBanner
              settlement={mine.settlement}
              detail={mine.result ? t(`screen.casino.blackjack.res.${mine.result}`) : undefined}
            />
          ) : null}
          <ErrorLine errorKey={errorKey} />
          {myTurn ? (
            <div className="cc-actions">
              <Button variant="filled" disabled={busy} onClick={() => act('hit')}>
                {t('screen.casino.blackjack.hit')}
              </Button>
              <Button variant="tonal" disabled={busy} onClick={() => act('stand')}>
                {t('screen.casino.blackjack.stand')}
              </Button>
              <Button
                variant="outlined"
                disabled={busy || !canDouble}
                onClick={() => act('double')}
              >
                {t('screen.casino.blackjack.double')}
              </Button>
            </div>
          ) : null}
          {phase === 'betting' && mine ? (
            <>
              <p className="cc-note">{t('screen.casino.blackjack.seated')}</p>
              <Button variant="tonal" disabled={busy} onClick={() => act('deal')}>
                {t('screen.casino.blackjack.deal')}
              </Button>
            </>
          ) : null}
          {canJoin && !disabled ? (
            <>
              <BetBar
                value={bet.amount}
                onChange={bet.setAmount}
                minBet={idle?.minBet ?? bet.minBet}
                balance={bet.balance}
                disabled={busy}
              />
              <Button
                variant="filled"
                className="cc-cta"
                disabled={busy || !bet.valid}
                onClick={sit}
              >
                {t('screen.casino.bet')}
              </Button>
            </>
          ) : null}
        </>
      )}
      <RecentRounds overview={overview} game="blackjack" />
    </GameFrame>
  );
}
