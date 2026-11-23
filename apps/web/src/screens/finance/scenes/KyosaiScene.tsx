import { KYOSAI_ART } from '../art/kyosai.ts';
import { PixelScene, usePlayback } from '../PixelScene.tsx';

const RAIN = [-1, 0, 1, 2, 3, 4, 5, 6, 7];

/** The mutual-aid office: the shield on the wall, rain falling past the window. */
export function KyosaiScene() {
  const frame = usePlayback(RAIN, 110, 'loop');
  return <PixelScene art={KYOSAI_ART} name="kyosai" frame={frame} />;
}
