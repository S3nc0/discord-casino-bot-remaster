import { useState } from 'react';
import {
  FINANCE_ROUTES,
  type FinanceKyosaiBidRequest,
  type FinanceKyosaiOfferRefRequest,
  type FinanceKyosaiOfferRequest,
  type FinanceKyosaiProposeRequest,
  type FinanceKyosaiVoteRequest,
  type FinanceKyosaiView,
} from '@casino/shared';
import { Banner, Button, Card, Progress, Tag, TextField } from '@casino/ui';
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
  Empty,
  ErrorBanner,
  LoadError,
  Panel,
  PersonPicker,
  ScreenFrame,
  Stat,
  Stats,
} from './parts.tsx';

function AuctionPanel({ view, action }: { view: FinanceKyosaiView; action: Action }) {
  const t = useT();
  const client = useFinanceClient();
  const pelica = usePelica();
  const timeLeft = useTimeLeft();
  const [text, setText, amount] = useInt();
  const auction = view.auction;
  if (!auction) {
    return (
      <Panel title={t('screen.finance.kyosai.auction')}>
        <Empty>{t('screen.finance.kyosai.noAuction')}</Empty>
      </Panel>
    );
  }
  const bid = () => {
    if (amount === undefined) return;
    const body = (key: string): FinanceKyosaiBidRequest => ({ idempotencyKey: key, amount });
    void action
      .run(
        `bid:${auction.id}:${amount}`,
        (key) => client.post(FINANCE_ROUTES.kyosaiBid, body(key)),
        {
          key: 'screen.finance.kyosai.bidPlaced',
          params: () => ({ amount: pelica(amount) }),
        },
      )
      .then(() => setText(''));
  };
  return (
    <Panel title={t('screen.finance.kyosai.auction')} tone="elevated">
      <Stats>
        <Stat
          label={t('screen.finance.kyosai.lot')}
          value={t('screen.finance.kyosai.unitsCount', { units: auction.units })}
        />
        <Stat
          label={t('screen.finance.kyosai.topBid')}
          value={auction.topBid > 0 ? pelica(auction.topBid) : '—'}
        />
        <Stat
          label={t('screen.finance.kyosai.topBidder')}
          value={auction.youAreTop ? t('screen.finance.you') : (auction.topBidder?.name ?? '—')}
          tone={auction.youAreTop ? 'good' : undefined}
        />
        <Stat label={t('screen.finance.kyosai.ends')} value={timeLeft(auction.endsAt)} />
      </Stats>
      {view.locked ? (
        <Banner variant="warning" title={t('screen.finance.kyosai.locked')} />
      ) : (
        <>
          <AmountField
            label={t('screen.finance.kyosai.yourBid')}
            value={text}
            onChange={setText}
            helper={t('screen.finance.kyosai.bidHelp', { amount: pelica(auction.topBid + 1) })}
          />
          <div className="fin__actions">
            <Button
              disabled={action.busy || amount === undefined || amount <= auction.topBid}
              onClick={bid}
            >
              {t('screen.finance.kyosai.bid')}
            </Button>
          </div>
        </>
      )}
    </Panel>
  );
}

