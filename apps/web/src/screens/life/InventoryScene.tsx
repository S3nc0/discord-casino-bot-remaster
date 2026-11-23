import { GameIcon, PixelScene, type GameIconName } from '@casino/ui';
import { SLOT_TILE, STORE_BANNER } from './inventory-art.ts';

/** The storeroom (crates, barrels, an open chest), at the top of the inventory. Decorative. */
export function StoreBanner() {
  return (
    <div className="life-banner">
      <PixelScene art={STORE_BANNER} scale={2} />
    </div>
  );
}

/** An item icon in its storage slot (the icon keeps its class and size). */
export function SlotIcon({ name }: { name: GameIconName }) {
  return (
    <span className="life-slot life-slot--box">
      <PixelScene art={SLOT_TILE} scale={2} className="life-slot__bg" />
      <GameIcon name={name} className="life-item__icon" />
    </span>
  );
}
