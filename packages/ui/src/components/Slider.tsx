import { useId, useState, type CSSProperties, type InputHTMLAttributes } from 'react';
import { cx } from '../utils.ts';

export interface SliderProps extends Omit<
  InputHTMLAttributes<HTMLInputElement>,
  'type' | 'value' | 'defaultValue' | 'onChange'
> {
  /** Always-visible label for the slider. */
  label: string;
  /** Controlled numeric value. */
  value?: number;
  /** Initial numeric value for uncontrolled usage. */
  defaultValue?: number;
  min?: number;
  max?: number;
  step?: number;
  /** Formats the numeric value displayed beside the label (e.g., "Large"). */
  formatValue?: (value: number) => string;
  /** Called with the updated numeric value. */
  onChange?: (value: number) => void;
}

export function Slider({
  label,
  value,
  defaultValue,
  min = 0,
  max = 100,
  step = 1,
  formatValue,
  onChange,
  disabled,
  id,
  className,
  style,
  ...props
}: SliderProps) {
  const generatedId = useId();
  const inputId = id ?? generatedId;
  const fallbackValue = defaultValue ?? min;
  const [internalValue, setInternalValue] = useState<number>(fallbackValue);
  const currentValue = value !== undefined ? value : internalValue;

  const span = max - min;
  const pct = span > 0 ? Math.min(Math.max(((currentValue - min) / span) * 100, 0), 100) : 0;
  const displayText = formatValue ? formatValue(currentValue) : String(currentValue);

  const inputStyle = {
    ...style,
    '--val': `${pct}%`,
  } as CSSProperties;

  return (
    <div className={cx('bb-slider', className)}>
      <div className="bb-slider__head">
        <label htmlFor={inputId}>{label}</label>
        <span>{displayText}</span>
      </div>
      <input
        id={inputId}
        type="range"
        min={min}
        max={max}
        step={step}
        value={currentValue}
        disabled={disabled}
        aria-valuemin={min}
        aria-valuemax={max}
        aria-valuenow={currentValue}
        aria-valuetext={formatValue ? displayText : undefined}
        style={inputStyle}
        onChange={(event) => {
          const next = Number(event.target.value);
          if (value === undefined) {
            setInternalValue(next);
          }
          onChange?.(next);
        }}
        {...props}
      />
    </div>
  );
}
