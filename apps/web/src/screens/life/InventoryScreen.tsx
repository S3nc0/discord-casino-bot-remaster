import { useState } from 'react';
import { Banner, Button, List, ListItem, Tag } from '@casino/ui';
import type { ColorRoleNotice, ShopView } from '@casino/shared';
import { useLocale, useT } from '../../shell/i18n.ts';
import { useNavStore } from '../../shell/stores/nav.ts';
import { useLifeApi } from './api.tsx';
import { pushToast, useIntent, useLoad } from './hooks.ts';
import { itemIcon, itemLabel } from './items.ts';
import { SlotIcon, StoreBanner } from './InventoryScene.tsx';
import { Await, LifeFrame } from './ui.tsx';

function Owned({ view, reload }: { view: ShopView; reload: () => Promise<void> }) {
  const t = useT();
  const locale = useLocale();
  const go = useNavStore((s) => s.go);
  const api = useLifeApi();
  const intent = useIntent();
  const [notice, setNotice] = useState<{ kind: ColorRoleNotice; role: string } | null>(null);
  const owned = view.items.filter((item) => item.owned > 0);
  const worn = view.colorRole ?? null;

  const wear = (itemId: string | null) => {
    void intent
      .run(`color:${itemId ?? 'off'}`, (key) => api.shopColorRole(itemId, key))
      .then(async (r) => {
        if (!r) return;
        if (r.notice) setNotice({ kind: r.notice, role: r.roleName ?? '' });
        else setNotice(null);
        if (r.notice !== 'name_taken') {
          if (itemId === null) pushToast('success', 'screen.life.inventory.colorOff');
          else
            pushToast('success', 'screen.life.inventory.colorOn', {
              item: itemLabel(locale, itemId),
            });
        }
        await reload();
      });
  };

  if (owned.length === 0) {
    return (
      <>
        <StoreBanner />
        <p className="life__empty">{t('screen.life.inventory.empty')}</p>
        <Button variant="tonal" onClick={() => go('shop')}>
          {t('screen.life.inventory.toShop')}
        </Button>
      </>
    );
  }
  const hasColor = owned.some((item) => item.kind === 'color_role');
  return (
    <>
      <StoreBanner />
      {notice ? (
        <Banner
          variant={notice.kind === 'pending' ? 'info' : 'warning'}
          title={t('screen.profile.nameColor')}
        >
          {t(`shop.colorRole.notice.${notice.kind}`, { name: notice.role })}
        </Banner>
      ) : null}
      {hasColor ? <p className="life__note">{t('screen.life.inventory.colorHint')}</p> : null}
      <List label={t('screen.inventory')}>
        {owned.map((item) => (
          <ListItem
            key={item.id}
            leading={<SlotIcon name={itemIcon(item.id)} />}
            headline={itemLabel(locale, item.id)}
            trailing={
              item.kind === 'color_role' ? (
                item.id === worn ? (
                  <>
                    <Tag hue="green">{t('screen.life.inventory.worn')}</Tag>
                    <Button variant="text" disabled={intent.busy} onClick={() => wear(null)}>
                      {t('screen.life.inventory.takeOff')}
                    </Button>
                  </>
                ) : (
                  <Button variant="tonal" disabled={intent.busy} onClick={() => wear(item.id)}>
                    {t('screen.life.inventory.wear')}
                  </Button>
                )
              ) : (
                <Tag hue="sky">×{item.owned}</Tag>
              )
            }
          />
        ))}
      </List>
    </>
  );
}

/** What the player owns, from the shop's own view. Name colors can be worn from here. */
export default function InventoryScreen() {
  const api = useLifeApi();
  const state = useLoad(() => api.shop(), 30_000);
  return (
    <LifeFrame screen="inventory" icon="inventory">
      <Await state={state}>{(view) => <Owned view={view} reload={state.reload} />}</Await>
    </LifeFrame>
  );
}
