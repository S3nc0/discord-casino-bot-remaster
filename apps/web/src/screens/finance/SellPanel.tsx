import { useState } from 'react';
import {
  FINANCE_ROUTES,
  type FinanceListingCreateRequest,
  type FinanceListingsView,
} from '@casino/shared';
import { Button, Chip, ChipGroup } from '@casino/ui';
import { useT } from '../../shell/i18n.ts';
import { useFinanceClient } from './client.ts';
import { useAction, useAssetName, useInt, usePelica } from './hooks.ts';
import { AmountField, ChoiceChips, Empty, ErrorBanner, Panel } from './parts.tsx';

/** Highest price the market accepts for one listing (the pair limit). */
const PRICE_CEILING = 100_000;

/**
 * "Sell an item": pick one of the tradable items you own (with how many), then a quantity, a sale
 * type and a price. With nothing to sell, or all slots used, the button stays off and says why.
 */
export function SellPanel({
  view,
  reload,
}: {
  view: FinanceListingsView;
  reload: () => Promise<void>;
}) {
  const t = useT();
  const action = useAction(reload);
  const client = useFinanceClient();
  const pelica = usePelica();
  const assetName = useAssetName();
  const [picked, setPicked] = useState<string | null>(null);
  const [qtyText, setQtyText, qty] = useInt('1');
  // null: the suggestion for the picked item; a string once the player types a price.
  const [typedPrice, setTypedPrice] = useState<string | null>(null);
  const [mode, setMode] = useState<'fixed' | 'auction'>('fixed');
  const [hours, setHours] = useState<number>(view.auctionHours[0] ?? 24);

  const item = view.sellable.find((i) => i.ref === picked) ?? view.sellable[0];
  const open = view.listings.filter((l) => l.mine).length;
  const full = open >= view.maxActive;
  const reason = !item
    ? t('screen.finance.listings.sell.emptyReason')
    : full
      ? t('screen.finance.listings.sell.fullReason', { max: view.maxActive })
      : null;

  const pick = (ref: string) => {
    setPicked(ref);
    setQtyText('1');
    setTypedPrice(null);
  };
  const qtyOk = item !== undefined && qty !== undefined && qty >= 1 && qty <= item.qty;
  const priceText =
    typedPrice ?? (item ? String(Math.min(item.unitValue * (qty ?? 1), PRICE_CEILING)) : '');
  const priceValue = priceText === '' ? undefined : Number(priceText);
  const canSend = reason === null && qtyOk && priceValue !== undefined && priceValue > 0;

  return (
    <Panel
      title={t('screen.finance.listings.sell.title')}
      hint={t('screen.finance.listings.sell.hint')}
      tone="outlined"
    >
      <ErrorBanner message={action.error} />
      {item ? (
        <>
          <ChipGroup label={t('screen.finance.listings.sell.pick')}>
            {view.sellable.map((i) => (
              <Chip
                key={i.ref}
                selected={i.ref === item.ref}
                data-sellable={i.ref}
                onClick={() => pick(i.ref)}
              >
                {t('screen.finance.listings.sell.owned', {
                  name: assetName({ kind: 'item', ref: i.ref, name: i.name }),
                  qty: i.qty,
                })}
              </Chip>
            ))}
          </ChipGroup>
          <AmountField
            label={t('screen.finance.listings.sell.qty', { max: item.qty })}
            value={qtyText}
            onChange={setQtyText}
          />
          <ChoiceChips
            label={t('screen.finance.listings.sell.mode')}
            options={[
              { value: 'fixed', label: t('screen.finance.listings.mode.fixed') },
              { value: 'auction', label: t('screen.finance.listings.mode.auction') },
            ]}
            value={mode}
            onChange={setMode}
          />
          {mode === 'auction' ? (
            <ChoiceChips
              label={t('screen.finance.listings.sell.hours')}
              options={view.auctionHours.map((h) => ({
                value: h,
                label: t('screen.finance.listings.sell.hoursOption', { h }),
              }))}
              value={hours}
              onChange={setHours}
            />
          ) : (
            <p className="fin-row__meta">
              {t('screen.finance.listings.sell.fixedNote', { days: view.fixedDays })}
            </p>
          )}
          <AmountField
            label={t(
              mode === 'auction'
                ? 'screen.finance.listings.sell.startPrice'
                : 'screen.finance.listings.sell.price',
            )}
            value={priceText}
            onChange={(text) => setTypedPrice(text.replace(/[^0-9]/g, '').slice(0, 13))}
            helper={t('screen.finance.listings.sell.unitValue', {
              amount: pelica(item.unitValue),
            })}
          />
        </>
      ) : (
        <Empty>{reason}</Empty>
      )}
      {item && reason ? <Empty>{reason}</Empty> : null}
      <div className="fin__actions">
        <Button
          disabled={action.busy || !canSend}
          onClick={() => {
            if (!item || !qtyOk || priceValue === undefined || qty === undefined) return;
            const body = (key: string): FinanceListingCreateRequest => ({
              idempotencyKey: key,
              ref: item.ref,
              qty,
              mode,
              price: priceValue,
              ...(mode === 'auction' ? { hours } : {}),
            });
            void action.run(
              `sell:${item.ref}:${qty}:${mode}:${hours}:${priceValue}`,
              (key) => client.post(FINANCE_ROUTES.listingCreate, body(key)),
              {
                key: 'screen.finance.listings.sell.listed',
                params: () => ({
                  name: assetName({ kind: 'item', ref: item.ref, name: item.name }),
                }),
              },
            );
          }}
        >
          {t('screen.finance.listings.sell.submit')}
        </Button>
      </div>
    </Panel>
  );
}
