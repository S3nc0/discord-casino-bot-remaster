import { useState, type InputHTMLAttributes, type ReactNode } from 'react';
import { cx } from '../utils.ts';

export interface SwitchProps extends Omit<
  InputHTMLAttributes<HTMLInputElement>,
  'type' | 'onChange'
> {
  /** Visible setting label (if disabled, include the reason here). */
  label: ReactNode;
  /** Controlled checked state. */
  checked?: boolean;
  /** Initial checked state for uncontrolled usage. */
  defaultChecked?: boolean;
  /** Called when the switch toggles. */
  onChange?: (checked: boolean) => void;
  /** Text shown when on (default: "On"). */
  onLabel?: string;
  /** Text shown when off (default: "Off"). */
  offLabel?: string;
}

export function Switch({
  label,
  checked,
  defaultChecked = false,
  onChange,
  onLabel = 'On',
  offLabel = 'Off',
  disabled,
  className,
  ...props
}: SwitchProps) {
  const [internalChecked, setInternalChecked] = useState(defaultChecked);
  const isChecked = checked !== undefined ? checked : internalChecked;

  return (
    <label className={cx('bb-switch', className)}>
      <input
        type="checkbox"
        role="switch"
        checked={isChecked}
        aria-checked={isChecked}
        disabled={disabled}
        onChange={(event) => {
          const next = event.target.checked;
          if (checked === undefined) {
            setInternalChecked(next);
          }
          onChange?.(next);
        }}
        {...props}
      />
      <span>{label}</span>
      <span className="bb-switch__state">{isChecked ? onLabel : offLabel}</span>
    </label>
  );
}
