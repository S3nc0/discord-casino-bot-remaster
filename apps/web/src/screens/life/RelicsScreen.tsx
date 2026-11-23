import type { WorkView } from '@casino/shared';
import { PixelScene, SceneLayer } from '@casino/ui';
import { useT } from '../../shell/i18n.ts';
import { LaborView, relicName } from './LaborScreen.tsx';
import { RELIC_CASES, RELICS_HALL } from './relics-art.ts';
import './social.css';

/** The best star level held of each relic kind (`relic_vase_s2` → 2), missing when none is held. */
export function bestStars(held: WorkView['held']): Record<string, number> {
  const best: Record<string, number> = {};
  for (const [id, n] of Object.entries(held)) {
    const m = /^(relic_[a-z]+)(?:_s(\d))?$/.exec(id);
    if (!m || !m[1] || n <= 0) continue;
    const stars = Number(m[2] ?? 0);
    best[m[1]] = Math.max(best[m[1]] ?? 0, stars);
  }
  return best;
}

/**
 * The museum above the relics: one case per kind, a dark silhouette until it is found, then the
 * relic glowing brighter with its best star level. The list below says the same in words, so the
 * picture names only what is on display.
 */
export function Museum({ view }: { view: WorkView }) {
  const t = useT();
  const best = bestStars(view.held);
  const shown = RELIC_CASES.filter((c) => best[c.kind] !== undefined);
  const label = shown
    .map((c) => relicName(t, best[c.kind] ? `${c.kind}_s${best[c.kind]}` : c.kind))
    .join(', ');
  return (
    <div className="sc-scene">
      <PixelScene art={RELICS_HALL} scale={2} {...(label ? { label } : {})}>
        {RELIC_CASES.map((c) => {
          const stars = best[c.kind];
          const frame = stars === undefined ? 0 : 1 + Math.min(3, stars);
          return <SceneLayer key={c.kind} art={c.art} frame={frame} x={c.x} y={c.y} />;
        })}
      </PixelScene>
    </div>
  );
}

/** The relics screen id: the labor view, opened on its relics tab, under the museum. */
export default function RelicsScreen() {
  return <LaborView screen="relics" initialTab="relics" hero={(v) => <Museum view={v} />} />;
}
