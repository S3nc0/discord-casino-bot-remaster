import { useState, type CSSProperties } from 'react';
import {
  Banner,
  Button,
  Card,
  Chip,
  ChipGroup,
  Dialog,
  Progress,
  Tag,
  TextField,
} from '@casino/ui';
import { STREAM_LIMITS, type StreamView, type TransferView } from '@casino/shared';
import { formatPelica, useLocale, useT } from '../../shell/i18n.ts';
import { useBalanceStore } from '../../shell/stores/balance.ts';
import type { StreamApi } from './client.ts';
import {
  calcTipFee,
  DEFAULT_TIP_CONFIRM_FROM,
  DEFAULT_TIP_FEE_BPS,
  isFeatureDisabledError,
  parseAmount,
  pushStreamToast,
  streamErrorMessage,
  tipTierFor,
  useStreamIntent,
} from './helpers.ts';

const QUICK_TIPS = [100, 500, 1000, 5000] as const;

export interface TipPanelProps {
  stream: StreamView;
  transfer: TransferView | null;
  api: StreamApi;
  featureDisabled: boolean;
  onFeatureDisabled: () => void;
  onUpdated: (stream: StreamView) => void;
  onReloadTransfer: () => void;
}

export function TipPanel({
  stream,
  transfer,
  api,
  featureDisabled,
  onFeatureDisabled,
  onUpdated,
  onReloadTransfer,
}: TipPanelProps) {
  const t = useT();
  const locale = useLocale();
  const nf = new Intl.NumberFormat(locale);
  const intent = useStreamIntent();
  const [amountText, setAmountText] = useState('');
  const [message, setMessage] = useState('');
  const [confirming, setConfirming] = useState(false);
  const [tipError, setTipError] = useState<{
    key: string;
    params: Record<string, string | number>;
  } | null>(null);

  const amount = parseAmount(amountText);
  const feeBps = transfer?.feeBps ?? DEFAULT_TIP_FEE_BPS;
  const confirmFrom = transfer?.confirmFrom ?? DEFAULT_TIP_CONFIRM_FROM;
  const fee = calcTipFee(amount, feeBps);
  const total = amount + fee;
  const remainingCap = transfer ? Math.max(0, transfer.dailyLimit - transfer.sentToday) : null;
  const blockedByDebt = (transfer?.debt ?? 0) > 0;
  const lockedByGames = transfer !== null && transfer.gamesPlayed < transfer.minGames;
  const canSend =
    stream.status === 'live' &&
    !stream.me.isStreamer &&
    !featureDisabled &&
    !blockedByDebt &&
    !lockedByGames &&
    !intent.busy &&
    amount >= STREAM_LIMITS.tipMin;

  const submitTip = () => {
    if (!canSend) return;
    setConfirming(false);
    setTipError(null);
    const trimmedMessage = message.trim();
    const intentLabel = `tip:${stream.id}:${amount}:${trimmedMessage}`;
    void intent
      .run(
        intentLabel,
        (key) =>
          api.tip(
            {
              streamId: stream.id,
              amount,
              ...(trimmedMessage ? { message: trimmedMessage } : {}),
            },
            key,
          ),
        (err) => {
          if (isFeatureDisabledError(err)) onFeatureDisabled();
          const msg = streamErrorMessage(err);
          setTipError({ key: msg.key, params: msg.params as Record<string, string | number> });
          pushStreamToast('error', msg.key, msg.params as Record<string, string | number>);
        },
      )
      .then((res) => {
        if (!res) return;
        useBalanceStore.getState().set(res.balance);
        onUpdated(res.stream);
        onReloadTransfer();
        pushStreamToast('success', 'screen.stream.ui.tipSent', {
          amount: formatPelica(locale, res.amount),
          fee: formatPelica(locale, res.fee),
        });
        setAmountText('');
        setMessage('');
      });
  };

  return (
    <div className="st__stack">
      {stream.status === 'live' && !stream.me.isStreamer ? (
        <Card variant="filled" title={t('screen.stream.ui.tipTitle')}>
          <div className="st__stack">
            {blockedByDebt ? (
              <Banner variant="warning" title={t('screen.stream.rule.stream_debt')} />
            ) : null}
            {lockedByGames && transfer ? (
              <Banner
                variant="info"
                title={t('screen.life.transfer.minGames', {
                  min: transfer.minGames,
                  played: transfer.gamesPlayed,
                })}
              />
            ) : null}

            <TextField
              label={t('screen.stream.ui.tipAmount')}
              value={amountText}
              inputMode="numeric"
              autoComplete="off"
              disabled={featureDisabled || intent.busy}
              onChange={(e) => setAmountText(e.target.value)}
              helperText={t('screen.stream.ui.tipMinHint', {
                min: nf.format(STREAM_LIMITS.tipMin),
              })}
            />

            <ChipGroup label={t('screen.stream.ui.tipAmount')}>
              {QUICK_TIPS.map((n) => (
                <Chip
                  key={n}
                  selected={amount === n}
                  disabled={featureDisabled || intent.busy}
                  onClick={() => setAmountText(String(n))}
                >
                  <span className="num">{nf.format(n)}</span>
                </Chip>
              ))}
            </ChipGroup>

            <TextField
              label={t('screen.stream.ui.tipMessage')}
              value={message}
              maxLength={STREAM_LIMITS.tipMessageMax}
              autoComplete="off"
              disabled={featureDisabled || intent.busy}
              onChange={(e) => setMessage(e.target.value)}
              helperText={t('screen.stream.ui.tipMessageHint', {
                used: nf.format(message.length),
                max: nf.format(STREAM_LIMITS.tipMessageMax),
              })}
            />

            {amount > 0 ? (
              <dl className="st-sum" aria-live="polite" data-testid="tip-fee-preview">
                <dt>{t('screen.stream.ui.tipFee')}</dt>
                <dd className="num">{formatPelica(locale, fee)}</dd>
                <dt>{t('screen.stream.ui.tipTotal')}</dt>
                <dd className="st-sum__total num">{formatPelica(locale, total)}</dd>
              </dl>
            ) : null}

            {transfer && remainingCap !== null ? (
              <div className="st__stack">
                <p className="st__note num" data-testid="tip-daily-cap">
                  {t('screen.stream.ui.tipDailyCap', {
                    remaining: formatPelica(locale, remainingCap),
                    limit: formatPelica(locale, transfer.dailyLimit),
                  })}
                </p>
                <Progress
                  label={t('screen.stream.ui.tipDailyCap', {
                    remaining: formatPelica(locale, remainingCap),
                    limit: formatPelica(locale, transfer.dailyLimit),
                  })}
                  value={transfer.sentToday}
                  max={transfer.dailyLimit}
                  valueLabel=""
                />
              </div>
            ) : null}

            <p className="st__note num">
              {t('screen.stream.ui.tipConfirmHint', { from: formatPelica(locale, confirmFrom) })}
            </p>

            {tipError ? (
              <p className="st__error" role="alert">
                {t(tipError.key, tipError.params)}
              </p>
            ) : null}

            <Button
              disabled={!canSend}
              onClick={() => (amount >= confirmFrom ? setConfirming(true) : submitTip())}
            >
              {t('screen.stream.ui.tipSend')}
            </Button>
          </div>
        </Card>
      ) : null}

      <Card variant="filled" title={t('screen.stream.ui.recentTips')}>
        {stream.recentTips.length === 0 ? (
          <p className="st__note">{t('screen.stream.ui.noTips')}</p>
        ) : (
          <ul className="st-tips" aria-label={t('screen.stream.ui.recentTips')}>
            {stream.recentTips.map((tip, idx) => {
              const tier = tipTierFor(tip.amount);
              const style = { '--st-tip-accent': tier.hex } as CSSProperties;
              return (
                <li
                  key={`${tip.tipperId}-${tip.at}-${idx}`}
                  className="st-tip"
                  data-tier={tier.tier}
                  data-color={tier.hex}
                  style={style}
                >
                  <div className="st-tip__head">
                    <span className="st-tip__author">{tip.tipperName}</span>
                    <Tag hue={tier.hue}>
                      <span className="num">{formatPelica(locale, tip.amount)}</span>
                    </Tag>
                  </div>
                  {tip.message ? <p className="st-tip__msg">{tip.message}</p> : null}
                </li>
              );
            })}
          </ul>
        )}
      </Card>

      <Dialog
        open={confirming}
        role="alertdialog"
        onClose={() => setConfirming(false)}
        title={t('screen.stream.ui.tipConfirmTitle')}
        description={t('screen.stream.ui.tipConfirmBody', {
          name: stream.streamerName,
          amount: formatPelica(locale, amount),
          fee: formatPelica(locale, fee),
          total: formatPelica(locale, total),
        })}
        actions={
          <>
            <Button variant="text" onClick={() => setConfirming(false)}>
              {t('common.cancel')}
            </Button>
            <Button onClick={submitTip}>{t('screen.stream.ui.confirmYes')}</Button>
          </>
        }
      />
    </div>
  );
}
