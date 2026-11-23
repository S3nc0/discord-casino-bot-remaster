import { useState } from 'react';
import { Banner, Button, Chip, ChipGroup, Dialog, List, ListItem, Tabs, Tag } from '@casino/ui';
import type { MarketLotView, SeizedLotView, ShopItem, ShopView } from '@casino/shared';
import { formatPelica, useLocale, useT } from '../../shell/i18n.ts';
import { useLifeApi } from './api.tsx';
import { formatDuration } from './format.ts';
import { pushToast, useIntent, useLoad, useNow, usePlay } from './hooks.ts';
import { itemIcon, itemLabel } from './items.ts';
import { ShelfIcon, ShopBanner } from './ShopScene.tsx';
import { Await, LifeFrame } from './ui.tsx';

type Pending =
  | { kind: 'item'; item: ShopItem }
  | { kind: 'market'; lot: MarketLotView }
  | { kind: 'seized'; lot: SeizedLotView };

function useItemName() {
  const locale = useLocale();
  const t = useT();
  return (id: string): string => {
    if (id === '?') return t('screen.life.shop.blackItem');
    const m = /^(relic_[a-z]+)(?:_s(\d))?$/.exec(id);
    if (m) return `${t(`screen.life.relic.${m[1]}`)}${'★'.repeat(Number(m[2] ?? 0))}`;
    return itemLabel(locale, id);
  };
}

function Shelf({
  view,
  onBuy,
  busy,
}: {
  view: ShopView;
  onBuy: (p: Pending) => void;
  busy: boolean;
}) {
  const t = useT();
  const locale = useLocale();
  const name = useItemName();
  const kinds = [...new Set(view.items.map((i) => i.kind))];
  const [kind, setKind] = useState(kinds[0] ?? 'consumable');
  const shown = view.items.filter((i) => i.kind === kind);
  return (
    <>
      <ChipGroup label={t('screen.life.shop.title')}>
        {kinds.map((k) => (
          <Chip key={k} selected={k === kind} onClick={() => setKind(k)}>
            {t(`screen.life.shop.kind.${k}`)}
          </Chip>
        ))}
      </ChipGroup>
      <ShopBanner />
      <List label={t(`screen.life.shop.kind.${kind}`)}>
        {shown.map((item) => {
          const soldOut = item.available !== null && item.available < 1;
          const ownedUnique = item.unique && item.owned > 0;
          const cannot =
            busy || view.debt > 0 || ownedUnique || soldOut || view.balance < item.price;
          return (
            <ListItem
              key={item.id}
              leading={<ShelfIcon name={itemIcon(item.id)} />}
              headline={name(item.id)}
              supportingText={
                <>
                  {formatPelica(locale, item.price)}
                  {item.available !== null
                    ? ` · ${t('screen.life.shop.stock', { n: item.available })}`
                    : ''}
                  {!item.unique && item.owned > 0
                    ? ` · ${t('screen.life.shop.owned', { n: item.owned })}`
                    : ''}
                </>
              }
              trailing={
                ownedUnique ? (
                  <Tag hue="green">{t('screen.life.shop.ownedOne')}</Tag>
                ) : soldOut ? (
                  <Tag hue="neutral">{t('screen.life.shop.soldOut')}</Tag>
                ) : (
                  <Button
                    variant="tonal"
                    disabled={cannot}
                    onClick={() => onBuy({ kind: 'item', item })}
                  >
                    {t('screen.life.shop.buy')}
                  </Button>
                )
              }
            />
          );
        })}
      </List>
    </>
  );
}

function Market({
  view,
  onBuy,
  busy,
  now,
}: {
  view: ShopView;
  onBuy: (p: Pending) => void;
  busy: boolean;
  now: number;
}) {
  const t = useT();
  const locale = useLocale();
  const name = useItemName();
  if (view.market.length === 0)
    return <p className="life__empty">{t('screen.life.shop.marketNone')}</p>;
  return (
    <>
      {view.market.some((l) => l.black) ? (
        <Banner variant="warning" title={t('screen.life.shop.blackOpen')}>
          {t('screen.life.shop.blackWarn')}
        </Banner>
      ) : null}
      <List label={t('screen.life.shop.tab.market')}>
        {view.market.map((lot) => (
          <ListItem
            key={lot.id}
            leading={<ShelfIcon name={itemIcon(lot.itemId)} />}
            headline={
              <>
                {name(lot.itemId)}{' '}
                {lot.black ? <Tag hue="violet">{t('screen.life.shop.black')}</Tag> : null}
              </>
            }
            supportingText={
              <>
                {formatPelica(locale, lot.price)} · {t(`screen.life.shop.mode.${lot.mode}`)} ·{' '}
                {t('screen.life.shop.qty', { qty: lot.qty })} ·{' '}
                {t('screen.life.shop.expires', { time: formatDuration(t, lot.expiresAt - now) })}
              </>
            }
            trailing={
              <Button
                variant="tonal"
                disabled={busy || view.debt > 0 || view.balance < lot.price}
                onClick={() => onBuy({ kind: 'market', lot })}
              >
                {t('screen.life.shop.buy')}
              </Button>
            }
          />
        ))}
      </List>
    </>
  );
}

