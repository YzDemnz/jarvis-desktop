import { useState } from 'react';
import { ChevronDown } from 'lucide-react';
import type { ModelLane } from '@/types';
import { cn } from '@/lib/cn';

const STATE_TONE: Record<ModelLane['state'], string> = {
  idle: 'bg-faint/40',
  queued: 'bg-muted/60',
  working: 'bg-signal',
  done: 'bg-moss',
  failed: 'bg-clay',
};

const STATE_TEXT: Record<ModelLane['state'], string> = {
  idle: 'text-faint',
  queued: 'text-muted',
  working: 'text-ink',
  done: 'text-ink/80',
  failed: 'text-clay',
};

/** Compact by default: one row of dots. Expands into labelled lanes. */
export function MultiAIPanel({ lanes, className }: { lanes: ModelLane[]; className?: string }) {
  const [expanded, setExpanded] = useState(false);
  if (!lanes.length) return null;

  return (
    <div className={cn('rounded border border-hairline bg-white/[0.02]', className)}>
      <button
        onClick={() => setExpanded((v) => !v)}
        className="w-full flex items-center gap-2 h-7 px-2.5 hover:bg-white/[0.03] transition-colors"
      >
        <div className="flex items-center gap-1.5">
          {lanes.map((l) => (
            <span
              key={l.id}
              className={cn('h-1.5 w-1.5 rounded-full', STATE_TONE[l.state], l.state === 'working' && 'animate-pulse')}
            />
          ))}
        </div>
        <span className="text-2xs text-muted truncate">
          {lanes.filter((l) => l.state === 'working').map((l) => l.label).join(', ') ||
            `${lanes.filter((l) => l.state === 'done').length} de ${lanes.length} terminados`}
        </span>
        <ChevronDown className={cn('ml-auto h-3 w-3 text-faint transition-transform', expanded && 'rotate-180')} strokeWidth={1.8} />
      </button>

      {expanded && (
        <div className="hairline-t px-2.5 py-1.5 space-y-1">
          {lanes.map((l) => (
            <div key={l.id} className="flex items-center gap-2 h-5">
              <span className={cn('h-1.5 w-1.5 rounded-full shrink-0', STATE_TONE[l.state], l.state === 'working' && 'animate-pulse')} />
              <span className={cn('text-xs w-14 shrink-0', STATE_TEXT[l.state])}>{l.label}</span>
              <span className="text-2xs text-faint truncate">{l.note ?? l.role}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
