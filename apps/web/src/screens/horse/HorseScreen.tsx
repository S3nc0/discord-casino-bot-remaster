import { useState } from 'react';
import { GameIcon, Tabs } from '@casino/ui';
import { useT } from '../../shell/i18n.ts';
import { BreedTab } from './BreedTab.tsx';
import { useHorseApi } from './context.tsx';
import { useDomainEvents, useResource } from './hooks.ts';
import { LoadFailed, Loading } from './parts.tsx';
import { RaceCardTab } from './RaceCardTab.tsx';
import { RaceView } from './RaceView.tsx';
import { StableTab } from './StableTab.tsx';
import './horse.css';

type TabId = 'card' | 'stable' | 'breed';

/** Horse racing: today's race card, the stable, breeding. */
export function HorseScreen() {
  const t = useT();
  const api = useHorseApi();
  const stable = useResource(() => api.stable(), [api]);
  const [tab, setTab] = useState<TabId>('card');
  const [open, setOpen] = useState<{ id: number; num: number } | null>(null);
  const { reload } = stable;

  // A finished race changes records, stables and balances.
  useDomainEvents((event) => {
    if (event.type === 'RaceFinished' || event.type === 'HorseFoaled') void reload();
  });

  let body;
  if (stable.error && !stable.data) body = <LoadFailed onRetry={() => void reload()} />;
  else if (!stable.data) body = <Loading />;
  else if (open)
    body = (
      <RaceView
        raceId={open.id}
        num={open.num}
        stable={stable.data}
        onStableChange={() => void reload()}
        onBack={() => setOpen(null)}
      />
    );
  else {
    const data = stable.data;
    body = (
      <Tabs
        label={t('screen.horse.tab.label')}
        activeId={tab}
        onChange={(id) => setTab(id as TabId)}
        tabs={[
          {
            id: 'card',
            label: t('screen.horse.tab.card'),
            panel: <RaceCardTab onOpen={(id, num) => setOpen({ id, num })} />,
          },
          {
            id: 'stable',
            label: t('screen.horse.tab.stable'),
            panel: <StableTab stable={data} onChange={() => void reload()} />,
          },
          {
            id: 'breed',
            label: t('screen.horse.tab.breed'),
            panel: <BreedTab stable={data} onChange={() => void reload()} />,
          },
        ]}
      />
    );
  }

  return (
    <section className="hr-screen" data-screen="horse" aria-labelledby="horse-title">
      <header className="hr-head">
        <GameIcon name="horse" className="hr-head__icon" />
        <h1 id="horse-title">{t('screen.horse')}</h1>
      </header>
      {body}
    </section>
  );
}

export default HorseScreen;
