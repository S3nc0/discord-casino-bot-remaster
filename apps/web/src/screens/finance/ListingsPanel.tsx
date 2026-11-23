import { useContext, useEffect, useRef, useState } from 'react';
import {
  FINANCE_ROUTES,
  type FinanceListingBidRequest,
  type FinanceListingRefRequest,
  type FinanceListingView,
} from '@casino/shared';
import { Banner, Button, Card, Tag } from '@casino/ui';
import { useT } from '../../shell/i18n.ts';
import { RuntimeContext } from '../../shell/runtime.ts';
import { useSessionStore } from '../../shell/stores/session.ts';
import { useFinanceClient } from './client.ts';
import {
  useAction,
  useAssetName,
  useInt,
  usePelica,
  useTimeLeft,
  useView,
  type Action,
} from './hooks.ts';
import { AmountField, Empty, ErrorBanner, LoadError, Panel } from './parts.tsx';
import { SellPanel } from './SellPanel.tsx';

/** Listing ids where somebody just bid above the signed-in player. */
function useOutbid(
  listings: readonly FinanceListingView[] | undefined,
  reload: () => Promise<void>,
) {
  const runtime = useContext(RuntimeContext);
  const [outbid, setOutbid] = useState<ReadonlySet<number>>(new Set());
  const wasTop = useRef(new Set<number>());

  // A bid that was mine and now is not: the list itself tells us, no event needed.
  useEffect(() => {
    if (!listings) return;
    const lost: number[] = [];
    for (const l of listings) {
      if (wasTop.current.has(l.id) && !l.youAreTop && l.mode === 'auction') lost.push(l.id);
    }
    wasTop.current = new Set(listings.filter((l) => l.youAreTop).map((l) => l.id));
    if (lost.length > 0) setOutbid((prev) => new Set([...prev, ...lost]));
  }, [listings]);

  // The server also pushes the event to the guild room; it only needs a refresh and a notice.
  useEffect(() => {
    const socket = runtime?.socket.raw;
    if (!socket) return;
    const onEvent = (event: { type: string; userId?: string; listingId?: number }) => {
      const { user } = useSessionStore.getState();
      if (event.type !== 'MarketplaceOutbid' || event.userId !== user?.id) return;
      const id = event.listingId;
      if (typeof id === 'number') setOutbid((prev) => new Set([...prev, id]));
      void reload();
    };
    socket.on('domain:event', onEvent as never);
    return () => void socket.off('domain:event', onEvent as never);
  }, [runtime, reload]);

  return [
    outbid,
    (id: number) => setOutbid((prev) => new Set([...prev].filter((x) => x !== id))),
  ] as const;
}

