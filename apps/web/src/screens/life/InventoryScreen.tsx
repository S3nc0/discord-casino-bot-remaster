import { GameIcon, List, ListItem, Button, Tag } from '@casino/ui';
import type { ShopView } from '@casino/shared';
import { useLocale, useT } from '../../shell/i18n.ts';
import { useNavStore } from '../../shell/stores/nav.ts';
import { useLifeApi } from './api.tsx';
import { useLoad } from './hooks.ts';
import { itemIcon, itemLabel } from './items.ts';
import { Await, LifeFrame } from './ui.tsx';

function Owned({ view }: { view: ShopView }) {
  const t = useT();
  const locale = useLocale();
  const go = useNavStore((s) => s.go);
  const owned = view.items.filter((item) => item.owned > 0);
  if (owned.length === 0) {
    return (
      <>
        <p className="life__empty">{t('screen.life.inventory.empty')}</p>
        <Button variant="tonal" onClick={() => go('shop')}>
          {t('screen.life.inventory.toShop')}
        </Button>
      </>
    );
  }
  return (
    <List label={t('screen.inventory')}>
      {owned.map((item) => (
        <ListItem
          key={item.id}
          leading={<GameIcon name={itemIcon(item.id)} className="life-item__icon" />}
          headline={itemLabel(locale, item.id)}
          trailing={<Tag hue="sky">×{item.owned}</Tag>}
        />
      ))}
    </List>
  );
}

/** What the player owns, from the shop's own view. */
export default function InventoryScreen() {
  const api = useLifeApi();
  const state = useLoad(() => api.shop(), 30_000);
  return (
    <LifeFrame screen="inventory" icon="gem">
      <Await state={state}>{(view) => <Owned view={view} />}</Await>
    </LifeFrame>
  );
}
