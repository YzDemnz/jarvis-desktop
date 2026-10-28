import type { RoutingDecision } from '@/types';
import { modelLabel, providerLabel } from '@/services/ai/ModelRouter';
import { cn } from '@/lib/cn';

const TASK_LABEL: Record<string, string> = {
  chat: 'Conversación',
  code_generation: 'Generación de código',
  code_debugging: 'Depuración de código',
  web_research: 'Investigación web',
  market_analysis: 'Análisis de mercado',
  file_search: 'Búsqueda de archivos',
  computer_control: 'Control del equipo',
  summarization: 'Resumen',
  vision: 'Visión',
  planning: 'Planificación',
};

const FLAGS: { key: keyof RoutingDecision; label: string }[] = [
  { key: 'requiresWeb', label: 'web' },
  { key: 'requiresFiles', label: 'archivos' },
  { key: 'requiresCode', label: 'código' },
  { key: 'requiresReasoning', label: 'razonamiento' },
  { key: 'requiresVision', label: 'visión' },
];

const SOURCE_LABEL: Record<string, string> = {
  ollama: 'Ollama local',
  heuristic: 'Heurístico (Ollama offline)',
  'local-router': 'Router local',
  manual: 'Manual',
  fallback: 'Respaldo',
};

export function RoutingCard({ routing, className }: { routing: RoutingDecision; className?: string }) {
  const active = FLAGS.filter((f) => routing[f.key] === true);
  const tools = routing.suggestedTools ?? [];

  return (
    <div className={cn('rounded border border-hairline bg-white/[0.02] p-2.5', className)}>
      <div className="flex items-baseline gap-2 mb-2">
        <span className="text-2xs uppercase tracking-[0.09em] text-faint">Local Router</span>
        <span className="text-2xs text-faint truncate">{SOURCE_LABEL[routing.routedBy] ?? routing.routedBy}</span>
        <span className="text-2xs text-faint tnum ml-auto shrink-0">{routing.elapsedMs} ms</span>
      </div>

      <dl className="grid grid-cols-[62px_1fr] gap-x-3 gap-y-1 text-xs">
        <dt className="text-faint">Tarea</dt>
        <dd className="text-ink/90">{TASK_LABEL[routing.taskType] ?? routing.taskType}</dd>

        <dt className="text-faint">Dificultad</dt>
        <dd className="flex items-center gap-2">
          <span className="tnum text-ink/90">{routing.difficulty}/10</span>
          <span className="h-[3px] flex-1 max-w-[80px] rounded-full bg-white/[0.07] overflow-hidden">
            <span
              className="block h-full rounded-full bg-signal/70"
              style={{ width: `${routing.difficulty * 10}%` }}
            />
          </span>
        </dd>

        <dt className="text-faint">Elegido</dt>
        <dd className="text-ink/90">
          {providerLabel(routing.preferredProvider)}
          <span className="text-faint"> · {routing.modelTier}</span>
        </dd>

        <dt className="text-faint">Motivo</dt>
        <dd className="text-muted leading-snug">{routing.reason}</dd>

        <dt className="text-faint">Ruta</dt>
        <dd className="text-ink/90">
          {tools.length ? 'Herramientas locales' : 'Sin herramientas'}
          {tools.length > 0 && <span className="text-faint font-mono"> · {tools.join(', ')}</span>}
        </dd>
      </dl>

      {active.length > 0 && (
        <div className="flex flex-wrap gap-1 mt-2 pt-2 hairline-t">
          {active.map((f) => (
            <span key={f.label} className="text-2xs text-muted border border-hairline rounded-xs px-1 h-[15px] leading-[13px]">
              {f.label}
            </span>
          ))}
        </div>
      )}

      <div className="text-2xs text-faint mt-2 font-mono truncate">{modelLabel(routing.selectedModelId)}</div>
    </div>
  );
}
