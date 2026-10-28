import { Clock, Play, Zap } from 'lucide-react';
import { Panel } from '@/components/ui/Panel';
import { Badge } from '@/components/ui/Badge';
import { Toggle } from '@/components/ui/Field';
import { useState } from 'react';
import { TOOL_REGISTRY } from '@/services/agent/tools';
import { ago } from '@/lib/format';

const AUTOMATIONS = [
  { id: 'a1', name: 'Resumen de mercado matutino', trigger: 'Todos los días a las 07:30', tools: ['market_data', 'browser', 'model'], lastRun: Date.now() - 3600_000 * 9, enabled: true },
  { id: 'a2', name: 'Respaldo del servidor Reforger', trigger: 'Domingos a las 03:00', tools: ['terminal', 'filesystem'], lastRun: Date.now() - 86_400_000 * 4, enabled: true },
  { id: 'a3', name: 'Revisión de ramas sin confirmar', trigger: 'Al abrir Coding', tools: ['git'], lastRun: Date.now() - 1800_000, enabled: false },
  { id: 'a4', name: 'Archivar descargas antiguas', trigger: 'Cuando el SSD supere el 85%', tools: ['filesystem'], lastRun: Date.now() - 86_400_000 * 11, enabled: false },
];

export function AutomationsView() {
  const [state, setState] = useState(() => Object.fromEntries(AUTOMATIONS.map((a) => [a.id, a.enabled])));

  return (
    <div className="h-full overflow-y-auto scroll-thin">
      <div className="max-w-[860px] mx-auto px-8 py-10">
        <h1 className="text-xl text-ink tracking-tight mb-1">Automations</h1>
        <p className="text-sm text-muted mb-8">Tareas que JARVIS ejecutará solo, con las mismas reglas de permiso y aprobación.</p>

        <Panel>
          <ul>
            {AUTOMATIONS.map((a) => (
              <li key={a.id} className="flex items-center gap-4 px-4 h-16 hairline-b last:border-0">
                <span className="h-7 w-7 rounded grid place-items-center bg-white/[0.04] border border-hairline shrink-0">
                  <Zap className="h-3.5 w-3.5 text-faint" strokeWidth={1.7} />
                </span>

                <div className="min-w-0 flex-1">
                  <div className="text-sm text-ink/90 truncate">{a.name}</div>
                  <div className="flex items-center gap-1.5 text-2xs text-faint mt-0.5">
                    <Clock className="h-3 w-3" strokeWidth={1.8} />
                    {a.trigger}
                  </div>
                </div>

                <div className="hidden md:flex items-center gap-1 shrink-0">
                  {a.tools.map((t) => (
                    <Badge key={t} tone="muted">{TOOL_REGISTRY.find((x) => x.id === t)?.name ?? t}</Badge>
                  ))}
                </div>

                <span className="text-2xs text-faint shrink-0 w-20 text-right">{ago(a.lastRun)}</span>

                <button className="text-faint hover:text-signal transition-colors shrink-0" aria-label={`Ejecutar ${a.name}`}>
                  <Play className="h-3.5 w-3.5" strokeWidth={1.8} />
                </button>

                <Toggle
                  checked={state[a.id] ?? false}
                  onChange={(v) => setState((s) => ({ ...s, [a.id]: v }))}
                  label={`Activar ${a.name}`}
                />
              </li>
            ))}
          </ul>
        </Panel>

        <p className="text-2xs text-faint mt-4">
          Las automatizaciones están simuladas. Ninguna se ejecuta todavía en el sistema.
        </p>
      </div>
    </div>
  );
}
