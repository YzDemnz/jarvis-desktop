import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';

interface Props {
  title?: string;
  meta?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
}

/** The one container primitive. Header is optional and deliberately quiet. */
export function Panel({ title, meta, actions, children, className, bodyClassName }: Props) {
  return (
    <section className={cn('surface rounded-lg overflow-hidden flex flex-col min-h-0', className)}>
      {(title || actions) && (
        <header className="flex items-center gap-3 px-3.5 h-9 hairline-b shrink-0">
          {title && <h2 className="text-xs font-medium text-ink/90">{title}</h2>}
          {meta && <span className="text-2xs text-faint">{meta}</span>}
          {actions && <div className="ml-auto flex items-center gap-1">{actions}</div>}
        </header>
      )}
      <div className={cn('min-h-0 flex-1', bodyClassName)}>{children}</div>
    </section>
  );
}
