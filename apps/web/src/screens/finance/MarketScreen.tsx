import { useState } from 'react';
import {
  FINANCE_ROUTES,
  PRICE_SCALE,
  QUANTITY_SCALE,
  type FinanceBondRequest,
  type FinanceMarginRequest,
  type FinanceMarketView,
  type FinanceOptionRequest,
  type FinanceSettleRequest,
  type FinanceSpotRequest,
  type FinanceSymbol,
  type FinanceSymbolView,
} from '@casino/shared';
import { Banner, Button, Card, Tabs, Tag } from '@casino/ui';
import { useT } from '../../shell/i18n.ts';
import { useFinanceClient } from './client.ts';
import {
  useAction,
  useInt,
  useNumber,
  usePelica,
  useSymbolName,
  useTimeLeft,
  useView,
  type Action,
} from './hooks.ts';
import { ListingsPanel } from './ListingsPanel.tsx';
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
import { PixelChart } from './PixelChart.tsx';

type Mode = 'spot' | 'margin' | 'call' | 'put' | 'pair' | 'bond';
const MODES: readonly Mode[] = ['spot', 'margin', 'call', 'put', 'pair', 'bond'];

const trend = (bps: number): 'up' | 'down' | 'flat' => (bps > 0 ? 'up' : bps < 0 ? 'down' : 'flat');

function Board({
  symbols,
  onPick,
}: {
  symbols: readonly FinanceSymbolView[];
  onPick: (s: FinanceSymbol) => void;
}) {
  const t = useT();
  const num = useNumber();
  const symbolName = useSymbolName();
  return (
    <div className="fin-board">
      {symbols.map((s) => {
        const name = symbolName(s.key);
        const change = `${s.changeBps > 0 ? '+' : ''}${num(s.changeBps / 100, 2)}%`;
        const price = num(s.priceMicros / PRICE_SCALE, 2);
        return (
          <Card
            key={s.key}
            variant="filled"
            className="fin-symbol bb-state"
            data-symbol={s.key}
            data-trend={trend(s.changeBps)}
            onClick={() => onPick(s.key)}
          >
            <div className="fin-symbol__head">
              <strong>{name}</strong>
              <Tag hue={s.changeBps > 0 ? 'green' : s.changeBps < 0 ? 'red' : 'neutral'}>
                {change}
              </Tag>
            </div>
            <p className="fin-symbol__price">{price}</p>
            <PixelChart
              points={s.history}
              label={t('screen.finance.market.chartLabel', { name, change })}
            />
            {s.pin !== 0 ? (
              <Tag hue="amber">
                {t(s.pin > 0 ? 'screen.finance.market.limitUp' : 'screen.finance.market.limitDown')}
              </Tag>
            ) : null}
          </Card>
        );
      })}
    </div>
  );
}

