import { Hand, Octagon, Pause, Play, ShieldAlert } from 'lucide-react';
import { useDesktopStore } from '@/stores/useDesktopStore';
import { useJarvisStore } from '@/stores/useJarvisStore';
import { cn } from '@/lib/cn';

/**
 * Whenever JARVIS may touch the desktop, this is on screen. There is no state
 * in which the agent can control the computer and this indicator is absent —
 * it renders from the same gate status the input layer obeys.
 */
export function ComputerControlIndicator() {
  const status = useDesktopStore((s) => s.status);
  const { stop, pause, resume, status: runStatus } = useJarvisStore();

  const visible = status.mode === 'active' || status.mode === 'paused' || status.mode === 'blocked';
  if (!visible) return null;

  const paused = status.mode === 'paused' || runStatus === 'paused';
  const blocked = status.mode === 'blocked';

  return (
    <div
      data-testid="control-indicator"
      role="status"
      aria-live="polite"
      className={cn(
        // z-[90]: above every overlay in the app (the highest is z-[80]). The
        // approval dialog's backdrop must never cover STOP or Pause.
        'relative z-[90] shrink-0 h-9 flex items-center gap-3 px-4 hairline-b',
        blocked ? 'bg-amber/[0.08]' : paused ? 'bg-signal/[0.06]' : 'bg-halt/[0.08]',
      )}
    >
      <span className="flex items-center gap-2 shrink-0">
        <span className={cn('h-1.5 w-1.5 rounded-full', blocked ? 'bg-amber' : paused ? 'bg-signal' : 'bg-halt animate-pulse')} />
        <span className="text-2xs font-medium tracking-[0.14em] text-ink">JARVIS CONTROL</span>
      </span>

      <span className="text-xs text-muted truncate flex-1 min-w-0" data-testid="control-action">
        {blocked ? (
          <span className="inline-flex items-center gap-1.5 text-amber">
            <ShieldAlert className="h-3 w-3" strokeWidth={1.8} /> {status.blockedReason ?? 'Control bloqueado.'}
          </span>
        ) : status.humanOverride ? (
          <span className="inline-flex items-center gap-1.5 text-signal" data-testid="human-override">
            <Hand className="h-3 w-3" strokeWidth={1.8} /> Pausado: tomaste el control.
          </span>
        ) : paused ? 'En pausa' : status.currentAction ?? 'Preparado para actuar'}
      </span>

      {paused ? (
        <button data-testid="control-resume" onClick={resume}
          className="h-6 px-2 rounded-xs text-2xs border border-hairline text-ink/90 hover:bg-white/[0.05] inline-flex items-center gap-1.5">
          <Play className="h-3 w-3" strokeWidth={1.9} /> Reanudar
        </button>
      ) : (
        <button data-testid="control-pause" onClick={pause} disabled={blocked}
          className="h-6 px-2 rounded-xs text-2xs border border-hairline text-ink/90 hover:bg-white/[0.05] inline-flex items-center gap-1.5 disabled:opacity-40">
          <Pause className="h-3 w-3" strokeWidth={1.9} /> Pausar
        </button>
      )}
      <button data-testid="control-stop" onClick={stop} aria-label="Detener todo el control"
        className="h-6 px-2.5 rounded-xs text-2xs border border-halt/45 bg-halt/15 text-halt hover:bg-halt/25 inline-flex items-center gap-1.5">
        <Octagon className="h-3 w-3" strokeWidth={2} /> STOP
      </button>
    </div>
  );
}
