import type { HTMLAttributes } from 'react';

export function Card({ className = '', ...rest }: HTMLAttributes<HTMLDivElement>) {
  return <div className={`rounded-lg border border-line bg-surface ${className}`} {...rest} />;
}
