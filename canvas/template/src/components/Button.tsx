import type { ButtonHTMLAttributes } from 'react';

type Props = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'secondary' | 'ghost';
  size?: 'sm' | 'md';
};

const VARIANTS = {
  primary: 'bg-accent text-white hover:opacity-90',
  secondary: 'border border-line bg-surface text-fg hover:bg-fg/5',
  ghost: 'text-fg hover:bg-fg/5',
};
const SIZES = { sm: 'h-8 px-3 text-sm', md: 'h-9 px-4 text-sm' };

// Rest props go on last, so the canvas points at the screen that uses the button, not at this file.
export function Button({ variant = 'primary', size = 'md', className = '', ...rest }: Props) {
  return <button className={`inline-flex items-center justify-center gap-2 rounded-md font-medium disabled:opacity-50 ${VARIANTS[variant]} ${SIZES[size]} ${className}`} {...rest} />;
}
