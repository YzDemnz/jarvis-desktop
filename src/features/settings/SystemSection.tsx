import { RefreshCw } from 'lucide-react';
import type { Capability, CapabilityState } from '@/types';
import { useMachineStore, summarizeCapabilities } from '@/stores/useMachineStore';
import { pickBestGPU, totalFreeDisk } from '@/machine/performance';
import { permissionLabel } from '@/machine/CapabilityRegistry';
import { Button } from '@/components/ui/Button';
import { bytes } from '@/lib/format';
import { cn } from '@/lib/cn';

const STATE_TONE: Record<CapabilityState, string> = {
  AVAILABLE: 'text-moss',
  RESTRICTED: 'text-amber',
  DISABLED: 'text-faint',
  UNAVAILABLE: 'text-clay/80',
};

const STATE_LABEL: Record<CapabilityState, string> = {
  AVAILABLE: 'disponible',
  RESTRICTED: 'restringida',
  DISABLED: 'deshabilitada',
  UNAVAILABLE: 'no disponible',
};

/** Four things worth knowing up front; everything else behind Details. */
export function SystemSection() {
  const { profile, localAI, recommendation, capabilities, phase, analyze } = useMachineStore();
  const gpu = profile ? pickBestGPU(profile) : null;
  const free = profile ? totalFreeDisk(profile) : null;
  const summary = summarizeCapabilities(capabilities as Capability[]);

  return (
    <div className="space-y-4">
      <section className="rounded-lg border border-hairline bg-panel p-4">
        <div className="flex items-center mb-3">
          <h3 className="text-sm text-ink">Este equipo</h3>
          <Button
            size="xs" variant="ghost" className="ml-auto"
            data-testid="reanalyze"
            onClick={() => void analyze(true)}
            disabled={phase === 'loading'}
          >
            <RefreshCw className={cn('h-3 w-3', phase === 'loading' && 'animate-spin')} strokeWidth={1.7} />
            Volver a analizar
          </Button>
        </div>
        <dl className="grid grid-cols-[86px_1fr] gap-y-2 text-xs">
          <dt className="text-faint">CPU</dt>
          <dd className="text-ink/90">
            {profile?.cpu.model ?? 'No disponible'}
            {profile?.cpu.logicalThreads && <span className="text-faint"> · {profile.cpu.logicalThreads} hilos</span>}
          </dd>
          <dt className="text-faint">Memoria</dt>
          <dd className="text-ink/90 tnum">
            {profile?.memory.totalBytes ? bytes(profile.memory.totalBytes) : 'No disponible'}
            {profile?.memory.availableBytes && <span className="text-faint"> · {bytes(profile.memory.availableBytes)} libres</span>}
          </dd>
          <dt className="text-faint">Gráficos</dt>
          <dd className="text-ink/90">
            {gpu ? gpu.model ?? gpu.vendor : 'No detectados'}
            {gpu?.vramBytes && <span className="text-faint tnum"> · {bytes(gpu.vramBytes)}</span>}
          </dd>
          <dt className="text-faint">Disco</dt>
          <dd className="text-ink/90 tnum">
            {free === null ? 'No disponible' : `${free.toFixed(0)} GB libres`}
          </dd>
        </dl>

        {profile && (
          <details className="mt-3">
            <summary className="text-2xs text-faint cursor-pointer">Información avanzada</summary>
            <dl className="grid grid-cols-[110px_1fr] gap-y-1.5 text-2xs mt-2.5">
              <dt className="text-faint">Sistema</dt><dd className="text-muted">{profile.os.name ?? profile.os.platform} {profile.os.version ?? ''}</dd>
              <dt className="text-faint">Arquitectura</dt><dd className="text-muted">{profile.cpu.architecture}</dd>
              <dt className="text-faint">Núcleos</dt><dd className="text-muted">{profile.cpu.physicalCores ?? 'No disponible'}</dd>
              <dt className="text-faint">Pantallas</dt><dd className="text-muted">{profile.displays.length || 'No disponible'}</dd>
              <dt className="text-faint">Batería</dt><dd className="text-muted">{profile.power.batteryPresent === null ? 'No disponible' : profile.power.batteryPresent ? `${profile.power.batteryPercent ?? '?'}%` : 'Sin batería'}</dd>
              <dt className="text-faint">Origen</dt><dd className="text-muted">{profile.source}</dd>
              {profile.unavailable.length > 0 && (
                <>
                  <dt className="text-faint">No disponible</dt>
                  <dd className="text-muted break-words">{profile.unavailable.join(', ')}</dd>
                </>
              )}
            </dl>
          </details>
        )}
      </section>

      <section className="rounded-lg border border-hairline bg-panel p-4">
        <h3 className="text-sm text-ink mb-3">IA local</h3>
        <dl className="grid grid-cols-[86px_1fr] gap-y-2 text-xs">
          <dt className="text-faint">Runtime</dt>
          <dd className="text-ink/90">{localAI?.activeRuntimeId ?? 'Ninguno detectado'}</dd>
          <dt className="text-faint">Router</dt>
          <dd className="text-ink/90">{recommendation?.router?.displayName ?? 'Sin asignar'}</dd>
          <dt className="text-faint">Aceleración</dt>
          <dd className="text-ink/90">{(recommendation?.acceleration ?? 'cpu').toUpperCase()}</dd>
          <dt className="text-faint">Rendimiento</dt>
          <dd className="text-ink/90">{recommendation?.expectedPerformance ?? '—'}</dd>
        </dl>
      </section>

      <section className="rounded-lg border border-hairline bg-panel p-4">
        <div className="flex items-center gap-2 mb-3">
          <h3 className="text-sm text-ink">Capacidades de JARVIS</h3>
          <span className="text-2xs text-faint ml-auto tnum" data-testid="capability-summary">
            {summary.AVAILABLE} disponibles · {summary.RESTRICTED} restringidas
          </span>
        </div>
        <details>
          <summary className="text-2xs text-faint cursor-pointer">Ver las {capabilities.length}</summary>
          <div className="mt-2.5 space-y-px">
            {capabilities.map((c) => (
              <div key={c.id} className="flex items-baseline gap-2 text-2xs h-6" data-testid={`capability-${c.id}`}>
                <span className="font-mono text-muted w-[160px] shrink-0 truncate">{c.id}</span>
                <span className={cn('shrink-0 w-[84px]', STATE_TONE[c.state])}>{STATE_LABEL[c.state]}</span>
                <span className="text-faint truncate flex-1">{c.reason ?? permissionLabel(c.requiredPermission)}</span>
              </div>
            ))}
          </div>
        </details>
      </section>
    </div>
  );
}
