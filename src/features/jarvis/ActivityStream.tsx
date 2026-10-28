import { Check, Circle, CircleDashed, Loader2, ShieldAlert, X } from 'lucide-react';
import type { AgentEvent, AgentEventStatus } from '@/types';
import { clock } from '@/lib/format';
import { cn } from '@/lib/cn';

const MARKS: Record<AgentEventStatus, { icon: typeof Check; tone: string }> = {
  queued: { icon: Circle, tone: 'text-faint' },
  running: { icon: Loader2, tone: 'text-signal' },
  completed: { icon: Check, tone: 'text-moss' },
  failed: { icon: X, tone: 'text-clay' },
  cancelled: { icon: CircleDashed, tone: 'text-faint' },
  awaiting_approval: { icon: ShieldAlert, tone: 'text-amber' },
};

export function ActivityStream({ events, limit, showTime = false }: {
  events: AgentEvent[];
  limit?: number;
  showTime?: boolean;
}) {
  const visible = limit ? events.slice(-limit) : events;
  if (!visible.length) return null;

  return (
    <ul className="space-y-1">
      {visible.map((e) => {
        const mark = MARKS[e.status];
        const Icon = mark.icon;
        return (
          <li key={e.id} className="flex items-start gap-2 min-w-0">
            <Icon
              className={cn('h-3 w-3 mt-[3px] shrink-0', mark.tone, e.status === 'running' && 'animate-spin')}
              strokeWidth={2}
            />
            <span
              className={cn(
                'text-xs leading-snug min-w-0 flex-1',
                e.status === 'cancelled' ? 'text-faint line-through' : 'text-muted',
              )}
            >
              {/* Expanded view: the raw tool and its target, like a terminal log. */}
              {showTime && e.type === 'tool_call' && e.status === 'running' ? (
                <span className="font-mono text-2xs" data-testid="activity-tool">
                  <span className="text-ink/80">{e.tool}</span>
                  {typeof e.metadata?.target === 'string' && <span className="text-faint"> {e.metadata.target}</span>}
                </span>
              ) : e.description}
            </span>
            {showTime && <span className="text-2xs text-faint tnum shrink-0">{clock(e.timestamp)}</span>}
          </li>
        );
      })}
    </ul>
  );
}
