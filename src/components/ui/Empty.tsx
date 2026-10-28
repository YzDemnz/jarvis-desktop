import type { ReactNode } from 'react';

/** Empty states are an invitation, never an apology. */
export function Empty({ title, action }: { title: string; action?: ReactNode }) {
  return (
    <div className="h-full flex flex-col items-center justify-center gap-3 text-center px-8">
      <p className="text-sm text-muted max-w-sm leading-relaxed">{title}</p>
      {action}
    </div>
  );
}
