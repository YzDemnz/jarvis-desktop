import { useState } from 'react';
import { ExternalLink, Play, RefreshCw, Square } from 'lucide-react';
import { useMachineStore } from '@/stores/useMachineStore';
import { Button } from '@/components/ui/Button';
import { Badge, Dot } from '@/components/ui/Badge';
import { bytes } from '@/lib/format';
import { cn } from '@/lib/cn';
import { BootstrapIntelligence } from '../firstRun/BootstrapIntelligence';

const RATING_TONE: Record<string, string> = {
  EXCELLENT: 'text-moss', GOOD: 'text-moss/80', USABLE: 'text-amber',
  SLOW: 'text-clay', NOT_RECOMMENDED: 'text-clay',
};

export function LocalAISection() {
  const {
    localAI, recommendation, benchmark, discoverLocalAI, runBenchmark, cancelBenchmark, openOfficialSource,
  } = useMachineStore();
  const [busy, setBusy] = useState(false);
  const [showAlternatives, setShowAlternatives] = useState(false);
  if (window.jarvis?.bootstrap) return <BootstrapIntelligence />;

  const active = localAI?.runtimes.find((r) => r.runtimeId === localAI.activeRuntimeId);
  const installed = localAI?.runtimes.flatMap((r) => r.models) ?? [];

  const bench = async () => {
    if (!active || !installed.length) return;
    setBusy(true);
    await runBenchmark(active.runtimeId, installed[0]!.name);
    setBusy(false);
  };

  return (
    <div className="space-y-4">
      <section className="rounded-lg border border-hairline bg-panel p-4">
        <div className="flex items-center gap-2.5 mb-3">
          <Dot tone={localAI?.status === 'READY' ? 'moss' : localAI?.status === 'NO_MODELS' ? 'amber' : 'muted'} />
          <h3 className="text-sm text-ink">{active?.name ?? 'Sin runtime'}</h3>
          <Badge tone={localAI?.status === 'READY' ? 'moss' : 'muted'}>{localAI?.status ?? 'NOT_CONFIGURED'}</Badge>
          <Button size="xs" variant="ghost" className="ml-auto" data-testid="reoptimize" onClick={() => void discoverLocalAI()}>
            <RefreshCw className="h-3 w-3" strokeWidth={1.7} /> Reoptimizar
          </Button>
        </div>

        <dl className="grid grid-cols-[110px_1fr] gap-y-2 text-xs">
          <dt className="text-faint">Router</dt><dd className="text-ink/90">{recommendation?.router?.displayName ?? 'Sin asignar'}</dd>
          <dt className="text-faint">Modelo general</dt><dd className="text-ink/90">{recommendation?.generalModel?.displayName ?? 'Sin asignar'}</dd>
          <dt className="text-faint">Aceleración</dt><dd className="text-ink/90">{(recommendation?.acceleration ?? 'cpu').toUpperCase()}</dd>
          <dt className="text-faint">Memoria estimada</dt>
          <dd className="text-ink/90 tnum">{recommendation?.router ? bytes(recommendation.router.estimatedRamBytes) : '—'}</dd>
          <dt className="text-faint">Benchmark</dt>
          <dd className={cn('text-ink/90', benchmark && RATING_TONE[benchmark.rating])}>
            {benchmark
              ? benchmark.cancelled ? 'Cancelado'
                : `${benchmark.rating}${benchmark.tokensPerSecond ? ` · ${benchmark.tokensPerSecond} tok/s` : ''}`
              : 'Sin ejecutar'}
          </dd>
        </dl>

        <div className="flex flex-wrap items-center gap-2 mt-4">
          <Button size="xs" variant="quiet" data-testid="run-benchmark" onClick={() => void bench()} disabled={!active || !installed.length || busy}>
            <Play className="h-3 w-3" strokeWidth={1.8} /> Benchmark
          </Button>
          {busy && (
            <Button size="xs" variant="ghost" onClick={cancelBenchmark}>
              <Square className="h-3 w-3" strokeWidth={1.8} /> Cancelar
            </Button>
          )}
          <Button size="xs" variant="ghost" onClick={() => setShowAlternatives((v) => !v)}>Ver alternativas</Button>
          {recommendation?.router && (
            <Button size="xs" variant="ghost" data-testid="open-official" onClick={() => openOfficialSource(recommendation.router!.downloadPage)}>
              <ExternalLink className="h-3 w-3" strokeWidth={1.7} /> Página oficial
            </Button>
          )}
        </div>
        <p className="text-2xs text-faint mt-2.5">
          La descarga se hace desde la página oficial. JARVIS no instala ni ejecuta nada por su cuenta.
        </p>
      </section>

      <section className="rounded-lg border border-hairline bg-panel p-4">
        <h3 className="text-sm text-ink mb-3">Modelos instalados</h3>
        {installed.length ? (
          <div className="space-y-px">
            {installed.map((m) => (
              <div key={m.id} className="flex items-center gap-2 h-7 text-xs" data-testid={`model-${m.name}`}>
                <span className="font-mono text-ink/85 truncate flex-1">{m.name}</span>
                {m.parameterSize && <span className="text-2xs text-faint">{m.parameterSize}</span>}
                {m.quantization && <span className="text-2xs text-faint">{m.quantization}</span>}
                <span className="text-2xs text-faint tnum w-[62px] text-right">{m.diskBytes ? bytes(m.diskBytes) : '—'}</span>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-xs text-muted">
            No hay modelos instalados. JARVIS sigue funcionando: la clasificación pasa al router heurístico local.
          </p>
        )}
      </section>

      {showAlternatives && (
        <section className="rounded-lg border border-hairline bg-panel p-4" data-testid="settings-alternatives">
          <h3 className="text-sm text-ink mb-3">Alternativas para este equipo</h3>
          <div className="space-y-px">
            {(recommendation?.alternatives ?? []).map((m) => (
              <div key={m.id} className="flex items-center gap-2 h-7 text-xs">
                <span className="text-ink/85 truncate flex-1">{m.displayName}</span>
                <span className="text-2xs text-faint">{m.tier}</span>
                <span className="text-2xs text-faint tnum w-[62px] text-right">{bytes(m.diskBytes)}</span>
              </div>
            ))}
            {!recommendation?.alternatives.length && <p className="text-xs text-muted">Sin alternativas compatibles.</p>}
          </div>
        </section>
      )}
    </div>
  );
}
