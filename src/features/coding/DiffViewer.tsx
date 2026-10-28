import { useMemo, useState } from 'react';
import type { ReactElement, ReactNode } from 'react';
import { diffLines, splitLines } from '@/dev/patch';
import { cn } from '@/lib/cn';

interface Row { left: string | null; right: string | null; ln: number | null; rn: number | null; kind: 'eq' | 'del' | 'ins' | 'mod' }

const MAX_ROWS = 4000;

/** Unified or before/after, from the same Myers diff the agent uses. */
export function DiffViewer({ before, after, title, onClose, actions }: { before: string; after: string; title: string; onClose?: () => void; actions?: ReactNode }) {
  const [mode, setMode] = useState<'unified' | 'split'>('unified');
  const { rows, added, removed, error } = useMemo(() => {
    try {
      if (typeof before !== 'string' || typeof after !== 'string') throw new Error('Diff inválido: faltan los contenidos.');
      const edits = diffLines(splitLines(before).lines, splitLines(after).lines);
      const out: Row[] = [];
      let ln = 1, rn = 1, added = 0, removed = 0;
      for (let i = 0; i < edits.length; i++) {
        const e = edits[i]!;
        if (e.type === 'eq') { out.push({ left: e.line, right: e.line, ln: ln++, rn: rn++, kind: 'eq' }); continue; }
        if (e.type === 'del') {
          removed++;
          const next = edits[i + 1];
          if (next?.type === 'ins') { added++; out.push({ left: e.line, right: next.line, ln: ln++, rn: rn++, kind: 'mod' }); i++; }
          else out.push({ left: e.line, right: null, ln: ln++, rn: null, kind: 'del' });
        } else { added++; out.push({ left: null, right: e.line, ln: null, rn: rn++, kind: 'ins' }); }
      }
      return { rows: out, added, removed, error: null as string | null };
    } catch (e) {
      return { rows: [] as Row[], added: 0, removed: 0, error: e instanceof Error ? e.message : String(e) };
    }
  }, [before, after]);

  const shown = rows.slice(0, MAX_ROWS);
  return (
    <div className="h-full flex flex-col min-h-0" data-testid="diff-viewer">
      <div className="h-9 shrink-0 flex items-center gap-3 px-3 border-b border-hairline">
        <span className="text-xs text-ink/90 truncate" data-testid="diff-title">{title}</span>
        <span className="text-2xs font-mono text-moss" data-testid="diff-added">+{added}</span>
        <span className="text-2xs font-mono text-clay" data-testid="diff-removed">−{removed}</span>
        <div className="flex-1" />
        {actions}
        <button type="button" className={cn('text-2xs px-2 h-6 rounded', mode === 'unified' ? 'bg-white/[0.06] text-ink' : 'text-muted')} onClick={() => setMode('unified')} data-testid="diff-unified">Unificado</button>
        <button type="button" className={cn('text-2xs px-2 h-6 rounded', mode === 'split' ? 'bg-white/[0.06] text-ink' : 'text-muted')} onClick={() => setMode('split')} data-testid="diff-split">Antes | Después</button>
        {onClose && <button type="button" className="text-2xs text-muted hover:text-ink px-2 h-6" onClick={onClose} data-testid="diff-close">Cerrar</button>}
      </div>
      {error ? (
        <div className="p-4 text-xs text-clay" data-testid="diff-error">{error}</div>
      ) : !added && !removed ? (
        <div className="p-4 text-xs text-muted" data-testid="diff-empty">Sin diferencias.</div>
      ) : (
        <div className="flex-1 min-h-0 overflow-auto scroll-thin font-mono text-[12px] leading-[18px]">
          {mode === 'unified' ? (
            <table className="w-full border-collapse" data-testid="diff-table-unified">
              <tbody>
                {shown.flatMap((r, i) => {
                  const lines: ReactElement[] = [];
                  if (r.left !== null && r.kind !== 'eq') lines.push(<tr key={`${i}-d`} className="bg-clay/10" data-kind="del"><td className="w-10 pr-2 text-right text-faint select-none">{r.ln}</td><td className="w-10" /><td className="text-clay/90 whitespace-pre px-2">-{r.left}</td></tr>);
                  if (r.right !== null && r.kind !== 'eq') lines.push(<tr key={`${i}-a`} className="bg-moss/10" data-kind="ins"><td className="w-10" /><td className="w-10 pr-2 text-right text-faint select-none">{r.rn}</td><td className="text-moss/90 whitespace-pre px-2">+{r.right}</td></tr>);
                  if (r.kind === 'eq') lines.push(<tr key={i} data-kind="eq"><td className="w-10 pr-2 text-right text-faint select-none">{r.ln}</td><td className="w-10 pr-2 text-right text-faint select-none">{r.rn}</td><td className="text-ink/60 whitespace-pre px-2"> {r.left}</td></tr>);
                  return lines;
                })}
              </tbody>
            </table>
          ) : (
            <table className="w-full border-collapse table-fixed" data-testid="diff-table-split">
              <tbody>
                {shown.map((r, i) => (
                  <tr key={i}>
                    <td className="w-10 pr-2 text-right text-faint select-none align-top">{r.ln ?? ''}</td>
                    <td className={cn('whitespace-pre px-2 align-top overflow-hidden', r.kind === 'del' || r.kind === 'mod' ? 'bg-clay/10 text-clay/90' : 'text-ink/60')} data-side="before">{r.left ?? ''}</td>
                    <td className="w-10 pr-2 text-right text-faint select-none align-top">{r.rn ?? ''}</td>
                    <td className={cn('whitespace-pre px-2 align-top overflow-hidden', r.kind === 'ins' || r.kind === 'mod' ? 'bg-moss/10 text-moss/90' : 'text-ink/60')} data-side="after">{r.right ?? ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {rows.length > MAX_ROWS && <div className="p-3 text-2xs text-muted">… {rows.length - MAX_ROWS} filas más no mostradas.</div>}
        </div>
      )}
    </div>
  );
}
