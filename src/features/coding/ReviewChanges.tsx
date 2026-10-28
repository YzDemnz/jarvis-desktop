import { useEffect, useMemo, useState } from 'react';
import type { ChangeSetSummary } from '@/types';
import { useDevStore } from '@/stores/useDevStore';
import { useJarvisStore } from '@/stores/useJarvisStore';
import { devController } from '@/services/dev/devController';
import { cn } from '@/lib/cn';

const LETTER_TONE: Record<string, string> = { M: 'text-amber', A: 'text-moss', R: 'text-signal', T: 'text-clay', C: 'text-signal' };
const LETTER_LABEL: Record<string, string> = { M: 'modificado', A: 'añadido', R: 'renombrado', T: 'a la papelera', C: 'copiado' };

const rel = (root: string | null, p: string) => (root && p.toLowerCase().startsWith(root.toLowerCase()) ? p.slice(root.length + 1).replace(/\\/g, '/') : p);

function ChangeSetCard({ set }: { set: ChangeSetSummary }) {
  const { showChangeDiff, revertFile, revertRun } = useDevStore();
  // Select the stable array, derive in a memo: a selector that returns a new
  // array on every read makes React re-render forever.
  const allCommands = useDevStore((s) => s.commands);
  const commands = useMemo(() => allCommands.filter((c) => c.runId === set.runId), [allCommands, set.runId]);
  const run = useJarvisStore((s) => s.runs.find((r) => r.id === set.runId) ?? (s.run?.id === set.runId ? s.run : null));
  const delegate = run?.steps.find((st) => st.kind === 'delegate');
  const [counts, setCounts] = useState<Record<string, { add: number; del: number }>>({});

  useEffect(() => {
    let alive = true;
    void (async () => {
      const out: Record<string, { add: number; del: number }> = {};
      for (const f of set.files) {
        const d = await devController().fileDiff(set.runId, f.path).catch(() => null);
        if (!d) continue;
        const lines = d.diff.split('\n');
        out[f.path] = { add: lines.filter((l) => l.startsWith('+') && !l.startsWith('+++')).length, del: lines.filter((l) => l.startsWith('-') && !l.startsWith('---')).length };
      }
      if (alive) setCounts(out);
    })();
    return () => { alive = false; };
  }, [set]);

  // Production requires the main-owned command/snapshot proof. A fixture or
  // passing command without that receipt remains unverified.
  const OUTCOME: Record<string, string> = {
    verified: 'Verificado', no_checks: 'Sin verificación disponible', unverified: 'Sin verificar',
    failed: 'Sigue fallando', no_proposal: 'Sin cambio propuesto',
  };
  const final = set.reverted ? 'Revertido'
    : delegate ? (delegate.outcome ? OUTCOME[delegate.outcome] ?? delegate.outcome : delegate.status === 'running' ? 'En curso' : 'Sin verificar')
    : 'Aplicado (sin verificar)';
  return (
    <div className="border-b border-hairline py-3 px-3" data-testid="changeset" data-run={set.runId} data-reverted={set.reverted ? 'yes' : 'no'}>
      <div className="flex items-center gap-2 mb-2">
        <span className="font-mono text-2xs text-faint">{set.runId.slice(-8)}</span>
        {run && <span className="text-xs text-ink/85 truncate">{run.prompt}</span>}
        <div className="flex-1" />
        <span className={cn('text-2xs', set.reverted ? 'text-faint' : final === 'Verificado' ? 'text-moss' : 'text-amber')} data-testid="changeset-state">{final}</span>
        {!set.reverted && set.files.length > 0 && (
          <button type="button" className="text-2xs text-clay hover:underline" data-testid="revert-run" onClick={() => void revertRun(set.runId)}>Revertir tarea</button>
        )}
      </div>
      {set.files.length === 0 && <div className="text-2xs text-muted">JARVIS no cambió archivos en esta tarea.</div>}
      {set.files.map((f) => {
        const letter = f.status;
        const c = counts[f.toPath ?? f.path] ?? counts[f.path];
        return (
          <div key={`${f.path}-${f.toPath ?? ''}`} className="flex items-center gap-2 h-6" data-testid="changeset-file" data-status={letter}>
            <span className={cn('font-mono text-xs w-3', LETTER_TONE[letter])} title={LETTER_LABEL[letter]}>{letter}</span>
            <span className="font-mono text-xs text-ink/85 truncate">{rel(set.projectRoot, f.path)}{f.toPath ? ` → ${rel(set.projectRoot, f.toPath)}` : ''}</span>
            {c && <span className="font-mono text-2xs"><span className="text-moss">+{c.add}</span> <span className="text-clay">−{c.del}</span></span>}
            <div className="flex-1" />
            <button type="button" className="text-2xs text-signal" data-testid="review-file" onClick={() => void showChangeDiff(set.runId, f.toPath ?? f.path)}>Revisar</button>
            {!set.reverted && <button type="button" className="text-2xs text-clay" data-testid="revert-file" onClick={() => void revertFile(set.runId, f.toPath ?? f.path)}>Revertir archivo</button>}
          </div>
        );
      })}
      {set.preExisting.length > 0 && (
        <div className="mt-2 text-2xs text-muted" data-testid="preexisting">
          Cambios tuyos previos (no son de JARVIS): <span className="font-mono">{set.preExisting.join(', ')}</span>
        </div>
      )}
      {commands.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1" data-testid="verifications">
          {commands.map((c) => (
            <span key={c.id} className={cn('font-mono text-2xs', c.status === 'passed' ? 'text-moss' : c.status === 'failed' ? 'text-clay' : 'text-muted')}>
              {c.status === 'passed' ? '✓' : c.status === 'failed' ? '✗' : '•'} {c.label}
            </span>
          ))}
        </div>
      )}
      {delegate?.summary && <div className="mt-2 text-2xs text-ink/70" data-testid="changeset-summary">{delegate.summary}</div>}
      {delegate?.error && <div className="mt-2 text-2xs text-clay/90" data-testid="changeset-summary">{delegate.error}</div>}
    </div>
  );
}

/** Review Changes: one card per coding run, straight from the ChangeSetStore. */
export function ReviewChanges() {
  const { changeSets, loadChanges, undoLast, lastRevert } = useDevStore();
  useEffect(() => { void loadChanges(); }, [loadChanges]);
  return (
    <div className="h-full flex flex-col min-h-0" data-testid="review-changes">
      <div className="h-8 shrink-0 flex items-center gap-2 px-3 border-b border-hairline">
        <span className="text-2xs text-muted">Cambios de JARVIS por tarea</span>
        <div className="flex-1" />
        <button type="button" className="text-2xs text-clay" data-testid="undo-last" onClick={() => void undoLast()}>Deshacer último cambio de JARVIS</button>
      </div>
      {lastRevert && (
        <div className={cn('px-3 py-2 text-2xs border-b border-hairline', lastRevert.kind === 'success' ? 'text-moss' : lastRevert.kind === 'failure' ? 'text-clay' : 'text-amber')}
          data-testid="revert-result" data-kind={lastRevert.kind}>
          {lastRevert.message}
        </div>
      )}
      <div className="flex-1 min-h-0 overflow-y-auto scroll-thin">
        {changeSets.length ? [...changeSets].reverse().map((s) => <ChangeSetCard key={s.runId} set={s} />) : (
          <div className="px-3 py-3 text-2xs text-muted" data-testid="changes-empty">JARVIS todavía no ha cambiado nada.</div>
        )}
      </div>
    </div>
  );
}
