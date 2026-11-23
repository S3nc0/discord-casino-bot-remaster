import { useState } from 'react';
import {
  FINANCE_COMPANY_KINDS,
  FINANCE_ROUTES,
  type FinanceCompaniesView,
  type FinanceCompanyDividendRequest,
  type FinanceCompanyFoundRequest,
  type FinanceCompanyFundRequest,
  type FinanceCompanyInvestRequest,
  type FinanceCompanyKind,
} from '@casino/shared';
import { Button, Card, Tag, TextField } from '@casino/ui';
import { useT } from '../../shell/i18n.ts';
import { useFinanceClient } from './client.ts';
import { useAction, useInt, useNumber, usePelica, useView, type Action } from './hooks.ts';
import {
  AmountField,
  ChoiceChips,
  Empty,
  ErrorBanner,
  LoadError,
  Panel,
  ScreenFrame,
  Stat,
  Stats,
} from './parts.tsx';

function Found({ view, action }: { view: FinanceCompaniesView; action: Action }) {
  const t = useT();
  const client = useFinanceClient();
  const pelica = usePelica();
  const [name, setName] = useState('');
  const [kind, setKind] = useState<FinanceCompanyKind>('farm');
  const trimmed = name.trim();
  return (
    <Panel
      title={t('screen.finance.companies.found')}
      hint={t('screen.finance.companies.foundHint', { cost: pelica(view.foundCost) })}
      tone="elevated"
    >
      <TextField
        label={t('screen.finance.companies.name')}
        value={name}
        maxLength={12}
        autoComplete="off"
        onChange={(e) => setName(e.target.value)}
      />
      <ChoiceChips
        label={t('screen.finance.companies.kind')}
        options={FINANCE_COMPANY_KINDS.map((k) => ({
          value: k,
          label: t(`screen.finance.companies.kind.${k}`),
        }))}
        value={kind}
        onChange={setKind}
      />
      <div className="fin__actions">
        <Button
          disabled={action.busy || trimmed === ''}
          onClick={() => {
            const body = (key: string): FinanceCompanyFoundRequest => ({
              idempotencyKey: key,
              name: trimmed,
              kind,
            });
            void action.run(
              `found:${trimmed}:${kind}`,
              (key) => client.post(FINANCE_ROUTES.companyFound, body(key)),
              {
                key: 'screen.finance.companies.founded',
                params: () => ({ name: trimmed }),
              },
            );
          }}
        >
          {t('screen.finance.companies.foundButton', { cost: pelica(view.foundCost) })}
        </Button>
      </div>
    </Panel>
  );
}

function Mine({ view, action }: { view: FinanceCompaniesView; action: Action }) {
  const t = useT();
  const client = useFinanceClient();
  const pelica = usePelica();
  const num = useNumber();
  const company = view.mine;
  const [fundText, setFundText, fund] = useInt();
  const [rateText, setRateText, rate] = useInt(
    company ? String(Math.round(company.dividendRateBps / 100)) : '',
  );
  if (!company) return null;
  const maxPct = view.dividendMaxBps / 100;
  return (
    <>
      <Panel
        title={company.name}
        hint={t('screen.finance.companies.summary', {
          kind: t(`screen.finance.companies.kind.${company.kind}`),
          level: company.level,
        })}
        tone="elevated"
      >
        <Stats>
          <Stat label={t('screen.finance.companies.funds')} value={pelica(company.funds)} />
          <Stat
            label={t('screen.finance.companies.output')}
            value={t('screen.finance.companies.perDay', { amount: pelica(company.dailyOutput) })}
          />
          <Stat
            label={t('screen.finance.companies.upkeep')}
            value={pelica(company.upkeep)}
            tone={company.unpaidDays > 0 ? 'bad' : undefined}
          />
          <Stat
            label={t('screen.finance.companies.investors')}
            value={`${num(company.investors)} · ${pelica(company.stakesTotal)}`}
          />
        </Stats>
        {company.unpaidDays > 0 ? (
          <p role="alert" className="fin__notice fin__notice--warn">
            {t('screen.finance.companies.unpaid', { days: company.unpaidDays })}
          </p>
        ) : null}
      </Panel>
      <Panel title={t('screen.finance.companies.fundTitle')}>
        <AmountField label={t('screen.finance.amount')} value={fundText} onChange={setFundText} />
        <div className="fin__actions">
          <Button
            disabled={action.busy || fund === undefined}
            onClick={() => {
              if (fund === undefined) return;
              const body = (key: string): FinanceCompanyFundRequest => ({
                idempotencyKey: key,
                amount: fund,
              });
              void action
                .run(`fund:${fund}`, (key) => client.post(FINANCE_ROUTES.companyFund, body(key)), {
                  key: 'screen.finance.companies.funded',
                  params: () => ({ amount: pelica(fund) }),
                })
                .then(() => setFundText(''));
            }}
          >
            {t('screen.finance.companies.fundButton')}
          </Button>
        </div>
      </Panel>
      <Panel
        title={t('screen.finance.companies.dividend')}
        hint={t('screen.finance.companies.dividendHint', { max: maxPct })}
      >
        <AmountField
          label={t('screen.finance.companies.dividendRate')}
          value={rateText}
          onChange={setRateText}
          suffix="%"
        />
        <div className="fin__actions">
          <Button
            variant="tonal"
            disabled={action.busy || rate === undefined || rate > maxPct}
            onClick={() => {
              if (rate === undefined) return;
              const body = (key: string): FinanceCompanyDividendRequest => ({
                idempotencyKey: key,
                rateBps: rate * 100,
              });
              void action.run(
                `div:${rate}`,
                (key) => client.post(FINANCE_ROUTES.companyDividend, body(key)),
                { key: 'screen.finance.companies.dividendSet', params: () => ({ rate }) },
              );
            }}
          >
            {t('screen.finance.companies.setDividend')}
          </Button>
        </div>
      </Panel>
    </>
  );
}

