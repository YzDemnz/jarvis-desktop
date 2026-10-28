import { useEffect, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Badge, Dot } from '@/components/ui/Badge';
import { bytes } from '@/lib/format';

interface OllamaModel { name: string; size: number; family: string; parameterSize: string }
interface OllamaHealth { online: boolean; endpoint: string; version?: string; models: OllamaModel[]; error?: string }

const OFFLINE: OllamaHealth = { online: false, endpoint: 'http://127.0.0.1:11434', models: [] };

/**
 * Ollama is optional. An unreachable daemon is shown as a plain state, never as
 * an error the user has to dismiss — the app routes heuristically and carries on.
 */
export function OllamaCard() {
  const [health, setHealth] = useState<OllamaHealth | null>(null);
  const [checking, setChecking] = useState(false);

  const check = (force = false) => {
    const bridge = window.jarvis?.agent;
    if (!bridge) { setHealth({ ...OFFLINE, error: 'Sin proceso principal: la UI corre fuera de Electron.' }); return; }
    setChecking(true);
    void bridge.ollamaHealth(force)
      .then(setHealth)
      .catch(() => setHealth({ ...OFFLINE, error: 'No se pudo consultar el estado.' }))
      .finally(() => setChecking(false));
  };

  useEffect(() => { check(); }, []);

  const online = health?.online ?? false;

  return (
    <div className="rounded-lg border border-hairline bg-panel p-4">
      <div className="flex items-center gap-2.5 mb-3">
        <Dot tone={online ? 'moss' : 'muted'} />
        <span className="text-sm text-ink">Ollama</span>
        <Badge tone={online ? 'moss' : 'muted'}>{online ? 'Online' : 'Offline'}</Badge>
        {health?.version && <span className="text-2xs text-faint tnum">v{health.version}</span>}
        <Button
          size="xs"
          variant="ghost"
          className="ml-auto"
          onClick={() => check(true)}
          disabled={checking}
        >
          <RefreshCw className={checking ? 'h-3 w-3 animate-spin' : 'h-3 w-3'} strokeWidth={1.7} />
          Comprobar
        </Button>
      </div>

      <p className="text-2xs text-faint font-mono mb-3">{health?.endpoint ?? OFFLINE.endpoint}</p>

      {online ? (
        health && health.models.length > 0 ? (
          <div className="space-y-px">
            {health.models.slice(0, 8).map((m) => (
              <div key={m.name} className="flex items-center gap-2 h-7 text-xs">
                <span className="font-mono text-ink/85 truncate flex-1">{m.name}</span>
                {m.parameterSize && <span className="text-2xs text-faint">{m.parameterSize}</span>}
                <span className="text-2xs text-faint tnum w-[64px] text-right">{bytes(m.size)}</span>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-xs text-muted">El daemon responde pero no tiene modelos descargados.</p>
        )
      ) : (
        <p className="text-xs text-muted leading-relaxed">
          {health?.error ?? 'No hay respuesta en el puerto.'}
          {' '}JARVIS sigue funcionando: la clasificación pasa al router heurístico local.
        </p>
      )}
    </div>
  );
}
