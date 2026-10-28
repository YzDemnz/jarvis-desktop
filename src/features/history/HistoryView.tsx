import { useEffect, useState } from 'react';
import type { TaskState } from '@/fabric/types';
import type { HandoffContext } from '@/fabric/ContextBudgetManager';
import { HandoffContextBuilder } from '@/fabric/ContextBudgetManager';
import { taskFromRun } from '@/fabric/ContinuityState';
import { useJarvisStore } from '@/stores/useJarvisStore';
import { ActivityStream } from '../jarvis/ActivityStream';
import { RoutingCard } from '@/components/RoutingCard';
import { Panel } from '@/components/ui/Panel';
import { Empty } from '@/components/ui/Empty';
import { Dot } from '@/components/ui/Badge';
import { ago } from '@/lib/format';
import type { HistoryEntry } from '@/types/browser';

export function HistoryView() {
  const { runs, events, routing, continuityError } = useJarvisStore();
  const [saved, setSaved] = useState<TaskState[]>([]);
  const [navigation, setNavigation] = useState<HistoryEntry[]>([]);
  const [packet, setPacket] = useState<HandoffContext | null>(null);
  const [limit, setLimit] = useState(8192);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [more, setMore] = useState(false);
  const bridge = window.jarvis?.fabric;
  const refresh = async (next = false) => {
    if (!bridge) return;
    setBusy(true); setError(null);
    try {
      const last = next ? saved.at(-1) : null;
      const rows = await bridge.taskPage(50, last ? { updatedAt: last.updatedAt, taskId: last.taskId } : undefined);
      setSaved(previous => next ? [...previous, ...rows.filter(r => !previous.some(p => p.taskId === r.taskId))] : rows);
      setMore(rows.length === 50);
      setNavigation(await window.jarvis?.browser?.history() ?? []);
    } catch { setError('No se pudo leer el historial guardado.'); }
    finally { setBusy(false); }
  };
  useEffect(() => { void refresh(); }, [runs]);
  const tasks = [...saved, ...runs.filter(r => !saved.some(s => s.taskId === r.id)).map(r => taskFromRun(r, 'session-only'))];
  const prepare = async (task: TaskState) => {
    setBusy(true); setError(null); setNotice(null); setPacket(null);
    try {
      setPacket(bridge && saved.some(t => t.taskId === task.taskId)
        ? await bridge.handoff(task.taskId, limit)
        : new HandoffContextBuilder().build(task, [], limit, limit));
    } catch { setError('No se pudo preparar el paquete de continuidad.'); }
    finally { setBusy(false); }
  };

  return (
    <div className="h-full overflow-y-auto scroll-thin">
      <div className="max-w-[900px] mx-auto px-8 py-10">
        <h1 className="text-xl text-ink tracking-tight mb-1">History</h1>
        <p className="text-sm text-muted mb-4">Tareas y contexto propios de JARVIS, independientes de la IA.</p>
        <div className="flex items-center gap-3 mb-6">
          <button className="text-xs text-signal" disabled={busy || !bridge} onClick={() => void refresh()}>Actualizar tareas guardadas</button>
          <label className="text-xs text-muted">Contexto del destino
            <select aria-label="Contexto del destino" className="ml-2 bg-panel text-ink" value={limit} onChange={e => setLimit(Number(e.target.value))}>
              {[2048, 4096, 8192, 16384, 32768].map(n => <option value={n} key={n}>{n.toLocaleString()} tokens</option>)}
            </select>
          </label>
        </div>
        {!bridge && <p className="text-xs text-amber mb-4">Persistencia no disponible en este entorno. Solo se muestran tareas de la sesión.</p>}
        {(error || continuityError) && <p role="alert" className="text-xs text-clay mb-4">{error ?? continuityError}</p>}

        <div className="grid grid-cols-1 lg:grid-cols-[1fr_300px] gap-3">
          <div className="space-y-3">
            <Panel title="Tareas" meta={`${tasks.length}`}>
              {tasks.length === 0 ? (
                <Empty title="Todavía no has pedido nada. Cuando lo hagas, cada tarea quedará aquí con su ruta y sus eventos." />
              ) : (
                <ul>
                  {tasks.map(t => (
                    <li key={t.taskId} className="flex items-center gap-3 px-3.5 min-h-11 py-2 hairline-b last:border-0">
                      <Dot tone={t.currentTask === 'completed' ? 'moss' : t.currentTask === 'cancelled' ? 'muted' : 'signal'} />
                      <span className="text-xs text-ink/85 truncate flex-1">{t.goal}</span>
                      <span className="text-2xs text-faint shrink-0">{t.currentTask} · {ago(t.updatedAt)}</span>
                      <button aria-label={`Preparar relevo: ${t.goal}`} className="text-xs text-signal shrink-0" disabled={busy} onClick={() => void prepare(t)}>Preparar relevo</button>
                    </li>
                  ))}
                </ul>
              )}
              {more && <button className="text-xs text-signal p-3" disabled={busy} onClick={() => void refresh(true)}>Cargar tareas anteriores</button>}
            </Panel>
            {packet && <Panel title="Paquete de continuidad" bodyClassName="p-3.5">
              <p className="text-xs text-muted mb-2">Estado público, no autorización ni razonamiento privado. No inicia otra IA ni repite acciones.</p>
              <p className="text-xs text-ink mb-2">{packet.budget.estimatedTokens} tokens estimados / {packet.budget.inputBudget} · {packet.budget.omitted} elementos omitidos</p>
              <p className="text-xs text-muted mb-3">Procedencia: {packet.taskId} · {packet.evidence.filter(e => e.source === 'MAIN_PROCESS').length} recibos main · {packet.evidence.filter(e => e.source === 'RENDERER_REPORTED').length} pasos reportados</p>
              <button className="text-xs text-signal mb-3" onClick={() => {
                void navigator.clipboard.writeText(JSON.stringify(packet)).then(() => setNotice('Paquete compacto copiado.')).catch(() => setError('No se pudo copiar el paquete.'));
              }}>Copiar paquete</button>
              {notice && <p role="status" className="text-xs text-moss mb-2">{notice}</p>}
              <pre data-testid="continuity-packet" className="text-2xs text-muted whitespace-pre-wrap break-words max-h-[440px] overflow-auto">{JSON.stringify(packet, null, 2)}</pre>
            </Panel>}

            <Panel title="Eventos del agente" meta={`${events.length}`} bodyClassName="p-3.5">
              {events.length === 0
                ? <p className="text-xs text-faint">Sin eventos en esta sesión.</p>
                : <ActivityStream events={events} showTime />}
            </Panel>

            <Panel title="Navegación">
              <ul>
                {navigation.map((h) => (
                  <li key={h.id} className="flex items-center gap-3 px-3.5 h-10 hairline-b last:border-0">
                    <span className="text-xs text-ink/85 truncate max-w-[45%]">{h.title}</span>
                    <span className="text-2xs text-faint truncate flex-1">{h.url}</span>
                    <span className="text-2xs text-faint shrink-0">{ago(h.visitedAt)}</span>
                  </li>
                ))}
              </ul>
              {!navigation.length && <p className="text-xs text-faint p-3.5">Sin navegación registrada.</p>}
            </Panel>
          </div>

          <div>
            {routing ? <RoutingCard routing={routing} /> : (
              <div className="surface rounded-lg p-4">
                <p className="text-xs text-faint leading-relaxed">
                  La última decisión del router aparecerá aquí en cuanto pidas algo.
                </p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
