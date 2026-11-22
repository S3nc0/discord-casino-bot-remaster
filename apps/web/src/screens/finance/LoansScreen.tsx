import { useState } from 'react';
import {
  FINANCE_ROUTES,
  type FinanceLoanAskRequest,
  type FinanceLoanOfferRequest,
  type FinanceLoanRefRequest,
  type FinanceLoanRepayRequest,
  type FinanceLoanView,
  type FinanceLoansView,
} from '@casino/shared';
import { Button, Card, Tabs, Tag, TextField, type TagHue } from '@casino/ui';
import { useT } from '../../shell/i18n.ts';
import { useFinanceClient } from './client.ts';
import {
  useAction,
  useInt,
  useNumber,
  usePelica,
  usePeople,
  useTimeLeft,
  useView,
  type Action,
} from './hooks.ts';
import {
  AmountField,
  ChoiceChips,
  Empty,
  ErrorBanner,
  LoadError,
  Panel,
  PersonPicker,
  ScreenFrame,
} from './parts.tsx';

const STATUS_HUE: Partial<Record<FinanceLoanView['status'], TagHue>> = {
  offer: 'sky',
  request: 'sky',
  active: 'green',
  overdue: 'red',
  repaid: 'neutral',
};
const TERMS = [1, 3, 7, 14, 30] as const;

function LoanCard({ loan, action }: { loan: FinanceLoanView; action: Action }) {
  const t = useT();
  const client = useFinanceClient();
  const pelica = usePelica();
  const num = useNumber();
  const timeLeft = useTimeLeft();
  const [text, setText, amount] = useInt();
  const live = loan.status === 'active' || loan.status === 'overdue';
  const send = (route: string, body: (key: string) => FinanceLoanRefRequest, success: string) =>
    void action.run(`${route}:${loan.id}`, (key) => client.post(route, body(key)), {
      key: success,
      params: (r) => ({ amount: pelica(r.amount ?? loan.principal) }),
    });
  const ref = (key: string): FinanceLoanRefRequest => ({ idempotencyKey: key, loanId: loan.id });
  const name = loan.counterparty?.name ?? t('screen.finance.loans.nobody');
  const mineRequest = loan.status === 'request' && loan.role === 'borrower';
  const mineOffer = loan.status === 'offer' && loan.role === 'lender';

  return (
    <Card variant="outlined" className="fin-row" data-loan={loan.id} data-status={loan.status}>
      <div className="fin-row__head">
        <strong>{t(`screen.finance.loans.role.${loan.role}`, { name })}</strong>
        <Tag hue={STATUS_HUE[loan.status] ?? 'neutral'}>
          {t(`screen.finance.loans.status.${loan.status}`)}
        </Tag>
      </div>
      <p className="fin-row__meta">
        {t('screen.finance.loans.terms', {
          principal: pelica(loan.principal),
          rate: num(loan.rateBps / 100, 2),
          days: loan.termDays,
        })}
      </p>
      {live ? (
        <p className="fin-row__meta">
          {t('screen.finance.loans.remaining', { amount: pelica(loan.remaining) })}
          {loan.dueAt !== null
            ? ` · ${t('screen.finance.loans.due', { time: timeLeft(loan.dueAt) })}`
            : ''}
        </p>
      ) : null}
      {loan.status === 'offer' || loan.status === 'request' ? (
        <p className="fin-row__meta">
          {t('screen.finance.loans.expires', { time: timeLeft(loan.offerExpiresAt) })}
        </p>
      ) : null}
      <div className="fin__actions">
        {loan.status === 'offer' && loan.role === 'borrower' ? (
          <>
            <Button
              disabled={action.busy}
              onClick={() => send(FINANCE_ROUTES.loanAccept, ref, 'screen.finance.loans.accepted')}
            >
              {t('screen.finance.loans.accept')}
            </Button>
            <Button
              variant="outlined"
              disabled={action.busy}
              onClick={() => send(FINANCE_ROUTES.loanDecline, ref, 'screen.finance.loans.declined')}
            >
              {t('screen.finance.loans.decline')}
            </Button>
          </>
        ) : null}
        {loan.role === 'open' ? (
          <Button
            disabled={action.busy}
            onClick={() => send(FINANCE_ROUTES.loanLend, ref, 'screen.finance.loans.lent')}
          >
            {t('screen.finance.loans.lend', { amount: pelica(loan.principal) })}
          </Button>
        ) : null}
        {mineRequest || mineOffer ? (
          <Button
            variant="outlined"
            disabled={action.busy}
            onClick={() => send(FINANCE_ROUTES.loanCancel, ref, 'screen.finance.loans.cancelled')}
          >
            {t('screen.finance.loans.cancel')}
          </Button>
        ) : null}
      </div>
      {live && loan.role === 'borrower' ? (
        <div className="fin-inline">
          <AmountField label={t('screen.finance.amount')} value={text} onChange={setText} />
          <Button
            disabled={action.busy}
            onClick={() => {
              const body = (key: string): FinanceLoanRepayRequest => ({
                idempotencyKey: key,
                loanId: loan.id,
                ...(amount === undefined ? {} : { amount }),
              });
              void action
                .run(
                  `repay:${loan.id}:${amount ?? 'all'}`,
                  (key) => client.post(FINANCE_ROUTES.loanRepay, body(key)),
                  {
                    key: 'screen.finance.loans.repaid',
                    params: (r) => ({ amount: pelica(r.amount ?? 0) }),
                  },
                )
                .then(() => setText(''));
            }}
          >
            {amount === undefined
              ? t('screen.finance.loans.repayAll')
              : t('screen.finance.loans.repay')}
          </Button>
        </div>
      ) : null}
    </Card>
  );
}

