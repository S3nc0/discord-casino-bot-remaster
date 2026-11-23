import { useState, type ReactNode } from 'react';
import './finance.css';
import {
  Banner,
  Button,
  Card,
  Chip,
  ChipGroup,
  GameIcon,
  TextField,
  type GameIconName,
} from '@casino/ui';
import { useT } from '../../shell/i18n.ts';
import type { Person } from './hooks.ts';

/**
 * One screen: its pixel scene (or, without one, a pixel icon), the title, an optional line under
 * it and the panels.
 */
export function ScreenFrame({
  screen,
  icon,
  title,
  lead,
  scene,
  children,
}: {
  screen: string;
  icon: GameIconName;
  title: string;
  lead?: string | undefined;
  scene?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="fin" data-screen={screen} aria-labelledby={`fin-${screen}-title`}>
      {scene}
      <header className="fin__head">
        {scene ? null : (
          <span className="fin__badge" aria-hidden="true">
            <GameIcon name={icon} />
          </span>
        )}
        <div>
          <h1 id={`fin-${screen}-title`} className="fin__title">
            {title}
          </h1>
          {lead ? <p className="fin__lead">{lead}</p> : null}
        </div>
      </header>
      {children}
    </section>
  );
}

export function Panel({
  title,
  hint,
  children,
  tone = 'filled',
  className,
}: {
  title: string;
  hint?: string | undefined;
  children: ReactNode;
  tone?: 'filled' | 'outlined' | 'elevated';
  className?: string | undefined;
}) {
  return (
    <Card variant={tone} className={className ? `fin-panel ${className}` : 'fin-panel'}>
      <h2 className="fin-panel__title bb-eyebrow">{title}</h2>
      {hint ? <p className="fin-panel__hint">{hint}</p> : null}
      {children}
    </Card>
  );
}

export function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: ReactNode;
  tone?: 'good' | 'bad' | 'warn' | undefined;
}) {
  return (
    <div className="fin-stat" data-tone={tone}>
      <span className="fin-stat__label">{label}</span>
      <span className="fin-stat__value">{value}</span>
    </div>
  );
}

export function Stats({ children }: { children: ReactNode }) {
  return <div className="fin-stats">{children}</div>;
}

export function ErrorBanner({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <div role="alert" className="fin__error">
      <Banner variant="error" title={message} />
    </div>
  );
}

export function LoadError({ failed, onRetry }: { failed: boolean; onRetry: () => void }) {
  const t = useT();
  if (!failed) {
    return (
      <p role="status" className="fin__loading">
        {t('common.loading')}
      </p>
    );
  }
  return (
    <Banner variant="error" title={t('screen.finance.loadFailed')}>
      <Button variant="tonal" onClick={onRetry}>
        {t('shell.retry')}
      </Button>
    </Banner>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="fin__empty">{children}</p>;
}

/** A whole-number field with its own label; the page keeps the digits only. */
export function AmountField({
  label,
  value,
  onChange,
  helper,
  suffix,
}: {
  label: string;
  value: string;
  onChange: (text: string) => void;
  helper?: string | undefined;
  suffix?: string | undefined;
}) {
  return (
    <TextField
      label={suffix ? `${label} (${suffix})` : label}
      value={value}
      inputMode="numeric"
      autoComplete="off"
      onChange={(e) => onChange(e.target.value)}
      {...(helper ? { helperText: helper } : {})}
    />
  );
}

/** Pick one player from a short list (the people in this Activity plus any known names). */
export function PersonPicker({
  label,
  people,
  value,
  onChange,
}: {
  label: string;
  people: readonly Person[];
  value: string | null;
  onChange: (id: string) => void;
}) {
  const t = useT();
  if (people.length === 0) return <p className="fin__empty">{t('screen.finance.nobodyHere')}</p>;
  return (
    <ChipGroup label={label}>
      {people.map((p) => (
        <Chip key={p.id} selected={value === p.id} onClick={() => onChange(p.id)}>
          {p.name}
        </Chip>
      ))}
    </ChipGroup>
  );
}

/** Choose between a few values with chips (leverage, term, symbol). */
export function ChoiceChips<T extends string | number>({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: readonly { value: T; label: ReactNode }[];
  value: T;
  onChange: (value: T) => void;
}) {
  return (
    <ChipGroup label={label}>
      {options.map((o) => (
        <Chip key={String(o.value)} selected={o.value === value} onClick={() => onChange(o.value)}>
          {o.label}
        </Chip>
      ))}
    </ChipGroup>
  );
}

/** A confirm step for the one-way moves: first tap arms the button, second tap sends. */
export function useArm(): [boolean, () => void, () => void] {
  const [armed, setArmed] = useState(false);
  return [armed, () => setArmed(true), () => setArmed(false)];
}
