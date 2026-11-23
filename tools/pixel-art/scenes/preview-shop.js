// Preview of the shop and storeroom scenes and the row tiles (not shipped).
import { P, out } from '../lib/env.js';
import { shopBanner, storeBanner, shelfTile, slotTile } from './shop.js';
import { make } from '../icons/kit.js';
import { paste } from './kit.js';

const sb = shopBanner(),
  st = storeBanner(),
  sh = shelfTile(),
  sl = slotTile();
const shelfWith = paste(shelfTile(), make('dice').buf, 3, 0);
const slotWith = paste(slotTile(), make('drink').buf, 2, 2);
P.save(
  P.sheet(
    [
      { buf: sb, label: 'shop', scale: 3 },
      { buf: st, label: 'storeroom', scale: 3 },
      { buf: shelfWith, label: 'shelf tile', scale: 6 },
      { buf: slotWith, label: 'slot tile', scale: 6 },
    ],
    { cols: 2 },
  ),
  out('shop_sheet.png'),
);
P.save(sb, out('px/shop_banner.png'));
P.save(st, out('px/store_banner.png'));
P.save(sh, out('px/shelf_tile.png'));
P.save(sl, out('px/slot_tile.png'));