function OffersPanel({ view, action }: { view: FinanceKyosaiView; action: Action }) {
  const t = useT();
  const client = useFinanceClient();
  const pelica = usePelica();
  const timeLeft = useTimeLeft();
  const people = usePeople();
  const [buyer, setBuyer] = useState<string | null>(null);
  const [unitsText, setUnitsText, units] = useInt();
  const [priceText, setPriceText, price] = useInt();
  const ref = (key: string, offerId: number): FinanceKyosaiOfferRefRequest => ({
    idempotencyKey: key,
    offerId,
  });
  const offerReady =
    buyer !== null &&
    units !== undefined &&
    units >= 1 &&
    units <= view.units &&
    price !== undefined &&
    !view.locked;
  return (
    <Panel title={t('screen.finance.kyosai.offers')} hint={t('screen.finance.kyosai.offersHint')}>
      {view.offers.length === 0 ? <Empty>{t('screen.finance.kyosai.noOffers')}</Empty> : null}
      {view.offers.map((o) => (
        <Card key={o.id} variant="outlined" className="fin-row" data-offer={o.id}>
          <div className="fin-row__head">
            <strong>
              {t(`screen.finance.kyosai.offer.${o.direction}`, { name: o.counterparty.name })}
            </strong>
            <Tag hue={o.direction === 'incoming' ? 'sky' : 'neutral'}>
              {t('screen.finance.kyosai.unitsCount', { units: o.units })}
            </Tag>
          </div>
          <p className="fin-row__meta">
            {pelica(o.price)} ·{' '}
            {t('screen.finance.kyosai.expires', { time: timeLeft(o.expiresAt) })}
          </p>
          <div className="fin__actions">
            {o.direction === 'incoming' ? (
              <Button
                disabled={action.busy || view.locked}
                onClick={() =>
                  void action.run(
                    `accept:${o.id}`,
                    (key) => client.post(FINANCE_ROUTES.kyosaiAccept, ref(key, o.id)),
                    { key: 'screen.finance.kyosai.accepted', params: () => ({ units: o.units }) },
                  )
                }
              >
                {t('screen.finance.kyosai.accept', { price: pelica(o.price) })}
              </Button>
            ) : (
              <Button
                variant="outlined"
                disabled={action.busy}
                onClick={() =>
                  void action.run(
                    `cancel:${o.id}`,
                    (key) => client.post(FINANCE_ROUTES.kyosaiCancel, ref(key, o.id)),
                    { key: 'screen.finance.kyosai.cancelled' },
                  )
                }
              >
                {t('screen.finance.kyosai.cancel')}
              </Button>
            )}
          </div>
        </Card>
      ))}
      <h3 className="fin__sub">{t('screen.finance.kyosai.newOffer')}</h3>
      <PersonPicker
        label={t('screen.finance.kyosai.to')}
        people={people}
        value={buyer}
        onChange={setBuyer}
      />
      <AmountField
        label={t('screen.finance.kyosai.units')}
        value={unitsText}
        onChange={setUnitsText}
        helper={t('screen.finance.kyosai.youHold', { units: view.units })}
      />
      <AmountField
        label={t('screen.finance.kyosai.price')}
        value={priceText}
        onChange={setPriceText}
        helper={t('screen.finance.kyosai.feeNote')}
      />
      <div className="fin__actions">
        <Button
          disabled={!offerReady || action.busy}
          onClick={() => {
            if (!buyer || units === undefined || price === undefined) return;
            const body = (key: string): FinanceKyosaiOfferRequest => ({
              idempotencyKey: key,
              buyerId: buyer,
              units,
              price,
            });
            void action.run(
              `offer:${buyer}:${units}:${price}`,
              (key) => client.post(FINANCE_ROUTES.kyosaiOffer, body(key)),
              {
                key: 'screen.finance.kyosai.offered',
                params: () => ({ units }),
              },
            );
          }}
        >
          {t('screen.finance.kyosai.sendOffer')}
        </Button>
      </div>
    </Panel>
  );
}

