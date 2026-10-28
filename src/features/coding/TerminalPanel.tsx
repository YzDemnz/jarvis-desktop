import { useEffect, useRef, useState } from 'react';
import { Check, CircleSlash, Loader2, Search, Square, X } from 'lucide-react';
import type { ManagedProcessInfo } from '@/types';
import { useDevStore } from '@/stores/useDevStore';
import { useJarvisStore } from '@/stores/useJarvisStore';
import { devController } from '@/services/dev/devController';
import type { CommandLogEntry } from '@/services/dev/devController';
import { cn } from '@/lib/cn';

const STATUS: Record<CommandLogEntry['status'], { icon: typeof Check; tone: string; label: string }> = {
  running: { icon: Loader2, tone: 'text-signal', label: 'en curso' },
  passed: { icon: Check, tone: 'text-moss', label: 'correcto' },
  failed: { icon: X, tone: 'text-clay', label: 'falló' },
  cancelled: { icon: CircleSlash, tone: 'text-faint', label: 'cancelado' },
};

function CommandRow({ entry }: { entry: CommandLogEntry }) {
  // A failed command opens to show its error — whether it failed while visible
  // or before the panel mounted. The user can always fold it again.
  const [open, setOpen] = useState(entry.status === 'failed');
  const previous = useRef(entry.status);
  useEffect(() => {
    if (entry.status === 'failed' && previous.current !== 'failed') setOpen(true);
    previous.current = entry.status;
  }, [entry.status]);
  const [q, setQ] = useState('');
  const [hits, setHits] = useState<{ line: number; text: string }[] | null>(null);
  const stop = useJarvisStore((s) => s.stop);
  const s = STATUS[entry.status];
  const Icon = s.icon;
  const r = entry.result;
  const output = r ? [r.stdout, r.stderr && `--- stderr ---\n${r.stderr}`].filter(Boolean).join('\n') : entry.live || entry.error || '';

  return (
    <div className="border-b border-hairline/60" data-testid="terminal-command" data-status={entry.status}>
      <button type="button" onClick={() => setOpen(!open)} className="w-full flex items-center gap-2 h-8 px-3 text-left hover:bg-white/[0.03]">
        <Icon className={cn('h-3 w-3 shrink-0', s.tone, entry.status === 'running' && 'animate-spin')} />
        <span className="font-mono text-xs text-ink/90 truncate" data-testid="terminal-label">{entry.label}</span>
        <span className="font-mono text-2xs text-faint truncate max-w-[40%]" data-testid="terminal-cwd" title={entry.cwd}>{entry.cwd}</span>
        <div className="flex-1" />
        {r?.truncated && <span className="text-2xs text-amber" data-testid="terminal-truncated">salida recortada</span>}
        {r && <span className="font-mono text-2xs text-muted" data-testid="terminal-exit">exit {r.exitCode ?? '—'}{r.timedOut ? ' · timeout' : ''}</span>}
        {r && <span className="font-mono text-2xs text-faint" data-testid="terminal-duration">{(r.durationMs / 1000).toFixed(1)} s</span>}
        <span className={cn('text-2xs', s.tone)}>{s.label}</span>
      </button>
      {entry.status === 'running' && (
        <div className="px-3 pb-2">
          <button type="button" data-testid="terminal-stop" onClick={stop} className="inline-flex items-center gap-1 h-6 px-2 rounded bg-halt/15 text-halt text-2xs">
            <Square className="h-2.5 w-2.5" /> Detener (STOP)
          </button>
        </div>
      )}
      {open && (
        <div className="px-3 pb-3">
          {r?.outputId && (
            <div className="flex items-center gap-1.5 mb-2">
              <Search className="h-3 w-3 text-faint" />
              <input data-testid="terminal-search" className="flex-1 bg-transparent text-2xs text-ink outline-none border-b border-hairline" placeholder="Buscar en la salida completa…" value={q}
                onChange={(e) => setQ(e.target.value)}
                onKeyDown={async (e) => { if (e.key === 'Enter' && q.trim()) setHits(await devController().outputSearch(r.outputId!, q.trim())); }} />
            </div>
          )}
          {hits ? (
            <pre className="font-mono text-2xs text-ink/80 max-h-60 overflow-auto scroll-thin whitespace-pre-wrap" data-testid="terminal-search-results">
              {hits.length ? hits.map((h) => `${h.line}: ${h.text}`).join('\n') : 'Sin coincidencias.'}
            </pre>
          ) : (
            <pre className="font-mono text-2xs text-ink/75 max-h-60 overflow-auto scroll-thin whitespace-pre-wrap" data-testid="terminal-output">{output || '(sin salida)'}</pre>
          )}
        </div>
      )}
    </div>
  );
}