function Trade({
  view,
  symbol,
  setSymbol,
  action,
  onBought,
}: {
  view: FinanceMarketView;
  symbol: FinanceSymbol;
  setSymbol: (s: FinanceSymbol) => void;
  action: Action;
  onBought: () => void;
}) {
  const t = useT();
  const client = useFinanceClient();
  const pelica = usePelica();
  const [mode, setMode] = useState<Mode>('spot');
  const [text, setText, amount] = useInt();
  const [side, setSide] = useState<'long' | 'short'>('long');
  const [leverage, setLeverage] = useState(2);
  const [other, setOther] = useState<FinanceSymbol>('gold');
  const [bond, setBond] = useState<'normal' | 'junk'>('normal');
  const second =
    other === symbol ? (view.symbols.find((s) => s.key !== symbol)?.key ?? other) : other;
  const bondInfo = view.limits.bonds.find((b) => b.key === bond);

  const send = () => {
    if (amount === undefined) return;
    const sig = `${mode}:${symbol}:${amount}:${side}:${leverage}:${second}:${bond}`;
    const done = (key: string, params?: Record<string, string>) => ({
      key,
      params: () => ({ symbol: symbol.toUpperCase(), amount: pelica(amount), ...params }),
    });
    let run: Promise<boolean>;
    if (mode === 'spot') {
      const body = (k: string): FinanceSpotRequest => ({ idempotencyKey: k, symbol, amount });
      run = action.run(
        sig,
        (k) => client.post(FINANCE_ROUTES.marketSpot, body(k)),
        done('screen.finance.market.bought'),
      );
    } else if (mode === 'margin') {
      const body = (k: string): FinanceMarginRequest => ({
        idempotencyKey: k,
        symbol,
        side,
        amount,
        leverage,
      });
      run = action.run(
        sig,
        (k) => client.post(FINANCE_ROUTES.marketMargin, body(k)),
        done('screen.finance.market.marginOpened'),
      );
    } else if (mode === 'bond') {
      const body = (k: string): FinanceBondRequest => ({ idempotencyKey: k, kind: bond, amount });
      run = action.run(
        sig,
        (k) => client.post(FINANCE_ROUTES.marketBond, body(k)),
        done('screen.finance.market.bondBought'),
      );
    } else {
      const body = (k: string): FinanceOptionRequest => ({
        idempotencyKey: k,
        kind: mode,
        symbol,
        ...(mode === 'pair' ? { symbolB: second } : {}),
        premium: amount,
      });
      run = action.run(
        sig,
        (k) => client.post(FINANCE_ROUTES.marketOption, body(k)),
        done('screen.finance.market.optionBought'),
      );
    }
    void run.then((ok) => {
      if (ok) {
        setText('');
        onBought();
      }
    });
  };

  const symbolOptions = view.symbols.map((s) => ({ value: s.key, label: s.key.toUpperCase() }));
  const amountLabel =
    mode === 'margin'
      ? t('screen.finance.market.marginAmount')
      : mode === 'spot' || mode === 'bond'
        ? t('screen.finance.amount')
        : t('screen.finance.market.premium');
  return (
    <Panel title={t('screen.finance.market.trade')} tone="elevated">
      <ChoiceChips
        label={t('screen.finance.market.symbol')}
        options={symbolOptions}
        value={symbol}
        onChange={setSymbol}
      />
      <ChoiceChips
        label={t('screen.finance.market.kind')}
        options={MODES.map((m) => ({ value: m, label: t(`screen.finance.market.mode.${m}`) }))}
        value={mode}
        onChange={setMode}
      />
      <p className="fin__note">{t(`screen.finance.market.modeHelp.${mode}`)}</p>
      {mode === 'margin' ? (
        <>
          <ChoiceChips
            label={t('screen.finance.market.side')}
            options={[
              { value: 'long', label: t('screen.finance.market.long') },
              { value: 'short', label: t('screen.finance.market.short') },
            ]}
            value={side}
            onChange={setSide}
          />
          <ChoiceChips
            label={t('screen.finance.market.leverage')}
            options={view.limits.leverages.map((l) => ({ value: l, label: `${l}×` }))}
            value={leverage}
            onChange={setLeverage}
          />
        </>
      ) : null}
      {mode === 'pair' ? (
        <ChoiceChips
          label={t('screen.finance.market.counterpart')}
          options={symbolOptions.filter((o) => o.value !== symbol)}
          value={second}
          onChange={setOther}
        />
      ) : null}
      {mode === 'bond' ? (
        <>
          <ChoiceChips
            label={t('screen.finance.market.bondKind')}
            options={view.limits.bonds.map((b) => ({
              value: b.key,
              label: t(`screen.finance.market.bond.${b.key}`),
            }))}
            value={bond}
            onChange={setBond}
          />
          {bondInfo ? (
            <p className="fin__note">
              {t('screen.finance.market.bondInfo', {
                hours: bondInfo.hours,
                rate: bondInfo.ratePct,
                max: pelica(bondInfo.maxTotal),
                min: pelica(view.limits.bondMin),
              })}
            </p>
          ) : null}
        </>
      ) : null}
      <AmountField label={amountLabel} value={text} onChange={setText} />
      <ErrorBanner message={action.error} />
      <div className="fin__actions">
        <Button disabled={action.busy || amount === undefined} onClick={send}>
          {t(`screen.finance.market.do.${mode}`)}
        </Button>
      </div>
    </Panel>
  );
}

