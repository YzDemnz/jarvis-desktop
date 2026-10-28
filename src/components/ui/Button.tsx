import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { cn } from '@/lib/cn';

type Variant = 'ghost' | 'quiet' | 'solid' | 'danger' | 'outline';
type Size = 'xs' | 'sm' | 'md';

interface Props extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  children?: ReactNode;
}

const VARIANTS: Record<Variant, string> = {
  ghost: 'text-muted hover:text-ink hover:bg-white/[0.05]',
  quiet: 'text-muted bg-white/[0.03] hover:bg-white/[0.07] hover:text-ink border border-hairline',
  solid: 'bg-signal/15 text-signal border border-signal/30 hover:bg-signal/22',
  danger: 'bg-halt/15 text-halt border border-halt/35 hover:bg-halt/25',
  outline: 'border border-hairline text-ink hover:bg-white/[0.04]',
};

const SIZES: Record<Size, string> = {
  xs: 'h-6 px-2 text-2xs rounded-xs gap-1',
  sm: 'h-7 px-2.5 text-xs rounded gap-1.5',
  md: 'h-8 px-3 text-sm rounded gap-2',
};

export function Button({ variant = 'ghost', size = 'sm', className, ...rest }: Props) {
  return (
    <button
      type="button"
      className={cn(
        'inline-flex items-center justify-center whitespace-nowrap transition-colors duration-150',
        'disabled:opacity-35 disabled:pointer-events-none',
        VARIANTS[variant],
        SIZES[size],
        className,
      )}
      {...rest}
    />
  );
}

export function IconButton({ className, ...rest }: Props) {
  return <Button className={cn('px-0 w-7', className)} {...rest} />;
}