function ListingCard({
  listing,
  action,
  outbid,
  onSeen,
}: {
  listing: FinanceListingView;
  action: Action;
  outbid: boolean;
  onSeen: () => void;
}) {
  const t = useT();
  const client = useFinanceClient();
  const pelica = usePelica();
  const timeLeft = useTimeLeft();
  const assetName = useAssetName();
  const [text, setText, amount] = useInt(String(listing.minNextBid));
  const auction = listing.mode === 'auction';
  const ref = (key: string): FinanceListingRefRequest => ({
    idempotencyKey: key,
    listingId: listing.id,
  });
  return (
    <Card variant="outlined" className="fin-row" data-listing={listing.id} data-mode={listing.mode}>
      <div className="fin-row__head">
        <strong>
          {assetName(listing)}
          {listing.qty > 1 ? ` ×${listing.qty}` : ''}
        </strong>
        <Tag hue={auction ? 'violet' : 'teal'}>
          {t(`screen.finance.listings.mode.${listing.mode}`)}
        </Tag>
      </div>
      <p className="fin-row__meta">
        {t('screen.finance.listings.seller', {
          name: listing.mine ? t('screen.finance.you') : listing.seller.name,
        })}{' '}
        · {t(`screen.finance.listings.kind.${listing.kind}`)} · {timeLeft(listing.endAt)}
      </p>
      {outbid ? (
        <div role="alert" className="fin__notice fin__notice--warn" data-outbid={listing.id}>
          <span>{t('screen.finance.listings.outbid', { amount: pelica(listing.bid) })}</span>
          <Button variant="text" onClick={onSeen}>
            {t('common.ok')}
          </Button>
        </div>
      ) : null}
      <p className="fin-row__price">
        {auction && listing.bid > 0
          ? t('screen.finance.listings.topBid', {
              amount: pelica(listing.bid),
              name: listing.youAreTop ? t('screen.finance.you') : (listing.topBidder?.name ?? ''),
            })
          : pelica(listing.price)}
      </p>
      {listing.youAreTop ? <Tag hue="green">{t('screen.finance.listings.youLead')}</Tag> : null}
      {listing.mine ? (
        <div className="fin__actions">
          <Button
            variant="outlined"
            disabled={action.busy || listing.bid > 0}
            onClick={() =>
              void action.run(
                `cancel:${listing.id}`,
                (key) => client.post(FINANCE_ROUTES.listingCancel, ref(key)),
                { key: 'screen.finance.listings.cancelled' },
              )
            }
          >
            {t('screen.finance.listings.cancel')}
          </Button>
        </div>
      ) : auction ? (
        <>
          <AmountField
            label={t('screen.finance.listings.yourBid')}
            value={text}
            onChange={setText}
            helper={t('screen.finance.listings.minBid', { amount: pelica(listing.minNextBid) })}
          />
          <div className="fin__actions">
            <Button
              disabled={
                action.busy ||
                listing.youAreTop ||
                amount === undefined ||
                amount < listing.minNextBid
              }
              onClick={() => {
                if (amount === undefined) return;
                const body = (key: string): FinanceListingBidRequest => ({
                  idempotencyKey: key,
                  listingId: listing.id,
                  amount,
                });
                void action.run(
                  `bid:${listing.id}:${amount}`,
                  (key) => client.post(FINANCE_ROUTES.listingBid, body(key)),
                  {
                    key: 'screen.finance.listings.bidPlaced',
                    params: () => ({ amount: pelica(amount) }),
                  },
                );
              }}
            >
              {t('screen.finance.listings.bid')}
            </Button>
          </div>
        </>
      ) : (
        <div className="fin__actions">
          <Button
            disabled={action.busy}
            onClick={() =>
              void action.run(
                `buy:${listing.id}`,
                (key) => client.post(FINANCE_ROUTES.listingBuy, ref(key)),
                {
                  key: 'screen.finance.listings.bought',
                  params: (r) => ({ amount: pelica(r.amount ?? listing.price) }),
                },
              )
            }
          >
            {t('screen.finance.listings.buy', { amount: pelica(listing.price) })}
          </Button>
        </div>
      )}
    </Card>
  );
}

/** Player market: fixed-price and auction listings with outbid notices. */
export function ListingsPanel() {
  const t = useT();
  const { data, error, reload } = useView(FINANCE_ROUTES.listings, 20_000);
  const action = useAction(reload);
  const [outbid, dismiss] = useOutbid(data?.listings, reload);
  if (!data) return <LoadError failed={error !== null} onRetry={() => void reload()} />;
  return (
    <>
      <SellPanel view={data} reload={reload} />
      <Panel
        title={t('screen.finance.listings.title')}
        hint={t('screen.finance.listings.hint', { fee: String(data.feeBps / 100) })}
      >
        {outbid.size > 0 && data.listings.every((l) => !outbid.has(l.id)) ? (
          <Banner variant="warning" title={t('screen.finance.listings.outbidGone')} />
        ) : null}
        <ErrorBanner message={action.error} />
        {data.listings.length === 0 ? <Empty>{t('screen.finance.listings.none')}</Empty> : null}
        {data.listings.map((l) => (
          <ListingCard
            key={l.id}
            listing={l}
            action={action}
            outbid={outbid.has(l.id)}
            onSeen={() => dismiss(l.id)}
          />
        ))}
      </Panel>
    </>
  );
}