function Seized({
  view,
  onBuy,
  busy,
}: {
  view: ShopView;
  onBuy: (p: Pending) => void;
  busy: boolean;
}) {
  const t = useT();
  const locale = useLocale();
  const name = useItemName();
  return (
    <>
      <p className="life__note">{t('screen.life.shop.seizedNote')}</p>
      {view.seized.length === 0 ? (
        <p className="life__empty">{t('screen.life.shop.seizedNone')}</p>
      ) : (
        <List label={t('screen.life.shop.tab.seized')}>
          {view.seized.map((lot) => (
            <ListItem
              key={lot.id}
              leading={<ShelfIcon name={itemIcon(lot.itemId)} />}
              headline={name(lot.itemId)}
              supportingText={`${formatPelica(locale, lot.price)} · ${t('screen.life.shop.qty', { qty: lot.qty })}`}
              trailing={
                <Button
                  variant="tonal"
                  disabled={busy || view.debt > 0 || view.balance < lot.price}
                  onClick={() => onBuy({ kind: 'seized', lot })}
                >
                  {t('screen.life.shop.buy')}
                </Button>
              }
            />
          ))}
        </List>
      )}
    </>
  );
}

function Body({ view, reload }: { view: ShopView; reload: () => Promise<void> }) {
  const t = useT();
  const locale = useLocale();
  const api = useLifeApi();
  const intent = useIntent();
  const play = usePlay();
  const name = useItemName();
  const now = useNow(1000);
  const [pending, setPending] = useState<Pending | null>(null);
  const [revealed, setRevealed] = useState<{
    item: string;
    how: 'same' | 'worse' | 'better';
  } | null>(null);

  const run = (p: Pending) => {
    setPending(null);
    const label = `${p.kind}:${p.kind === 'item' ? p.item.id : p.lot.id}`;
    void intent
      .run(label, (key) =>
        p.kind === 'item'
          ? api.shopBuy(p.item.id, undefined, key)
          : p.kind === 'market'
            ? api.shopMarketBuy(p.lot.id, key)
            : api.shopSeizedBuy(p.lot.id, key),
      )
      .then(async (r) => {
        if (!r) return;
        play('cashRegister');
        if (r.revealed) setRevealed({ item: r.itemId, how: r.revealed });
        else
          pushToast('success', 'screen.life.shop.bought', {
            item: name(r.itemId),
            price: formatPelica(locale, r.price),
          });
        await reload();
      });
  };

  /** Black-market lots, big prices and the like ask first. */
  const buy = (p: Pending) => {
    const asks =
      (p.kind === 'item' && p.item.confirm) ||
      (p.kind === 'market' && (p.lot.confirm || p.lot.black));
    if (asks) setPending(p);
    else run(p);
  };

  const pendingInfo = (() => {
    if (!pending) return null;
    if (pending.kind === 'item')
      return { item: name(pending.item.id), price: pending.item.price, black: false };
    if (pending.kind === 'market')
      return { item: name(pending.lot.itemId), price: pending.lot.price, black: pending.lot.black };
    return { item: name(pending.lot.itemId), price: pending.lot.price, black: false };
  })();

  return (
    <>
      {view.debt > 0 ? (
        <Banner
          variant="warning"
          title={t('screen.life.shop.debt', { debt: formatPelica(locale, view.debt) })}
        />
      ) : null}
      <Tabs
        label={t('screen.shop')}
        defaultActiveId="shop"
        tabs={[
          {
            id: 'shop',
            label: t('screen.life.shop.tab.shop'),
            panel: <Shelf view={view} onBuy={buy} busy={intent.busy} />,
          },
          {
            id: 'market',
            label: t('screen.life.shop.tab.market'),
            panel: <Market view={view} onBuy={buy} busy={intent.busy} now={now} />,
          },
          {
            id: 'seized',
            label: t('screen.life.shop.tab.seized'),
            panel: <Seized view={view} onBuy={buy} busy={intent.busy} />,
          },
        ]}
      />
      <Dialog
        open={pending !== null}
        onClose={() => setPending(null)}
        title={t('screen.life.shop.confirmTitle')}
        description={
          pendingInfo
            ? pendingInfo.black
              ? t('screen.life.shop.blackWarn')
              : t('screen.life.shop.confirmBody', {
                  item: pendingInfo.item,
                  price: formatPelica(locale, pendingInfo.price),
                })
            : undefined
        }
        actions={
          <>
            <Button variant="text" onClick={() => setPending(null)}>
              {t('common.cancel')}
            </Button>
            <Button onClick={() => pending && run(pending)}>{t('screen.life.shop.buy')}</Button>
          </>
        }
      >
        {pendingInfo ? (
          <p className="life__note life__note--strong">
            {pendingInfo.item} · {formatPelica(locale, pendingInfo.price)}
          </p>
        ) : null}
      </Dialog>
      <Dialog
        open={revealed !== null}
        onClose={() => setRevealed(null)}
        title={revealed ? t('screen.life.shop.revealed', { item: name(revealed.item) }) : ''}
        description={revealed ? t(`screen.life.shop.revealed.${revealed.how}`) : undefined}
        actions={<Button onClick={() => setRevealed(null)}>{t('common.ok')}</Button>}
      />
    </>
  );
}

export default function ShopScreen() {
  const api = useLifeApi();
  const state = useLoad(() => api.shop(), 30_000);
  return (
    <LifeFrame screen="shop" icon="shop">
      <Await state={state}>{(v) => <Body view={v} reload={state.reload} />}</Await>
    </LifeFrame>
  );
}