function Composer({ limits, action }: { limits: FinanceLoansView['limits']; action: Action }) {
  const t = useT();
  const client = useFinanceClient();
  const pelica = usePelica();
  const people = usePeople();
  const [mode, setMode] = useState<'offer' | 'request'>('offer');
  const [borrower, setBorrower] = useState<string | null>(null);
  const [principalText, setPrincipalText, principal] = useInt();
  const [rateText, setRateText] = useState('1');
  const [days, setDays] = useState<number>(7);
  const rateBps = Math.round(Number(rateText.replace(',', '.')) * 100);
  const rateOk = Number.isFinite(rateBps) && rateBps >= 0 && rateBps <= 10_000;
  const ready =
    principal !== undefined &&
    principal >= limits.minPrincipal &&
    rateOk &&
    (mode === 'request' || borrower !== null);

  const submit = () => {
    if (principal === undefined) return;
    const sig = `${mode}:${borrower}:${principal}:${rateBps}:${days}`;
    if (mode === 'offer' && borrower) {
      const body = (key: string): FinanceLoanOfferRequest => ({
        idempotencyKey: key,
        borrowerId: borrower,
        principal,
        rateBps,
        termDays: days,
      });
      void action.run(sig, (key) => client.post(FINANCE_ROUTES.loanOffer, body(key)), {
        key: 'screen.finance.loans.offered',
        params: () => ({ amount: pelica(principal) }),
      });
    } else {
      const body = (key: string): FinanceLoanAskRequest => ({
        idempotencyKey: key,
        principal,
        rateBps,
        termDays: days,
      });
      void action.run(sig, (key) => client.post(FINANCE_ROUTES.loanRequest, body(key)), {
        key: 'screen.finance.loans.asked',
        params: () => ({ amount: pelica(principal) }),
      });
    }
  };

  const form = (
    <div className="fin-form">
      {mode === 'offer' ? (
        <PersonPicker
          label={t('screen.finance.loans.to')}
          people={people}
          value={borrower}
          onChange={setBorrower}
        />
      ) : null}
      <AmountField
        label={t('screen.finance.loans.principal')}
        value={principalText}
        onChange={setPrincipalText}
        helper={t('screen.finance.loans.minimum', { amount: pelica(limits.minPrincipal) })}
      />
      <TextField
        label={t('screen.finance.loans.rate')}
        value={rateText}
        inputMode="decimal"
        autoComplete="off"
        onChange={(e) => setRateText(e.target.value.replace(/[^0-9.,]/g, '').slice(0, 6))}
        helperText={t('screen.finance.loans.rateHelp')}
      />
      <ChoiceChips
        label={t('screen.finance.loans.term')}
        options={TERMS.map((d) => ({
          value: d,
          label: t('screen.finance.loans.days', { days: d }),
        }))}
        value={days}
        onChange={setDays}
      />
      <div className="fin__actions">
        <Button disabled={!ready || action.busy} onClick={submit}>
          {mode === 'offer'
            ? t('screen.finance.loans.sendOffer')
            : t('screen.finance.loans.sendRequest')}
        </Button>
      </div>
    </div>
  );
  return (
    <Panel title={t('screen.finance.loans.new')}>
      <Tabs
        label={t('screen.finance.loans.new')}
        activeId={mode}
        onChange={(id) => setMode(id === 'request' ? 'request' : 'offer')}
        tabs={[
          { id: 'offer', label: t('screen.finance.loans.tabOffer'), panel: form },
          { id: 'request', label: t('screen.finance.loans.tabRequest'), panel: form },
        ]}
      />
    </Panel>
  );
}

/** Player loans: offers and requests, repayments, and the list of everything you are part of. */
export default function LoansScreen() {
  const t = useT();
  const { data, error, reload } = useView(FINANCE_ROUTES.loans, 30_000);
  const action = useAction(reload);
  if (!data)
    return (
      <ScreenFrame screen="loans" icon="coin" title={t('screen.loans')}>
        <LoadError failed={error !== null} onRetry={() => void reload()} />
      </ScreenFrame>
    );
  const mine = data.loans.filter((l) => l.role !== 'open');
  const open = data.loans.filter((l) => l.role === 'open');
  return (
    <ScreenFrame
      screen="loans"
      icon="coin"
      title={t('screen.loans')}
      lead={t('screen.finance.loans.lead')}
    >
      <ErrorBanner message={action.error} />
      <Panel title={t('screen.finance.loans.mine')}>
        {mine.length === 0 ? (
          <Empty>{t('screen.finance.loans.none')}</Empty>
        ) : (
          mine.map((l) => <LoanCard key={l.id} loan={l} action={action} />)
        )}
      </Panel>
      <Panel title={t('screen.finance.loans.board')} hint={t('screen.finance.loans.boardHint')}>
        {open.length === 0 ? (
          <Empty>{t('screen.finance.loans.noneOpen')}</Empty>
        ) : (
          open.map((l) => <LoanCard key={l.id} loan={l} action={action} />)
        )}
      </Panel>
      <Composer limits={data.limits} action={action} />
    </ScreenFrame>
  );
}
