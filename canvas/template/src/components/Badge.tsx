import type { HTMLAttributes } from 'react';

type Props = HTMLAttributes<HTMLSpanElement> & { tone?: 'neutral' | 'success' | 'warning' | 'danger' };

const TONES = {
  neutral: 'bg-fg/5 text-fg-muted',
  success: 'bg-green-50 text-green-700',
  warning: 'bg-amber-50 text-amber-700',
  danger: 'bg-red-50 text-red-700',
};

export function Badge({ tone = 'neutral', className = '', ...rest }: Props) {
  return <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${TONES[tone]} ${className}`} {...rest} />;
}