function Services() {
  const [items, setItems] = useState<ManagedProcessInfo[]>([]);
  const [logs, setLogs] = useState<{ id: string; lines: string[] } | null>(null);
  const commands = useDevStore((s) => s.commands);
  useEffect(() => { void devController().processes().then(setItems).catch(() => setItems([])); }, [commands]);
  if (!items.length) return null;
  return (
    <div className="border-b border-hairline" data-testid="terminal-services">
      {items.map((p) => (
        <div key={p.id} className="flex items-center gap-2 h-8 px-3" data-testid="managed-process" data-status={p.status}>
          <span className={cn('h-1.5 w-1.5 rounded-full', p.status === 'running' ? 'bg-moss' : 'bg-faint')} />
          <span className="font-mono text-xs text-ink/85 truncate">{p.label}</span>
          <span className="text-2xs text-muted">{p.status === 'running' ? 'Running' : p.status}</span>
          <div className="flex-1" />
          <button type="button" className="text-2xs text-muted hover:text-ink" data-testid="process-logs"
            onClick={async () => setLogs({ id: p.id, lines: await devController().processLogs(p.id).catch(() => ['(el proceso ya no existe)']) })}>Ver logs</button>
          {p.status === 'running' && (
            <button type="button" className="text-2xs text-halt" data-testid="process-stop"
              onClick={async () => { await devController().stopProcess(p.id).catch(() => {}); setItems(await devController().processes()); }}>Stop</button>
          )}
        </div>
      ))}
      {logs && <pre className="font-mono text-2xs text-ink/75 max-h-40 overflow-auto scroll-thin px-3 pb-2 whitespace-pre-wrap" data-testid="process-log-output">{logs.lines.join('\n') || '(sin salida)'}</pre>}
    </div>
  );
}

/** Commands JARVIS ran (through the broker) and the services it started. */
export function TerminalPanel() {
  const commands = useDevStore((s) => s.commands);
  const project = useDevStore((s) => s.project);
  const submit = useJarvisStore((s) => s.submit);
  return (
    <div className="h-full flex flex-col min-h-0" data-testid="terminal-panel">
      <div className="h-8 shrink-0 flex items-center gap-2 px-3 border-b border-hairline">
        <span className="text-2xs text-muted">Los comandos se ejecutan como llamadas estructuradas a través de JARVIS (sin shell).</span>
        <div className="flex-1" />
        {project && (
          <>
            <button type="button" className="text-2xs text-signal" data-testid="terminal-run-tests" data-authority-action onClick={() => submit(`Ejecuta las pruebas del proyecto ${project.name}`)}>Ejecutar pruebas</button>
            <button type="button" className="text-2xs text-signal" data-testid="terminal-git-status" data-authority-action onClick={() => submit('git status')}>git status</button>
          </>
        )}
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto scroll-thin">
        <Services />
        {commands.length ? [...commands].reverse().map((c) => <CommandRow key={c.id} entry={c} />) : (
          <div className="px-3 py-3 text-2xs text-muted" data-testid="terminal-empty">Todavía no se ha ejecutado ningún comando.</div>
        )}
      </div>
    </div>
  );
}
