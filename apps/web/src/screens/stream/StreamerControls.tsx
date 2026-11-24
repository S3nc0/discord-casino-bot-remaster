import { useState, type FormEvent } from 'react';
import { Button, Card, Dialog, TextField } from '@casino/ui';
import {
  STREAM_LIMITS,
  type StreamSettleResult,
  type StreamSide,
  type StreamView,
} from '@casino/shared';
import { useT } from '../../shell/i18n.ts';
import { useBalanceStore } from '../../shell/stores/balance.ts';
import type { StreamApi } from './client.ts';
import {
  effectiveRoundStatus,
  isFeatureDisabledError,
  pushStreamToast,
  roundDisplayLabel,
  streamErrorMessage,
  useStreamIntent,
} from './helpers.ts';

type ConfirmKind = { type: 'settle'; side: StreamSide } | { type: 'void' } | { type: 'end' };

export interface StreamerControlsProps {
  stream: StreamView;
  serverNow: number;
  api: StreamApi;
  featureDisabled: boolean;
  onFeatureDisabled: () => void;
  onUpdated: (stream: StreamView) => void;
  onSettled: (result: StreamSettleResult) => void;
}

export function StreamerControls({
  stream,
  serverNow,
  api,
  featureDisabled,
  onFeatureDisabled,
  onUpdated,
  onSettled,
}: StreamerControlsProps) {
  const t = useT();
  const intent = useStreamIntent();
  const [roundLabel, setRoundLabel] = useState('');
  const [confirm, setConfirm] = useState<ConfirmKind | null>(null);
  const [actionError, setActionError] = useState<{
    key: string;
    params: Record<string, string | number>;
  } | null>(null);

  if (!stream.me.isStreamer || stream.status !== 'live') return null;

  const round = stream.round;
  const effectiveStatus = round ? effectiveRoundStatus(round, serverNow) : null;
  const activeLabel = round ? roundDisplayLabel(round, t('screen.stream.round.default')) : '';

  const handleErr = (err: unknown) => {
    if (isFeatureDisabledError(err)) onFeatureDisabled();
    const msg = streamErrorMessage(err);
    setActionError({ key: msg.key, params: msg.params as Record<string, string | number> });
    pushStreamToast('error', msg.key, msg.params as Record<string, string | number>);
  };

  const handleOpenRound = (e: FormEvent) => {
    e.preventDefault();
    if (round !== null || featureDisabled || intent.busy) return;
    setActionError(null);
    const trimmed = roundLabel.trim();
    void intent
      .run(
        `open:${stream.id}:${trimmed}`,
        (key) =>
          api.openRound({ streamId: stream.id, ...(trimmed ? { label: trimmed } : {}) }, key),
        handleErr,
      )
      .then((res) => {
        if (!res) return;
        useBalanceStore.getState().set(res.balance);
        onUpdated(res.stream);
        setRoundLabel('');
        pushStreamToast('success', 'screen.stream.ui.roundOpened');
      });
  };

  const handleLock = () => {
    if (!round || effectiveStatus !== 'open' || intent.busy) return;
    setActionError(null);
    void intent
      .run(
        `lock:${stream.id}:${round.id}`,
        (key) => api.lock({ streamId: stream.id, roundId: round.id }, key),
        handleErr,
      )
      .then((res) => {
        if (!res) return;
        useBalanceStore.getState().set(res.balance);
        onUpdated(res.stream);
        pushStreamToast('success', 'screen.stream.ui.roundLocked');
      });
  };

  const executeConfirmed = () => {
    const action = confirm;
    if (!action) return;
    setConfirm(null);
    setActionError(null);

    if (action.type === 'settle') {
      if (!round || effectiveStatus !== 'locked') return;
      void intent
        .run(
          `settle:${stream.id}:${round.id}:${action.side}`,
          (key) => api.settle({ streamId: stream.id, roundId: round.id, winner: action.side }, key),
          handleErr,
        )
        .then((res) => {
          if (!res) return;
          useBalanceStore.getState().set(res.balance);
          onUpdated(res.stream);
          onSettled(res.result);
          pushStreamToast('success', 'screen.stream.ui.roundSettled');
        });
      return;
    }

    if (action.type === 'void') {
      if (!round) return;
      void intent
        .run(
          `void:${stream.id}:${round.id}`,
          (key) => api.voidRound({ streamId: stream.id, roundId: round.id }, key),
          handleErr,
        )
        .then((res) => {
          if (!res) return;
          useBalanceStore.getState().set(res.balance);
          onUpdated(res.stream);
          onSettled(res.result);
          pushStreamToast('success', 'screen.stream.ui.roundVoided');
        });
      return;
    }

    void intent
      .run(`end:${stream.id}`, (key) => api.end({ streamId: stream.id }, key), handleErr)
      .then((res) => {
        if (!res) return;
        useBalanceStore.getState().set(res.balance);
        onUpdated(res.stream);
        if (res.voided) onSettled(res.voided);
        pushStreamToast('success', 'screen.stream.ui.streamEnded');
      });
  };

  const dialogTitle =
    confirm?.type === 'settle'
      ? t('screen.stream.ui.confirmSettleTitle')
      : confirm?.type === 'void'
        ? t('screen.stream.ui.confirmVoidTitle')
        : confirm?.type === 'end'
          ? t('screen.stream.ui.confirmEndTitle')
          : '';

  const dialogBody =
    confirm?.type === 'settle'
      ? t('screen.stream.ui.confirmSettleBody', {
          side: t(`screen.stream.side.${confirm.side}`),
          label: activeLabel,
        })
      : confirm?.type === 'void'
        ? t('screen.stream.ui.confirmVoidBody', { label: activeLabel })
        : confirm?.type === 'end'
          ? t('screen.stream.ui.confirmEndBody')
          : undefined;

  return (
    <Card variant="filled" title={t('screen.stream.ui.controlsTitle')}>
      <div className="st__stack">
        {round === null ? (
          <form className="st__stack" onSubmit={handleOpenRound}>
            <TextField
              label={t('screen.stream.ui.roundLabel')}
              value={roundLabel}
              maxLength={STREAM_LIMITS.roundLabelMax}
              autoComplete="off"
              disabled={featureDisabled || intent.busy}
              onChange={(e) => setRoundLabel(e.target.value)}
              helperText={t('screen.stream.ui.roundLabelHint', {
                max: STREAM_LIMITS.roundLabelMax,
                default: t('screen.stream.round.default'),
              })}
            />
            <Button type="submit" disabled={featureDisabled || intent.busy}>
              {t('screen.stream.ui.openRound')}
            </Button>
          </form>
        ) : (
          <div className="st__stack">
            <Button
              variant="tonal"
              disabled={effectiveStatus !== 'open' || intent.busy}
              onClick={handleLock}
            >
              {t('screen.stream.ui.lockRound')}
            </Button>

            {effectiveStatus === 'open' ? (
              <p className="st__note" data-testid="lock-first-hint">
                {t('screen.stream.ui.lockFirstHint')}
              </p>
            ) : null}

            <div className="st-actions">
              <Button
                disabled={effectiveStatus !== 'locked' || intent.busy}
                onClick={() => setConfirm({ type: 'settle', side: 'win' })}
              >
                {t('screen.stream.ui.settleWin')}
              </Button>
              <Button
                variant="tonal"
                disabled={effectiveStatus !== 'locked' || intent.busy}
                onClick={() => setConfirm({ type: 'settle', side: 'lose' })}
              >
                {t('screen.stream.ui.settleLose')}
              </Button>
            </div>

            <Button
              variant="outlined"
              disabled={intent.busy}
              onClick={() => setConfirm({ type: 'void' })}
            >
              {t('screen.stream.ui.voidRound')}
            </Button>
          </div>
        )}

        {actionError ? (
          <p className="st__error" role="alert">
            {t(actionError.key, actionError.params)}
          </p>
        ) : null}

        <Button
          variant="outlined"
          disabled={intent.busy}
          onClick={() => setConfirm({ type: 'end' })}
        >
          {t('screen.stream.ui.endStream')}
        </Button>
      </div>

      <Dialog
        open={confirm !== null}
        role="alertdialog"
        onClose={() => setConfirm(null)}
        title={dialogTitle}
        description={dialogBody}
        actions={
          <>
            <Button variant="text" onClick={() => setConfirm(null)}>
              {t('common.cancel')}
            </Button>
            <Button onClick={executeConfirmed}>{t('screen.stream.ui.confirmYes')}</Button>
          </>
        }
      />
    </Card>
  );
}
