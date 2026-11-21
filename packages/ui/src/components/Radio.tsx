import {
  createContext,
  useContext,
  useState,
  type FieldsetHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
} from 'react';
import { cx } from '../utils.ts';

interface RadioGroupContextValue {
  name: string;
  value: string | undefined;
  disabled: boolean;
  onSelect: (nextValue: string) => void;
}

const RadioGroupContext = createContext<RadioGroupContextValue | null>(null);

export interface RadioProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> {
  /** Visible option label. */
  label: ReactNode;
  /** Option value. */
  value: string;
}

export function Radio({
  label,
  value,
  name,
  checked,
  disabled,
  onChange,
  className,
  ...props
}: RadioProps) {
  const group = useContext(RadioGroupContext);

  const resolvedName = name ?? group?.name;
  const resolvedDisabled = disabled ?? group?.disabled ?? false;
  const resolvedChecked = group ? group.value === value : checked;

  return (
    <label className={cx('bb-radio', className)}>
      <input
        type="radio"
        name={resolvedName}
        value={value}
        checked={resolvedChecked}
        disabled={resolvedDisabled}
        onChange={(event) => {
          onChange?.(event);
          if (event.target.checked) {
            group?.onSelect(value);
          }
        }}
        {...props}
      />
      <span>{label}</span>
    </label>
  );
}

export interface RadioOption {
  value: string;
  label: ReactNode;
  disabled?: boolean;
}

export interface RadioGroupProps extends Omit<
  FieldsetHTMLAttributes<HTMLFieldSetElement>,
  'onChange'
> {
  /** Visible legend describing the radio choice. */
  legend: ReactNode;
  /** Shared radio input name. */
  name: string;
  /** Controlled selected value. */
  value?: string;
  /** Initial selected value for uncontrolled usage. */
  defaultValue?: string;
  /** Called when the selected option changes. */
  onChange?: (value: string) => void;
  /** Optional shorthand option list instead of Radio children. */
  options?: readonly RadioOption[];
  children?: ReactNode;
}

export function RadioGroup({
  legend,
  name,
  value,
  defaultValue,
  onChange,
  options,
  children,
  disabled = false,
  className,
  ...props
}: RadioGroupProps) {
  const [internalValue, setInternalValue] = useState<string | undefined>(defaultValue);
  const currentValue = value !== undefined ? value : internalValue;

  const handleSelect = (nextValue: string) => {
    if (value === undefined) {
      setInternalValue(nextValue);
    }
    onChange?.(nextValue);
  };

  return (
    <RadioGroupContext.Provider
      value={{ name, value: currentValue, disabled, onSelect: handleSelect }}
    >
      <fieldset className={cx('bb-group', className)} disabled={disabled} {...props}>
        <legend>{legend}</legend>
        {options
          ? options.map((opt) => (
              <Radio key={opt.value} value={opt.value} label={opt.label} disabled={opt.disabled} />
            ))
          : children}
      </fieldset>
    </RadioGroupContext.Provider>
  );
}