function Holdings({ view, action }: { view: FinanceMarketView; action: Action }) {
  const t = useT();
  const client = useFinanceClient();
  const pelica = usePelica();
  const num = useNumber();
  const timeLeft = useTimeLeft();
  const settle = (position: string) => {
    const body = (key: string): FinanceSettleRequest => ({ idempotencyKey: key, position });
    void action.run(
      `settle:${position}`,
      (key) => client.post(FINANCE_ROUTES.marketSettle, body(key)),
      {
        key: 'screen.finance.market.settled',
        params: (r) => ({ amount: pelica(r.amount ?? r.returned ?? 0) }),
      },
    );
  };
  const units = (milli: number) => num(milli / QUANTITY_SCALE, 3);
  const none =
    view.spot.length + view.margin.length + view.options.length + view.bonds.length === 0;
  const health =
    view.portfolio.required > 0 ? view.portfolio.equity / view.portfolio.required : null;
  return (
    <Panel title={t('screen.finance.market.holdings')}>
      {view.portfolio.required > 0 ? (
        <>
          <Stats>
            <Stat label={t('screen.finance.market.equity')} value={num(view.portfolio.equity)} />
            <Stat
              label={t('screen.finance.market.required')}
              value={num(view.portfolio.required)}
            />
            <Stat
              label={t('screen.finance.market.health')}
              value={health === null ? '—' : `${num(health * 100)}%`}
              tone={health !== null && health < 1.3 ? 'warn' : 'good'}
            />
          </Stats>
          {health !== null && health < 1.3 ? (
            <Banner variant="warning" title={t('screen.finance.market.losscutWarn')} />
          ) : null}
        </>
      ) : null}
      {none ? <Empty>{t('screen.finance.market.noHoldings')}</Empty> : null}
      {view.spot.map((h) => (
        <Card
          key={`spot-${h.symbol}`}
          variant="outlined"
          className="fin-row"
          data-position={`spot:${h.symbol}`}
        >
          <div className="fin-row__head">
            <strong>
              {t('screen.finance.market.spotRow', {
                symbol: h.symbol.toUpperCase(),
                units: units(h.unitsMilli),
              })}
            </strong>
            <Tag
              hue={h.value >= h.cost ? 'green' : 'red'}
            >{`${h.value >= h.cost ? '+' : ''}${num(h.value - h.cost)}`}</Tag>
          </div>
          <p className="fin-row__meta">
            {t('screen.finance.market.valueCost', { value: pelica(h.value), cost: pelica(h.cost) })}
          </p>
          <div className="fin__actions">
            <Button
              variant="tonal"
              disabled={action.busy}
              onClick={() => settle(`spot:${h.symbol}`)}
            >
              {t('screen.finance.market.sell')}
            </Button>
          </div>
        </Card>
      ))}
      {view.margin.map((m) => (
        <Card
          key={`${m.side}-${m.symbol}`}
          variant="outlined"
          className="fin-row"
          data-position={`${m.side}:${m.symbol}`}
        >
          <div className="fin-row__head">
            <strong>
              {t(
                m.side === 'long'
                  ? 'screen.finance.market.longRow'
                  : 'screen.finance.market.shortRow',
                { symbol: m.symbol.toUpperCase(), units: units(m.unitsMilli) },
              )}
            </strong>
            <Tag hue="orange">
              {t('screen.finance.market.marginTag', { amount: pelica(m.margin) })}
            </Tag>
          </div>
          <div className="fin__actions">
            <Button
              variant="tonal"
              disabled={action.busy}
              onClick={() => settle(`${m.side}:${m.symbol}`)}
            >
              {t('screen.finance.market.close')}
            </Button>
          </div>
        </Card>
      ))}
      {view.options.map((o) => (
        <Card
          key={`o-${o.id}`}
          variant="outlined"
          className="fin-row"
          data-position={`option:${o.id}`}
        >
          <div className="fin-row__head">
            <strong>
              {t('screen.finance.market.optionRow', {
                id: o.id,
                kind: t(`screen.finance.market.mode.${o.kind}`),
                symbol: o.symbol.toUpperCase() + (o.symbolB ? `/${o.symbolB.toUpperCase()}` : ''),
              })}
            </strong>
            <Tag hue={o.side === 'long' ? 'sky' : 'violet'}>
              {t(
                o.side === 'long' ? 'screen.finance.market.long' : 'screen.finance.market.written',
              )}
            </Tag>
          </div>
          <p className="fin-row__meta">
            {t('screen.finance.market.expires', { time: timeLeft(o.expiresAt) })}
          </p>
          <div className="fin__actions">
            <Button variant="tonal" disabled={action.busy} onClick={() => settle(`option:${o.id}`)}>
              {t(
                o.side === 'long' ? 'screen.finance.market.sell' : 'screen.finance.market.buyback',
              )}
            </Button>
          </div>
        </Card>
      ))}
      {view.bonds.map((b) => (
        <Card
          key={`b-${b.id}`}
          variant="outlined"
          className="fin-row"
          data-position={`bond:${b.id}`}
        >
          <div className="fin-row__head">
            <strong>
              {t('screen.finance.market.bondRow', { id: b.id, principal: pelica(b.principal) })}
            </strong>
            <Tag hue={b.kind === 'junk' ? 'orange' : 'teal'}>
              {t(`screen.finance.market.bond.${b.kind}`)}
            </Tag>
          </div>
          <p className="fin-row__meta">
            {t('screen.finance.market.bondRate', { rate: num(b.rateBps / 100, 2) })} ·{' '}
            {t('screen.finance.market.matures', { time: timeLeft(b.dueAt) })}
          </p>
          <div className="fin__actions">
            <Button
              variant="tonal"
              disabled={action.busy || b.kind === 'junk'}
              onClick={() => settle(`bond:${b.id}`)}
            >
              {t('screen.finance.market.sell')}
            </Button>
          </div>
        </Card>
      ))}
    </Panel>
  );
}

