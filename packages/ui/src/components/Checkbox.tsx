import {
  useEffect,
  useRef,
  type FieldsetHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
} from 'react';
import { cx } from '../utils.ts';

export interface CheckboxProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> {
  /** Visible label rendered beside the checkbox. */
  label: ReactNode;
  /** Marks the checkbox in error role color. */
  error?: boolean;
  /** Indeterminate visual state. */
  indeterminate?: boolean;
}

export function Checkbox({
  label,
  error = false,
  indeterminate = false,
  className,
  ...props
}: CheckboxProps) {
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (inputRef.current) {
      inputRef.current.indeterminate = indeterminate;
    }
  }, [indeterminate]);

  return (
    <label className={cx('bb-check', error && 'bb-check--error', className)}>
      <input ref={inputRef} type="checkbox" {...props} />
      <span>{label}</span>
    </label>
  );
}

export interface CheckboxGroupProps extends FieldsetHTMLAttributes<HTMLFieldSetElement> {
  /** Visible fieldset legend describing the group of checkboxes. */
  legend: ReactNode;
  children: ReactNode;
}

export function CheckboxGroup({ legend, children, className, ...props }: CheckboxGroupProps) {
  return (
    <fieldset className={cx('bb-group', className)} {...props}>
      <legend>{legend}</legend>
      {children}
    </fieldset>
  );
}
