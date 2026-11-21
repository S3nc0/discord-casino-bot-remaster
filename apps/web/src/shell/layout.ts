import { useEffect, useState } from 'react';

export type LayoutMode = 'desktop' | 'mobile-portrait' | 'mobile-landscape';

/** Phones held sideways are short; narrow screens are phones held upright. */
export function layoutFor(width: number, height: number): LayoutMode {
  if (width > height && height <= 500) return 'mobile-landscape';
  if (width <= 720) return 'mobile-portrait';
  return 'desktop';
}

function measure(): LayoutMode {
  if (typeof window === 'undefined') return 'desktop';
  return layoutFor(window.innerWidth, window.innerHeight);
}

/** Current layout; follows resizes and orientation changes. */
export function useLayout(): LayoutMode {
  const [layout, setLayout] = useState<LayoutMode>(measure);
  useEffect(() => {
    const update = () => setLayout(measure());
    update();
    window.addEventListener('resize', update);
    window.addEventListener('orientationchange', update);
    return () => {
      window.removeEventListener('resize', update);
      window.removeEventListener('orientationchange', update);
    };
  }, []);
  return layout;
}