export interface MarketScreenProps {
  initialTab?: 'board' | 'trade' | 'holdings' | 'listings';
  initialSymbol?: FinanceSymbol;
  screen?: 'market' | 'stocks' | 'crypto';
}

/** The securities market (board, trade, holdings) and the player market, in one screen. */
export default function MarketScreen({
  initialTab = 'board',
  initialSymbol = 'cs',
  screen = 'market',
}: MarketScreenProps) {
  const t = useT();
  const { data, error, reload } = useView(FINANCE_ROUTES.market, 30_000);
  const action = useAction(reload);
  const [tab, setTab] = useState<string>(initialTab);
  const [symbol, setSymbol] = useState<FinanceSymbol>(initialSymbol);
  const title = t(`screen.${screen}`);
  if (!data)
    return (
      <ScreenFrame screen={screen} icon="stocks" title={title}>
        <LoadError failed={error !== null} onRetry={() => void reload()} />
      </ScreenFrame>
    );
  return (
    <ScreenFrame screen={screen} icon="stocks" title={title} lead={t('screen.finance.market.lead')}>
      <Tabs
        label={title}
        activeId={tab}
        onChange={setTab}
        tabs={[
          {
            id: 'board',
            label: t('screen.finance.market.tabBoard'),
            panel: (
              <Board
                symbols={data.symbols}
                onPick={(s) => {
                  setSymbol(s);
                  setTab('trade');
                }}
              />
            ),
          },
          {
            id: 'trade',
            label: t('screen.finance.market.tabTrade'),
            panel: (
              <Trade
                view={data}
                symbol={symbol}
                setSymbol={setSymbol}
                action={action}
                onBought={() => setTab('holdings')}
              />
            ),
          },
          {
            id: 'holdings',
            label: t('screen.finance.market.tabHoldings'),
            panel: (
              <>
                <ErrorBanner message={action.error} />
                <Holdings view={data} action={action} />
              </>
            ),
          },
          {
            id: 'listings',
            label: t('screen.finance.market.tabListings'),
            panel: <ListingsPanel />,
          },
        ]}
      />
    </ScreenFrame>
  );
}
