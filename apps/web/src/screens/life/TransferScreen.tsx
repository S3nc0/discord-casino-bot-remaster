import { useEffect, useState } from 'react';
import {
  Avatar,
  Banner,
  Button,
  Card,
  Chip,
  ChipGroup,
  Dialog,
  List,
  ListItem,
  Progress,
  TextField,
} from '@casino/ui';
import type { TransferMember, TransferPreview, TransferView } from '@casino/shared';
import { formatPelica, useLocale, useT } from '../../shell/i18n.ts';
import { useLifeApi } from './api.tsx';
import { errorMessage, pushToast, useIntent, useLoad, usePlay } from './hooks.ts';
import { LifeApiError } from './client.ts';
import { Await, LifeFrame } from './ui.tsx';

const QUICK = [100, 500, 1000, 5000] as const;

/** `1,000` typed by a person → 1000; anything that is not a whole positive number → 0. */
export function parseAmount(text: string): number {
  const digits = text.replace(/[,\s]/g, '');
  return /^[0-9]{1,7}$/.test(digits) ? Number(digits) : 0;
}

function Form({ view, onSent }: { view: TransferView; onSent: () => Promise<void> }) {
  const t = useT();
  const locale = useLocale();
  const api = useLifeApi();
  const intent = useIntent();
  const play = usePlay();
  const nf = new Intl.NumberFormat(locale);
  const [query, setQuery] = useState('');
  const [members, setMembers] = useState<TransferMember[]>([]);
  const [picked, setPicked] = useState<TransferMember | null>(null);
  const [amountText, setAmountText] = useState('');
  const [preview, setPreview] = useState<TransferPreview | null>(null);
  const [confirming, setConfirming] = useState(false);
  const amount = parseAmount(amountText);

  useEffect(() => {
    let alive = true;
    const id = setTimeout(() => {
      api
        .transferMembers(query.trim())
        .then((r) => alive && setMembers(r.members))
        .catch(() => alive && setMembers([]));
    }, 200);
    return () => {
      alive = false;
      clearTimeout(id);
    };
  }, [api, query]);

  useEffect(() => {
    if (!picked || amount < 1) {
      setPreview(null);
      return undefined;
    }
    let alive = true;
    const id = setTimeout(() => {
      api
        .transferPreview(picked.userId, amount)
        .then((r) => alive && setPreview(r))
        .catch(() => alive && setPreview(null));
    }, 250);
    return () => {
      alive = false;
      clearTimeout(id);
    };
  }, [api, picked, amount]);

  const blockedByDebt = view.debt > 0;
  const lockedByGames = view.gamesPlayed < view.minGames;
  const ready = !!picked && amount > 0 && preview?.ok === true && !blockedByDebt && !lockedByGames;

  const send = () => {
    if (!picked || preview?.ok !== true) return;
    const to = picked;
    const fee = preview.fee;
    setConfirming(false);
    void intent
      .run(`send:${to.userId}:${amount}`, (key) => api.transferSend(to.userId, amount, key))
      .then(async (r) => {
        if (!r) return;
        play('coin');
        pushToast('success', 'screen.life.transfer.sent', {
          amount: nf.format(r.amount),
          name: to.name,
          fee: nf.format(r.fee ?? fee),
        });
        setAmountText('');
        setPreview(null);
        await onSent();
      });
  };

  const previewError =
    preview && !preview.ok
      ? errorMessage(
          new LifeApiError('conflict', 409, { rule: preview.rule, params: preview.params }),
        )
      : null;

  return (
    <>
      {blockedByDebt ? (
        <Banner
          variant="warning"
          title={t('screen.life.transfer.debtBlocked', { debt: nf.format(view.debt) })}
        />
      ) : null}
      {lockedByGames ? (
        <Banner
          variant="info"
          title={t('screen.life.transfer.minGames', {
            min: view.minGames,
            played: view.gamesPlayed,
          })}
        />
      ) : null}
      <Card variant="filled" title={t('screen.life.transfer.to')}>
        {picked ? (
          <div className="life__row">
            <span className="life__picked">
              <Avatar>{picked.name.slice(0, 1).toUpperCase()}</Avatar> {picked.name}
            </span>
            <Button variant="text" onClick={() => setPicked(null)}>
              {t('common.cancel')}
            </Button>
          </div>
        ) : (
          <>
            <TextField
              label={t('screen.life.transfer.search')}
              value={query}
              autoComplete="off"
              onChange={(e) => setQuery(e.target.value)}
            />
            {members.length === 0 ? (
              <p className="life__note">{t('screen.life.transfer.noMatch')}</p>
            ) : (
              <List label={t('screen.life.transfer.to')} selectable>
                {members.map((m) => (
                  <ListItem
                    key={m.userId}
                    headline={m.name}
                    leading={<Avatar>{m.name.slice(0, 1).toUpperCase()}</Avatar>}
                    onSelect={() => setPicked(m)}
                  />
                ))}
              </List>
            )}
          </>
        )}
      </Card>
      <Card variant="filled" title={t('screen.life.transfer.amount')}>
        <TextField
          label={t('screen.life.transfer.amount')}
          value={amountText}
          inputMode="numeric"
          autoComplete="off"
          onChange={(e) => setAmountText(e.target.value)}
          helperText={t('screen.life.transfer.feeNote')}
        />
        <ChipGroup label={t('screen.life.transfer.amount')}>
          {QUICK.map((n) => (
            <Chip key={n} selected={amount === n} onClick={() => setAmountText(String(n))}>
              {nf.format(n)}
            </Chip>
          ))}
        </ChipGroup>
        {preview?.ok ? (
          <dl className="life__sum" aria-live="polite">
            <dt>{t('screen.life.transfer.fee')}</dt>
            <dd>{formatPelica(locale, preview.fee)}</dd>
            <dt>{t('screen.life.transfer.total')}</dt>
            <dd className="life__sum-total">{formatPelica(locale, preview.total)}</dd>
          </dl>
        ) : null}
        {preview?.ok && preview.receiverWithheld > 0 ? (
          <p className="life__note">
            {t('screen.life.transfer.withheld', { n: nf.format(preview.receiverWithheld) })}
          </p>
        ) : null}
        {previewError ? (
          <p className="life__error" role="alert">
            {t(previewError.key, previewError.params)}
          </p>
        ) : null}
        {!picked ? <p className="life__note">{t('screen.life.transfer.pick')}</p> : null}
        <Button
          disabled={!ready || intent.busy}
          onClick={() => (preview?.ok && preview.needsConfirm ? setConfirming(true) : send())}
        >
          {t('screen.life.transfer.send')}
        </Button>
      </Card>
      <Progress
        label={t('screen.life.transfer.limit', {
          sent: nf.format(view.sentToday),
          limit: nf.format(view.dailyLimit),
        })}
        value={view.sentToday}
        max={view.dailyLimit}
        valueLabel=""
      />
      <p className="life__note">
        {t('screen.life.transfer.big', { n: nf.format(view.confirmFrom) })}
      </p>
      <Dialog
        open={confirming}
        onClose={() => setConfirming(false)}
        title={t('screen.life.transfer.confirmTitle')}
        description={
          picked && preview?.ok
            ? t('screen.life.transfer.confirmBody', {
                name: picked.name,
                amount: nf.format(preview.amount),
                fee: nf.format(preview.fee),
                total: nf.format(preview.total),
              })
            : undefined
        }
        actions={
          <>
            <Button variant="text" onClick={() => setConfirming(false)}>
              {t('common.cancel')}
            </Button>
            <Button onClick={send}>{t('screen.life.transfer.send')}</Button>
          </>
        }
      />
    </>
  );
}

export default function TransferScreen() {
  const api = useLifeApi();
  const state = useLoad(() => api.transfer());
  return (
    <LifeFrame screen="transfer" icon="transfer">
      <Await state={state}>{(v) => <Form view={v} onSent={state.reload} />}</Await>
    </LifeFrame>
  );
}
