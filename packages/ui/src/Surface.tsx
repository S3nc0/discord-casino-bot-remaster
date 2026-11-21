import type { ReactNode } from 'react';

export interface SurfaceProps {
  children?: ReactNode;
  /** Accessible label for the region. */
  label?: string;
}

/** Placeholder container until the Bitbloom kit lands. */
export function Surface({ children, label }: SurfaceProps) {
  return (
    <section className="bb-surface" aria-label={label}>
      {children}
    </section>
  );
}
