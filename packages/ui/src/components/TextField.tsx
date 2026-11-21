import { useId, type InputHTMLAttributes, type ReactNode } from 'react';
import { WarningIcon } from '../icons.tsx';
import { cx } from '../utils.ts';

export interface TextFieldProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'id'> {
  /** Visible label always rendered above the box (never floating or placeholder-only). */
  label: string;
  /** Helper text shown below the input. */
  helperText?: string;
  /** Error state or plain-language fix message. Replaces helperText with warning icon when a string. */
  error?: string | boolean;
  /** Optional decorative leading pixel icon inside the box. */
  leadingIcon?: ReactNode;
  id?: string;
}

export function TextField({
  label,
  helperText,
  error = false,
  leadingIcon,
  id,
  className,
  ...props
}: TextFieldProps) {
  const generatedId = useId();
  const inputId = id ?? generatedId;
  const helpId = `${inputId}-help`;
  const hasError = Boolean(error);
  const errorMessage = typeof error === 'string' ? error : undefined;
  const helpContent = errorMessage ?? helperText;

  return (
    <div className={cx('bb-field', hasError && 'bb-field--error', className)}>
      <label className="bb-field__label" htmlFor={inputId}>
        {label}
      </label>
      <span className="bb-field__box">
        {leadingIcon}
        <input
          id={inputId}
          className="bb-field__input"
          aria-invalid={hasError || undefined}
          aria-describedby={helpContent ? helpId : undefined}
          {...props}
        />
      </span>
      {helpContent && (
        <span className="bb-field__help" id={helpId}>
          {hasError && <WarningIcon small />}
          <span>{helpContent}</span>
        </span>
      )}
    </div>
  );
}
