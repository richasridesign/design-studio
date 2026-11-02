import type { InputHTMLAttributes } from 'react';

type Props = InputHTMLAttributes<HTMLInputElement> & { label?: string };

export function Input({ label, className = '', ...rest }: Props) {
  const field = <input className={`h-9 w-full rounded-md border border-line bg-surface px-3 text-sm text-fg outline-none placeholder:text-fg-muted focus:border-accent ${className}`} {...rest} />;
  if (!label) return field;
  return (
    <label className="flex flex-col gap-1 text-sm font-medium text-fg">
      {label}
      {field}
    </label>
  );
}
