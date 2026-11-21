import type { HTMLAttributes, MouseEventHandler, ReactNode } from 'react';
import { cx } from '../utils.ts';

export type CardVariant = 'elevated' | 'filled' | 'outlined';

export interface CardProps extends Omit<HTMLAttributes<HTMLElement>, 'title'> {
  /** Surface emphasis variant. Defaults to 'elevated'. */
  variant?: CardVariant;
  /** Optional edge-to-edge 2:1 pixel-art media slot. */
  media?: ReactNode;
  /** Card title in Pixelify Sans title-medium. */
  title?: ReactNode;
  /** Supporting metadata below the title. */
  meta?: ReactNode;
  /** Action buttons aligned bottom-right (max 2 recommended). */
  actions?: ReactNode;
  /** Card body copy or content. */
  children?: ReactNode;
  /** Makes the whole card a link when provided. */
  href?: string;
  /** Makes the card interactive. Renders as a button when actions are not present. */
  onClick?: MouseEventHandler<HTMLElement>;
}

export function Card({
  variant = 'elevated',
  media,
  title,
  meta,
  actions,
  children,
  href,
  onClick,
  className,
  ...props
}: CardProps) {
  const classes = cx(
    'bb-card',
    variant !== 'elevated' && `bb-card--${variant}`,
    (href || onClick) && 'bb-state',
    className,
  );

  const content = (
    <>
      {media && <div className="bb-card__media">{media}</div>}
      {title && <h3 className="bb-card__title">{title}</h3>}
      {meta && <p className="bb-card__meta">{meta}</p>}
      {children && <div className="bb-card__body">{children}</div>}
      {actions && <div className="bb-card__actions">{actions}</div>}
    </>
  );

  if (href) {
    return (
      <a className={classes} href={href} onClick={onClick} {...props}>
        {content}
      </a>
    );
  }

  if (onClick && !actions) {
    return (
      <button type="button" className={classes} onClick={onClick} {...props}>
        {content}
      </button>
    );
  }

  return (
    <article className={classes} onClick={onClick} {...props}>
      {content}
    </article>
  );
}
