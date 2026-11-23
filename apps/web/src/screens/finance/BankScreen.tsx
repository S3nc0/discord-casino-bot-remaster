import { useState } from 'react';
import { FINANCE_ROUTES, type FinanceRepayRequest } from '@casino/shared';
import { Button, Progress, Tag, type TagHue } from '@casino/ui';
import { useT } from '../../shell/i18n.ts';
import { useFinanceClient } from './client.ts';
import { useAction, useInt, useNumber, usePelica, useTimeLeft, useView } from './hooks.ts';
import {
  AmountField,
  Empty,
  ErrorBanner,
  LoadError,
  Panel,
  ScreenFrame,
  Stat,
  Stats,
} from './parts.tsx';
import { BankScene } from './scenes/BankScene.tsx';

const STATUS_HUE: Record<string, TagHue> = {
  katagi: 'green',
  underground: 'yellow',
  bankrupt: 'red',
};

/** Teiai Bank: what you hold, what you owe, the grace window and the way to repay. */
export default function BankScreen() {
  const t = useT();
  const client = useFinanceClient();
  const pelica = usePelica();
  const num = useNumber();
  const timeLeft = useTimeLeft();
  const { data, error, reload } = useView(FINANCE_ROUTES.bank, 30_000);
  // each repayment that goes through turns the vault wheel in the scene
  const [paid, setPaid] = useState(0);
  const action = useAction(async () => {
    setPaid((n) => n + 1);
    await reload();
  });
  const [text, setText, amount] = useInt();

  if (!data)
    return (
      <ScreenFrame
        scene={<BankScene paid={paid} />}
        screen="bank"
        icon="bank"
        title={t('screen.bank')}
      >
        <LoadError failed={error !== null} onRetry={() => void reload()} />
      </ScreenFrame>
    );

  const repay = (all: boolean) => {
    const body = (key: string): FinanceRepayRequest => ({
      idempotencyKey: key,
      ...(all || amount === undefined ? {} : { amount }),
    });
    void action.run(
      `repay:${all ? 'all' : (amount ?? 'all')}`,
      (key) => client.post(FINANCE_ROUTES.bankRepay, body(key)),
      {
        key: 'screen.finance.bank.repaid',
        params: (r) => ({ amount: pelica(r.amount ?? 0), debt: pelica(r.remainingDebt ?? 0) }),
      },
    );
    if (all) setText('');
  };

  const owing = data.debt > 0;
  const ratio = data.bank.ratio;
  return (
    <ScreenFrame
      scene={<BankScene paid={paid} />}
      screen="bank"
      icon="bank"
      title={t('screen.bank')}
      lead={t('screen.finance.bank.lead')}
    >
      <Panel title={t('screen.finance.bank.you')} tone="elevated">
        <Stats>
          <Stat label={t('screen.finance.balance')} value={pelica(data.balance)} />
          <Stat
            label={t('screen.finance.bank.debt')}
            value={pelica(data.debt)}
            tone={owing ? 'bad' : 'good'}
          />
          {data.deposit > 0 ? (
            <Stat label={t('screen.finance.bank.deposit')} value={pelica(data.deposit)} />
          ) : null}
          <Stat
            label={t('screen.finance.bank.status')}
            value={
              <Tag hue={STATUS_HUE[data.status] ?? 'neutral'}>
                {t(`screen.finance.bank.status.${data.status}`)}
              </Tag>
            }
          />
        </Stats>
        {data.inGrace && data.graceUntil !== null ? (
          <div role="alert" className="fin__notice fin__notice--warn">
            <strong>{t('screen.finance.bank.graceTitle')}</strong>
            <span>{t('screen.finance.bank.graceBody', { time: timeLeft(data.graceUntil) })}</span>
          </div>
        ) : null}
        {owing && !data.inGrace ? (
          <Progress
            label={t('screen.finance.bank.toGrace', { limit: pelica(data.graceDebt) })}
            value={data.debt}
            max={data.graceDebt}
            valueLabel={`${num(data.debt)} / ${num(data.graceDebt)}`}
          />
        ) : null}
        {data.blacklistUntil !== null && data.blacklistUntil > Date.now() ? (
          <p className="fin__note">
            {t('screen.finance.bank.blacklist', { time: timeLeft(data.blacklistUntil) })}
          </p>
        ) : null}
      </Panel>

      <Panel
        title={t('screen.finance.bank.repayTitle')}
        hint={owing ? t('screen.finance.bank.repayHint') : undefined}
      >
        {owing ? (
          <>
            <AmountField
              label={t('screen.finance.amount')}
              value={text}
              onChange={setText}
              helper={t('screen.finance.bank.amountHelp')}
            />
            <ErrorBanner message={action.error} />
            <div className="fin__actions">
              <Button disabled={action.busy || amount === undefined} onClick={() => repay(false)}>
                {t('screen.finance.bank.repay')}
              </Button>
              <Button variant="tonal" disabled={action.busy} onClick={() => repay(true)}>
                {t('screen.finance.bank.repayAll')}
              </Button>
            </div>
          </>
        ) : (
          <Empty>{t('screen.finance.bank.noDebt')}</Empty>
        )}
      </Panel>

      <Panel title={t('screen.finance.bank.reserve')} tone="outlined">
        <Stats>
          <Stat label={t('screen.finance.bank.cash')} value={pelica(data.bank.available)} />
          <Stat
            label={t('screen.finance.bank.ratio')}
            value={ratio === null ? '—' : `${num(ratio * 100, 1)}%`}
          />
          <Stat
            label={t('screen.finance.bank.level')}
            value={t(`screen.finance.bank.liquidity.${data.bank.level}`)}
          />
          <Stat
            label={t('screen.finance.bank.trust')}
            value={`${num(data.bank.trustRate * 100, 2)}%`}
          />
        </Stats>
      </Panel>
    </ScreenFrame>
  );
}
