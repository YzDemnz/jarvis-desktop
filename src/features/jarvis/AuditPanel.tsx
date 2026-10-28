import type { AuditEntry } from '@/types';
import { clock } from '@/lib/format';
import { cn } from '@/lib/cn';

const RESULT_TONE: Record<AuditEntry['result'], string> = {
  ok: 'text-moss',
  error: 'text-clay',
  blocked: 'text-amber',
  cancelled: 'text-faint',
};

/**
 * The trail, verbatim. Arguments arrive already redacted from AuditService —
 * this component never sees a raw value, so it cannot leak one.
 */
export function AuditPanel({ entries, limit = 12 }: { entries: AuditEntry[]; limit?: number }) {
  const visible = entries.slice(0, limit);
  if (!visible.length) return null;

  return (
    <div className="rounded border border-hairline bg-white/[0.02] p-2.5">
      <div className="text-2xs uppercase tracking-[0.09em] text-faint mb-2">Audit</div>
      <ul className="space-y-1">
        {visible.map((entry) => (
          <li key={entry.id} className="flex items-baseline gap-2 min-w-0 text-2xs">
            <span className="tnum text-faint shrink-0">{clock(entry.timestamp)}</span>
            <span className="font-mono text-ink/70 truncate max-w-[130px]">{entry.tool}</span>
            <span className={cn('shrink-0', RESULT_TONE[entry.result])}>{entry.result}</span>
            <span className="text-faint truncate flex-1 min-w-0">{entry.argsSummary}</span>
            <span className="tnum text-faint shrink-0">{entry.durationMs}ms</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