function StakeRow({
  other,
  view,
  action,
}: {
  other: FinanceCompaniesView['others'][number];
  view: FinanceCompaniesView;
  action: Action;
}) {
  const t = useT();
  const client = useFinanceClient();
  const pelica = usePelica();
  const [text, setText, amount] = useInt();
  return (
    <Card variant="outlined" className="fin-row" data-owner={other.owner.id}>
      <div className="fin-row__head">
        <strong>{other.name}</strong>
        <Tag hue={other.kind === 'farm' ? 'lime' : 'brown'}>
          {t(`screen.finance.companies.kind.${other.kind}`)}
        </Tag>
      </div>
      <p className="fin-row__meta">
        {t('screen.finance.companies.stakeInfo', {
          owner: other.owner.name,
          level: other.level,
          rate: other.dividendRateBps / 100,
          room: pelica(other.room),
        })}
      </p>
      <div className="fin-inline">
        <AmountField
          label={t('screen.finance.amount')}
          value={text}
          onChange={setText}
          helper={t('screen.finance.companies.stakeMin', { amount: pelica(view.stakeMin) })}
        />
        <Button
          disabled={
            action.busy || amount === undefined || amount < view.stakeMin || amount > other.room
          }
          onClick={() => {
            if (amount === undefined) return;
            const body = (key: string): FinanceCompanyInvestRequest => ({
              idempotencyKey: key,
              ownerId: other.owner.id,
              amount,
            });
            void action
              .run(
                `stake:${other.owner.id}:${amount}`,
                (key) => client.post(FINANCE_ROUTES.companyInvest, body(key)),
                {
                  key: 'screen.finance.companies.staked',
                  params: () => ({ amount: pelica(amount), name: other.name }),
                },
              )
              .then(() => setText(''));
          }}
        >
          {t('screen.finance.companies.invest')}
        </Button>
      </div>
    </Card>
  );
}

/** Companies: found yours, fund it, set the dividend, and take stakes in other players'. */
export default function CompaniesScreen() {
  const t = useT();
  const pelica = usePelica();
  const { data, error, reload } = useView(FINANCE_ROUTES.companies, 60_000);
  const action = useAction(reload);
  if (!data)
    return (
      <ScreenFrame screen="companies" icon="company" title={t('screen.companies')}>
        <LoadError failed={error !== null} onRetry={() => void reload()} />
      </ScreenFrame>
    );
  return (
    <ScreenFrame
      screen="companies"
      icon="company"
      title={t('screen.companies')}
      lead={t('screen.finance.companies.lead')}
    >
      <ErrorBanner message={action.error} />
      {data.mine ? <Mine view={data} action={action} /> : <Found view={data} action={action} />}
      <Panel title={t('screen.finance.companies.holdings')}>
        {data.holdings.length === 0 ? (
          <Empty>{t('screen.finance.companies.noHoldings')}</Empty>
        ) : null}
        {data.holdings.map((h) => (
          <Card key={h.owner.id} variant="outlined" className="fin-row" data-holding={h.owner.id}>
            <div className="fin-row__head">
              <strong>{h.name}</strong>
              <Tag hue="green">{`${h.dividendRateBps / 100}%`}</Tag>
            </div>
            <p className="fin-row__meta">
              {t('screen.finance.companies.holdingLine', {
                owner: h.owner.name,
                level: h.level,
                amount: pelica(h.amount),
                value: pelica(h.value),
              })}
            </p>
          </Card>
        ))}
      </Panel>
      <Panel
        title={t('screen.finance.companies.others')}
        hint={t('screen.finance.companies.othersHint')}
      >
        {data.others.length === 0 ? <Empty>{t('screen.finance.companies.noOthers')}</Empty> : null}
        {data.others.map((o) => (
          <StakeRow key={o.owner.id} other={o} view={data} action={action} />
        ))}
      </Panel>
    </ScreenFrame>
  );
}