function MotionsPanel({ view, action }: { view: FinanceKyosaiView; action: Action }) {
  const t = useT();
  const client = useFinanceClient();
  const num = useNumber();
  const timeLeft = useTimeLeft();
  const [text, setText] = useState('');
  const bps = Math.round(Number(text.replace(',', '.')) * 100);
  const valid = Number.isFinite(bps) && bps >= 0 && text !== '';
  return (
    <Panel
      title={t('screen.finance.kyosai.motions')}
      hint={t('screen.finance.kyosai.motionsHint', { now: num(view.premiumBps / 100, 2) })}
    >
      {view.motions.length === 0 ? <Empty>{t('screen.finance.kyosai.noMotions')}</Empty> : null}
      {view.motions.map((m) => {
        const vote = (yes: boolean) => {
          const body = (key: string): FinanceKyosaiVoteRequest => ({
            idempotencyKey: key,
            motionId: m.id,
            yes,
          });
          void action.run(
            `vote:${m.id}:${yes}`,
            (key) => client.post(FINANCE_ROUTES.kyosaiVote, body(key)),
            { key: 'screen.finance.kyosai.voted' },
          );
        };
        return (
          <Card key={m.id} variant="outlined" className="fin-row" data-motion={m.id}>
            <div className="fin-row__head">
              <strong>
                {t('screen.finance.kyosai.motion', {
                  name: m.proposer.name,
                  rate: num(m.premiumBps / 100, 2),
                })}
              </strong>
            </div>
            <Progress
              label={t('screen.finance.kyosai.yes')}
              value={m.yesUnits}
              max={Math.max(1, m.circulatingUnits)}
              valueLabel={t('screen.finance.kyosai.unitsCount', { units: m.yesUnits })}
              variant="success"
            />
            <Progress
              label={t('screen.finance.kyosai.no')}
              value={m.noUnits}
              max={Math.max(1, m.circulatingUnits)}
              valueLabel={t('screen.finance.kyosai.unitsCount', { units: m.noUnits })}
            />
            <p className="fin-row__meta">
              {t('screen.finance.kyosai.closes', { time: timeLeft(m.closesAt) })}
            </p>
            <div className="fin__actions">
              <Button disabled={action.busy || view.units === 0} onClick={() => vote(true)}>
                {t('screen.finance.kyosai.voteYes')}
              </Button>
              <Button
                variant="outlined"
                disabled={action.busy || view.units === 0}
                onClick={() => vote(false)}
              >
                {t('screen.finance.kyosai.voteNo')}
              </Button>
            </div>
          </Card>
        );
      })}
      <h3 className="fin__sub">{t('screen.finance.kyosai.propose')}</h3>
      <TextField
        label={t('screen.finance.kyosai.premium')}
        value={text}
        inputMode="decimal"
        autoComplete="off"
        onChange={(e) => setText(e.target.value.replace(/[^0-9.,]/g, '').slice(0, 6))}
        helperText={t('screen.finance.kyosai.premiumHelp')}
      />
      <div className="fin__actions">
        <Button
          variant="tonal"
          disabled={!valid || action.busy || view.units === 0}
          onClick={() => {
            const body = (key: string): FinanceKyosaiProposeRequest => ({
              idempotencyKey: key,
              premiumBps: bps,
            });
            void action.run(
              `propose:${bps}`,
              (key) => client.post(FINANCE_ROUTES.kyosaiPropose, body(key)),
              { key: 'screen.finance.kyosai.proposed' },
            );
          }}
        >
          {t('screen.finance.kyosai.proposeButton')}
        </Button>
      </div>
    </Panel>
  );
}

/** Teiai Kyosai: your units, the open auction, unit offers and the premium motions. */
export default function KyosaiScreen() {
  const t = useT();
  const pelica = usePelica();
  const num = useNumber();
  const { data, error, reload } = useView(FINANCE_ROUTES.kyosai, 30_000);
  const action = useAction(reload);
  if (!data)
    return (
      <ScreenFrame screen="kyosai" icon="stocks" title={t('screen.kyosai')}>
        <LoadError failed={error !== null} onRetry={() => void reload()} />
      </ScreenFrame>
    );
  return (
    <ScreenFrame
      screen="kyosai"
      icon="stocks"
      title={t('screen.kyosai')}
      lead={t('screen.finance.kyosai.lead')}
    >
      <Panel title={t('screen.finance.kyosai.status')} tone="elevated">
        <Stats>
          <Stat
            label={t('screen.finance.kyosai.yourUnits')}
            value={`${num(data.units)} / ${num(data.total)}`}
          />
          <Stat label={t('screen.finance.kyosai.pool')} value={pelica(data.pool)} />
          <Stat
            label={t('screen.finance.kyosai.premium')}
            value={`${num(data.premiumBps / 100, 2)}%`}
          />
          <Stat label={t('screen.finance.kyosai.holders')} value={num(data.holders)} />
        </Stats>
        {data.locked ? (
          <Banner variant="warning" title={t('screen.finance.kyosai.locked')} />
        ) : null}
      </Panel>
      <ErrorBanner message={action.error} />
      <AuctionPanel view={data} action={action} />
      <OffersPanel view={data} action={action} />
      <MotionsPanel view={data} action={action} />
    </ScreenFrame>
  );
}
