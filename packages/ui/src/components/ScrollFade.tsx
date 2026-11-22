import { useEffect, useRef, useState, type HTMLAttributes, type ReactNode } from 'react';
import { cx } from '../utils.ts';

export interface ScrollFadeProps extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode;
  /** A child to bring into view on mount, e.g. the selected chip: `[aria-pressed="true"]`. */
  revealSelector?: string;
}

/**
 * A row that scrolls sideways when it does not fit, with a soft fade on each edge that still has
 * something hidden behind it, so a clipped item reads as "there is more" instead of as a bug.
 */
export function ScrollFade({ children, className, revealSelector, ...props }: ScrollFadeProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [edge, setEdge] = useState({ start: false, end: false });

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = () => {
      const start = el.scrollLeft > 1;
      const end = el.scrollLeft + el.clientWidth < el.scrollWidth - 1;
      setEdge((prev) => (prev.start === start && prev.end === end ? prev : { start, end }));
    };
    if (revealSelector) {
      const target = el.querySelector<HTMLElement>(revealSelector);
      if (target) {
        el.scrollLeft = target.offsetLeft - (el.clientWidth - target.offsetWidth) / 2;
      }
    }
    update();
    el.addEventListener('scroll', update, { passive: true });
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(update);
    observer?.observe(el);
    return () => {
      el.removeEventListener('scroll', update);
      observer?.disconnect();
    };
  }, [revealSelector]);

  return (
    <div
      ref={ref}
      className={cx('bb-scrollfade', className)}
      data-fade-start={edge.start}
      data-fade-end={edge.end}
      {...props}
    >
      {children}
    </div>
  );
}
