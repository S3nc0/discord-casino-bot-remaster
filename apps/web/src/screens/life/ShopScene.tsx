import { GameIcon, PixelScene, type GameIconName } from '@casino/ui';
import { SHELF_TILE, SHOP_BANNER } from './shop-art.ts';

/** Shelves of goods over the counter, at the top of the shop list. Decorative. */
export function ShopBanner() {
  return (
    <div className="life-banner">
      <PixelScene art={SHOP_BANNER} scale={2} />
    </div>
  );
}

/** An item icon standing on its bit of shelf (the icon keeps its class and size). */
export function ShelfIcon({ name }: { name: GameIconName }) {
  return (
    <span className="life-slot life-slot--shelf">
      <PixelScene art={SHELF_TILE} scale={2} className="life-slot__bg" />
      <GameIcon name={name} className="life-item__icon" />
    </span>
  );
}
