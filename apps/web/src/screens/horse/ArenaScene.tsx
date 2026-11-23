import { PixelScene, SceneLayer, useSceneFrame } from '@casino/ui';
import { ARENA_PIT, FIGHTER_ART, PIT_SPOTS } from './arena-art.ts';

/*
 * Underground arena art: the pit with two fighters trading punches, and each fighter's sprite on
 * their card. Decorative (the names are in the text). Under reduced motion both stand on guard.
 */

/** Fighter names in the order of the sprites (the roster of packages/domain arena.ts). */
const ROSTER = [
  '鉄拳のゴウ',
  '灼熱のレイジ',
  '黒影のクロウ',
  '修羅のバキ',
  '氷牙のユキ',
  '雷鳴のライ',
  '鬼哭のオニマル',
  '疾風のハヤテ',
  '剛腕のゴリウス',
  '影狼のシノビ',
  '爆砕のデストロ',
  '不死身のゾンバ',
  '蛇瞳のメデューサ',
  '怒髪のバーサーカー',
  '無敵のタイタン',
  '影帝のシャドウキング',
];

/** Sprite index of a fighter: by roster name, else a stable pick from the name. */
export function fighterSprite(name: string): number {
  const i = ROSTER.indexOf(name);
  if (i >= 0) return i;
  let h = 0;
  for (const ch of name) h = (h * 31 + (ch.codePointAt(0) ?? 0)) >>> 0;
  return h % FIGHTER_ART.length;
}

/** A short exchange: on guard, left punches, on guard, right punches (frame 0 = both on guard). */
const BOUT: ReadonlyArray<readonly [number, number]> = [
  [0, 0],
  [0, 0],
  [1, 0],
  [0, 0],
  [0, 0],
  [0, 1],
];

export function ArenaPit({ left, right }: { left: string; right: string }) {
  const step = useSceneFrame(BOUT.length, 300);
  const [a, b] = BOUT[step] ?? [0, 0];
  const L = FIGHTER_ART[fighterSprite(left)] ?? FIGHTER_ART[0];
  const R = FIGHTER_ART[fighterSprite(right)] ?? FIGHTER_ART[0];
  return (
    <div className="hr-pit">
      <PixelScene art={ARENA_PIT} frame={step % ARENA_PIT.frames.length} scale={2}>
        <SceneLayer art={L[0]} frame={a} x={PIT_SPOTS.left.x} y={PIT_SPOTS.left.y} />
        <SceneLayer art={R[1]} frame={b} x={PIT_SPOTS.right.x} y={PIT_SPOTS.right.y} />
      </PixelScene>
    </div>
  );
}

/** The fighter on guard, 2 CSS px per art pixel, for the fighter's card. */
export function FighterSprite({ name }: { name: string }) {
  const art = FIGHTER_ART[fighterSprite(name)] ?? FIGHTER_ART[0];
  return <PixelScene art={art[0]} scale={2} className="hr-fighter__art" />;
}
