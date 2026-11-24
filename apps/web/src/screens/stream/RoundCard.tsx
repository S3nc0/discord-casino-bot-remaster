import { useState } from 'react';
import { Button, Card, Chip, ChipGroup, Tag, TextField } from '@casino/ui';
import { STREAM_LIMITS, type StreamSide, type StreamView } from '@casino/shared';
import { formatPelica, useLocale, useT } from '../../shell/i18n.ts';
import { useBalanceStore } from '../../shell/stores/balance.ts';
import { formatDuration } from '../life/format.ts';
import type { StreamApi } from './client.ts';
import {
  effectiveRoundStatus,
  formatOdds,
  isFeatureDisabledError,
  parseAmount,
  pushStreamToast,
  roundDisplayLabel,
  streamErrorMessage,
  useStreamIntent,
} from './helpers.ts';

const QUICK_BETS = [100, 500, 1000, 5000] as const;

export interface RoundCardProps {
  stream: StreamView;
  serverNow: number;
  api: StreamApi;
  featureDisabled: boolean;
  onFeatureDisabled: () => void;
  onUpdated: (stream: StreamView) => void;
}

export function RoundCard({
  stream,
  serverNow,
  api,
  featureDisabled,
  onFeatureDisabled,
  onUpdated,
}: RoundCardProps) {
  const t = useT();
  const locale = useLocale();
  const nf = new Intl.NumberFormat(locale);
  const intent = useStreamIntent();
  const [amountText, setAmountText] = useState(String(STREAM_LIMITS.betMin));
  const [betError, setBetError] = useState<{
    key: string;
    params: Record<string, string | number>;
  } | null>(null);

  const round = stream.round;
  if (!round) {
    return (
      <Card variant="filled" title={t('screen.stream.ui.roundTitle')}>
        <p className="st__note">{t('screen.stream.ui.noRound')}</p>
      </Card>
    );
  }

  const label = roundDisplayLabel(round, t('screen.stream.round.default'));
  const status = effectiveRoundStatus(round, serverNow);
  const winOdds = formatOdds(round.winOddsBps);
  const loseOdds = formatOdds(round.loseOddsBps);
  const autoLockRemaining = Math.max(0, round.autoLockAt - serverNow);
  const amount = parseAmount(amountText);
  const myBet = stream.me.bet;
  const lockedSide = myBet?.side ?? null;
  const canBetBase =
    stream.status === 'live' &&
    !stream.me.isStreamer &&
    status === 'open' &&
    !featureDisabled &&
    !intent.busy &&
    amount >= STREAM_LIMITS.betMin &&
    amount <= stream.me.betRoom;

  const placeBet = (side: StreamSide) => {
    if (!canBetBase) return;
    if (lockedSide !== null && lockedSide !== side) return;
    setBetError(null);
    const intentLabel = `bet:${stream.id}:${round.id}:${side}:${amount}`;
    void intent
      .run(
        intentLabel,
        (key) => api.bet({ streamId: stream.id, roundId: round.id, side, amount }, key),
        (err) => {
          if (isFeatureDisabledError(err)) onFeatureDisabled();
          const msg = streamErrorMessage(err);
          setBetError({ key: msg.key, params: msg.params as Record<string, string | number> });
          pushStreamToast('error', msg.key, msg.params as Record<string, string | number>);
        },
      )
      .then((res) => {
        if (!res) return;
        useBalanceStore.getState().set(res.balance);
        onUpdated(res.stream);
        pushStreamToast('success', 'screen.stream.ui.betPlaced', {
          amount: formatPelica(locale, amount),
          side: t(`screen.stream.side.${side}`),
        });
      });
  };

  return (
    <Card variant="filled" title={label}>
      <div className="st__stack">
        <div className="st__row">
          <Tag hue={status === 'open' ? 'emerald' : 'orange'}>
            {status === 'open' ? t('screen.stream.round.open') : t('screen.stream.round.locked')}
          </Tag>
          <span className="st__note num">
            {t('screen.stream.ui.bettors', { count: nf.format(round.bettors) })}
          </span>
        </div>

        {status === 'open' ? (
          <p className="st__note num" data-testid="round-autolock">
            {t('screen.stream.ui.autoLockIn', { time: formatDuration(t, autoLockRemaining) })}
          </p>
        ) : null}

        <div className="st-pools">
          <div className="st-pool st-pool--win">
            <span className="st-pool__name">{t('screen.stream.ui.winPool')}</span>
            <span className="st-pool__fig num">{formatPelica(locale, round.winTotal)}</span>
            {winOdds ? (
              <span className="st-pool__hint num" data-testid="win-odds">
                {t('screen.stream.odds', { odds: winOdds })}
              </span>
            ) : null}
          </div>
          <div className="st-pool st-pool--lose">
            <span className="st-pool__name">{t('screen.stream.ui.losePool')}</span>
            <span className="st-pool__fig num">{formatPelica(locale, round.loseTotal)}</span>
            {loseOdds ? (
              <span className="st-pool__hint num" data-testid="lose-odds">
                {t('screen.stream.odds', { odds: loseOdds })}
              </span>
            ) : null}
          </div>
        </div>

        {!winOdds && !loseOdds ? (
          <p className="st__note">{t('screen.stream.ui.oddsNone')}</p>
        ) : null}

        {stream.status === 'live' && !stream.me.isStreamer ? (
          <div className="st__stack">
            {myBet ? (
              <p className="st__note num" data-testid="my-stake">
                {t('screen.stream.ui.yourStake', {
                  staked: formatPelica(locale, myBet.amount),
                  max: formatPelica(locale, STREAM_LIMITS.betMax),
                  side: t(`screen.stream.side.${myBet.side}`),
                })}
              </p>
            ) : null}
            {lockedSide ? (
              <p className="st__note">
                {t('screen.stream.ui.sideLocked', {
                  side: t(`screen.stream.side.${lockedSide}`),
                })}
              </p>
            ) : null}
            <p className="st__note num" data-testid="bet-room">
              {t('screen.stream.ui.betRoom', {
                room: formatPelica(locale, stream.me.betRoom),
              })}
            </p>

            <TextField
              label={t('screen.stream.ui.betAmount')}
              value={amountText}
              inputMode="numeric"
              autoComplete="off"
              disabled={status !== 'open' || featureDisabled || intent.busy}
              onChange={(e) => setAmountText(e.target.value)}
              helperText={t('screen.stream.ui.betRange', {
                min: nf.format(STREAM_LIMITS.betMin),
                max: nf.format(STREAM_LIMITS.betMax),
              })}
            />

            <ChipGroup label={t('screen.stream.ui.betAmount')}>
              {QUICK_BETS.map((n) => (
                <Chip
                  key={n}
                  selected={amount === n}
                  disabled={status !== 'open' || featureDisabled || intent.busy}
                  onClick={() => setAmountText(String(n))}
                >
                  <span className="num">{nf.format(n)}</span>
                </Chip>
              ))}
            </ChipGroup>

            {betError ? (
              <p className="st__error" role="alert">
                {t(betError.key, betError.params)}
              </p>
            ) : null}

            <div className="st-actions">
              <Button
                disabled={!canBetBase || (lockedSide !== null && lockedSide !== 'win')}
                onClick={() => placeBet('win')}
              >
                {t('screen.stream.side.win')}
              </Button>
              <Button
                variant="tonal"
                disabled={!canBetBase || (lockedSide !== null && lockedSide !== 'lose')}
                onClick={() => placeBet('lose')}
              >
                {t('screen.stream.side.lose')}
              </Button>
            </div>
          </div>
        ) : null}
      </div>
    </Card>
  );
}
