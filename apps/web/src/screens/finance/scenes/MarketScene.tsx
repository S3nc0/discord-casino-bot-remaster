import type { FinanceListingsView } from '@casino/shared';
import { GameIcon } from '@casino/ui';
import { MARKET_ART, MARKET_SLOTS } from '../art/market.ts';
import { itemIcon } from '../../life/items.ts';
import { artBox, PixelScene } from '../PixelScene.tsx';

/** The market street: the newest listings stand on the stall shelves. */
export function MarketScene({
  listings,
  flash,
}: {
  listings: FinanceListingsView['listings'];
  flash?: { n: number; tone: 'buy' | 'sell' } | undefined;
}) {
  const shown = listings.slice(0, MARKET_SLOTS.length);
  return (
    <PixelScene
      art={MARKET_ART}
      name="market"
      flash={flash}
      overlay={shown.map((l, i) => {
        const [x, y] = MARKET_SLOTS[i] ?? [0, 0];
        return (
          <span key={l.id} className="fx-slot" style={artBox(x, y, 16, 16)} data-slot={l.id}>
            <GameIcon name={l.kind === 'horse' ? 'horse' : itemIcon(l.ref)} />
          </span>
        );
      })}
    />
  );
}
