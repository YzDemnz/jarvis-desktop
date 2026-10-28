import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';

type Tone = 'neutral' | 'signal' | 'moss' | 'clay' | 'amber' | 'muted';

const TONES: Record<Tone, string> = {
  neutral: 'text-ink/80 bg-white/[0.05] border-hairline',
  signal: 'text-signal bg-signal/10 border-signal/25',
  moss: 'text-moss bg-moss/10 border-moss/25',
  clay: 'text-clay bg-clay/10 border-clay/25',
  amber: 'text-amber bg-amber/10 border-amber/25',
  muted: 'text-faint bg-transparent border-hairline',
};

export function Badge({ tone = 'neutral', children, className }: { tone?: Tone; children: ReactNode; className?: string }) {
  return (
    <span className={cn('inline-flex items-center gap-1 h-5 px-1.5 rounded-xs border text-2xs', TONES[tone], className)}>
      {children}
    </span>
  );
}

export function Dot({ tone = 'neutral', className }: { tone?: Tone; className?: string }) {
  const color = { neutral: 'bg-muted', signal: 'bg-signal', moss: 'bg-moss', clay: 'bg-clay', amber: 'bg-amber', muted: 'bg-faint' }[tone];
  return <span className={cn('h-1.5 w-1.5 rounded-full shrink-0', color, className)} />;
}
