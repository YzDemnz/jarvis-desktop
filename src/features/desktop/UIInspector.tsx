import { useEffect, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import type { UIElementView, WindowInfo } from '@/types';
import { toolBroker } from '@/services/agent/runtime';
import { CancellationToken } from '@/agent';
import { useJarvisStore } from '@/stores/useJarvisStore';
import { useDesktopStore } from '@/stores/useDesktopStore';
import { Button } from '@/components/ui/Button';
import { uid } from '@/lib/id';
import { cn } from '@/lib/cn';

/**
 * Developer view of a window's accessibility tree. It reads through the broker
 * like everything else, so it is audited, permission-checked and gets the
 * credential boundary for free: a password field shows as "protegido".
 */
export function UIInspector() {
  const permission = useJarvisStore((s) => s.permission);
  const helper = useDesktopStore((s) => s.status.helperAvailable);
  const [windows, setWindows] = useState<WindowInfo[]>([]);
  const [selected, setSelected] = useState<string>('');
  const [elements, setElements] = useState<UIElementView[]>([]);
  const [focus, setFocus] = useState<UIElementView | null>(null);
  const [error, setError] = useState<string | null>(null);

  const call = async <T,>(toolId: string, args: unknown): Promise<T | null> => {
    const runId = uid('inspector');
    toolBroker.openRun(runId, permission, new CancellationToken(), 'Inspector de UI');
    try {
      const result = await toolBroker.execute<T>({ runId, toolId, args });
      if (!result.ok) { setError(result.error ?? 'Error'); return null; }
      setError(null);
      return result.data ?? null;
    } finally {
      toolBroker.closeRun(runId);
    }
  };

  const loadWindows = async () => {
    const list = await call<WindowInfo[]>('window.list', {});
    if (list) {
      setWindows(list);
    }
  };

  useEffect(() => { void loadWindows(); }, [helper]);

  useEffect(() => {
    if (!selected) return;
    let active = true;
    void call<{ elements: UIElementView[] }>('ui.inspect', { windowId: selected, depth: 6 }).then((r) => {
      if (!active) return;
      setElements(r?.elements ?? []);
      setFocus(null);
    });
    return () => { active = false; };
  }, [selected]);

  return (
    <div className="space-y-3" data-testid="ui-inspector">
      <div className="flex items-center gap-2">
        <select
          data-testid="inspector-window"
          value={selected}
          onChange={(e) => setSelected(e.target.value)}
          className="flex-1 min-w-0 h-8 rounded-md bg-raised border border-hairline px-2 text-xs text-ink"
        >
          {!windows.length && <option value="">Sin ventanas</option>}
          {!!windows.length && <option value="">Selecciona una ventana</option>}
          {windows.map((w) => (
            <option key={w.windowId} value={w.windowId}>{w.title} · {w.processName}</option>
          ))}
        </select>
        <Button size="xs" variant="ghost" onClick={() => void loadWindows()}>
          <RefreshCw className="h-3 w-3" strokeWidth={1.7} /> Actualizar
        </Button>
      </div>

      {!helper && !windows.length && (
        <p className="text-xs text-muted" data-testid="inspector-unavailable">
          El helper de automatización de Windows no está en ejecución. UI Automation no está disponible.
        </p>
      )}
      {error && <p className="text-2xs text-clay">{error}</p>}

      <div className="grid grid-cols-[1fr_240px] gap-3 min-h-[240px]">
        <div className="rounded-md border border-hairline bg-void/60 p-2 overflow-auto max-h-[380px] scroll-thin" data-testid="inspector-tree">
          {elements.map((e) => (
            <button
              key={e.ref}
              data-testid={`inspector-node-${e.ref}`}
              onClick={() => setFocus(e)}
              className={cn('w-full text-left flex items-center gap-2 h-6 text-2xs rounded-xs px-1', focus?.ref === e.ref ? 'bg-signal/10' : 'hover:bg-white/[0.04]')}
              style={{ paddingLeft: 4 + e.depth * 12 }}
            >
              <span className="font-mono text-faint shrink-0">{e.ref}</span>
              <span className="text-muted shrink-0">{e.controlType}</span>
              <span className="text-ink/85 truncate">{e.name || e.automationId || '—'}</span>
              {e.secret && <span className="text-amber shrink-0">protegido</span>}
            </button>
          ))}
        </div>
        <div className="rounded-md border border-hairline p-3 text-2xs space-y-1.5" data-testid="inspector-details">
          {focus ? (
            <>
              <Row k="name" v={focus.name || '—'} />
              <Row k="controlType" v={focus.controlType} />
              <Row k="automationId" v={focus.automationId || '—'} />
              <Row k="patterns" v={focus.patterns.join(', ') || '—'} />
              <Row k="enabled" v={String(focus.enabled)} />
              <Row k="value" v={focus.secret ? `protegido (${focus.filled ? 'relleno' : 'vacío'})` : focus.value ?? '—'} />
            </>
          ) : <p className="text-faint">Selecciona un elemento.</p>}
        </div>
      </div>
    </div>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex gap-2">
      <span className="text-faint w-[84px] shrink-0 font-mono">{k}</span>
      <span className="text-ink/85 break-all">{v}</span>
    </div>
  );
}
