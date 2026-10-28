import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Check, ChevronRight, CircleDashed, Cpu, Eye, Loader2, Lock, ShieldCheck, Sparkles } from 'lucide-react';
import type { Capability, PermissionLevel, SessionPolicy } from '@/types';
import { useMachineStore, summarizeCapabilities } from '@/stores/useMachineStore';
import { permissionLabel } from '@/machine/CapabilityRegistry';
import { performanceWording } from '@/machine/performance';
import { JarvisOrb } from '@/components/JarvisOrb';
import { Button } from '@/components/ui/Button';
import { bytes } from '@/lib/format';
import { cn } from '@/lib/cn';
import { BootstrapIntelligence } from './BootstrapIntelligence';

const GB = 1024 ** 3;

/**
 * Onboarding lives over the shell rather than replacing it, so the app is
 * already there the moment it finishes. Transitions are short on purpose: the
 * analysis really is fast, and faking a progress bar would be a lie.
 */
export function FirstRunOverlay() {
  const store = useMachineStore();
  if (!store.firstRunActive) return null;

  return (
    <AnimatePresence>
      <motion.div
        data-testid="first-run"
        className="fixed inset-0 z-[80] bg-void flex flex-col"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.2 }}
      >
        <div className="flex-1 min-h-0 overflow-y-auto scroll-thin grid place-items-center px-8 py-12">
          <div className="w-full max-w-[560px]">
            <Step />
          </div>
        </div>
        <Progress />
      </motion.div>
    </AnimatePresence>
  );
}

function Progress() {
  const step = useMachineStore((s) => s.firstRunStep);
  const steps = ['welcome', 'system', 'localAI', 'recommendation', 'access', 'privacy', 'ready'];
  const index = steps.indexOf(step);
  return (
    <div className="h-10 shrink-0 hairline-t flex items-center gap-1.5 px-6">
      {steps.map((s, i) => (
        <span
          key={s}
          className={cn('h-[2px] flex-1 rounded-full transition-colors',
            i <= index ? 'bg-signal/70' : 'bg-hairline')}
        />
      ))}
      <span className="text-2xs text-faint tnum ml-3">{index + 1}/{steps.length}</span>
    </div>
  );
}

function Step() {
  const step = useMachineStore((s) => s.firstRunStep);
  switch (step) {
    case 'welcome': return <Welcome />;
    case 'system': return <SystemAnalysis />;
    case 'localAI': return window.jarvis?.bootstrap ? <BootstrapIntelligence onContinue={() => { useMachineStore.getState().nextStep(); useMachineStore.getState().nextStep(); }} /> : <LocalAICheck />;
    case 'recommendation': return <Recommendation />;
    case 'access': return <AgentAccess />;
    case 'privacy': return <Privacy />;
    case 'ready': return <Ready />;
  }
}

function Title({ eyebrow, children }: { eyebrow?: string; children: ReactNode }) {
  return (
    <>
      {eyebrow && <p className="text-2xs uppercase tracking-[0.14em] text-faint mb-3">{eyebrow}</p>}
      <h1 className="text-[22px] leading-tight font-medium tracking-[-0.015em] text-ink">{children}</h1>
    </>
  );
}

function Welcome() {
  const { identity, nextStep } = useMachineStore();
  const name = identity?.displayName && identity.displayName !== 'No disponible' ? identity.displayName : null;

  return (
    <div>
      <JarvisOrb state="idle" size={44} />
      <div className="mt-7">
        <Title eyebrow="JARVIS">{name ? `Hola, ${name}.` : 'Hola.'}</Title>
        <p className="text-sm text-muted mt-3 leading-relaxed">
          Voy a preparar JARVIS para este equipo. Todo se queda aquí: no hay cuenta,
          no hay registro y no se envía nada fuera.
        </p>
        {identity && (
          <p className="text-2xs text-faint mt-4 font-mono">
            {identity.username} · {identity.computerName}
          </p>
        )}
      </div>
      <Button variant="solid" size="md" className="mt-8" onClick={nextStep}>
        Continuar <ChevronRight className="h-3.5 w-3.5" strokeWidth={2} />
      </Button>
    </div>
  );
}

type CheckState = 'pending' | 'running' | 'done' | 'missing';

function CheckRow({ label, state, detail }: { label: string; state: CheckState; detail?: string }) {
  return (
    <div className="flex items-center gap-3 h-8" data-testid={`check-${label}`}>
      <span className="w-[86px] text-xs text-muted shrink-0">{label}</span>
      {state === 'done' && <Check className="h-3.5 w-3.5 text-moss shrink-0" strokeWidth={2.4} />}
      {state === 'running' && <Loader2 className="h-3.5 w-3.5 text-signal animate-spin shrink-0" strokeWidth={2} />}
      {state === 'pending' && <CircleDashed className="h-3.5 w-3.5 text-faint shrink-0" strokeWidth={1.6} />}
      {state === 'missing' && <CircleDashed className="h-3.5 w-3.5 text-amber shrink-0" strokeWidth={1.8} />}
      <span className="text-xs text-faint truncate">{detail ?? ''}</span>
    </div>
  );
}

function SystemAnalysis() {
  const { profile, performance, phase, nextStep, analyze } = useMachineStore();
  const [settled, setSettled] = useState(false);

  useEffect(() => {
    // The analysis is genuinely quick; the short delay only avoids a flash.
    const handle = window.setTimeout(() => setSettled(true), 420);
    return () => window.clearTimeout(handle);
  }, [phase]);

  const ready = phase === 'ready' && settled;
  const state = (value: unknown): CheckState => (!ready ? 'running' : value ? 'done' : 'missing');
  const gpu = profile?.gpus[0];
  const disk = profile?.storage.find((d) => d.freeBytes !== null);

  return (
    <div>
      <Title eyebrow="Análisis">Revisando este equipo…</Title>
      <div className="mt-6 space-y-0.5">
        <CheckRow label="CPU" state={state(profile?.cpu.model ?? profile?.cpu.logicalThreads)} detail={profile?.cpu.model ?? (profile?.cpu.logicalThreads ? `${profile.cpu.logicalThreads} hilos` : 'No disponible')} />
        <CheckRow label="Memoria" state={state(profile?.memory.totalBytes)} detail={profile?.memory.totalBytes ? bytes(profile.memory.totalBytes) : 'No disponible'} />
        <CheckRow label="Gráficos" state={state(gpu?.model ?? gpu?.vendor)} detail={gpu ? `${gpu.model ?? gpu.vendor}${gpu.vramBytes ? ` · ${bytes(gpu.vramBytes)}` : ''}` : 'No detectados'} />
        <CheckRow label="Disco" state={state(disk?.freeBytes)} detail={disk?.freeBytes ? `${bytes(disk.freeBytes)} libres` : 'No disponible'} />
        <CheckRow label="Pantallas" state={state(profile?.displays.length)} detail={profile?.displays.length ? `${profile.displays.length}` : 'No disponible'} />
      </div>

      {ready && performance && (
        <p className="text-xs text-muted mt-5 leading-relaxed" data-testid="performance-wording">
          {performanceWording(performance.tier)}
        </p>
      )}
      {ready && profile && profile.unavailable.length > 0 && (
        <details className="mt-4">
          <summary className="text-2xs text-faint cursor-pointer">Detalles</summary>
          <p className="text-2xs text-faint mt-2 font-mono leading-relaxed">
            No disponible: {profile.unavailable.slice(0, 8).join(', ')}
          </p>
        </details>
      )}

      <div className="flex items-center gap-2 mt-8">
        <Button variant="solid" size="md" disabled={!ready} onClick={nextStep}>Continuar</Button>
        <Button variant="ghost" size="md" onClick={() => void analyze(true)}>Volver a analizar</Button>
      </div>
    </div>
  );
}

function LocalAICheck() {
  const { localAI, nextStep } = useMachineStore();
  const detected = localAI?.runtimes.filter((r) => r.detected) ?? [];

  return (
    <div>
      <Title eyebrow="IA local">Buscando una IA local…</Title>
      <div className="mt-6 space-y-1.5">
        {(localAI?.runtimes ?? []).map((r) => (
          <div key={r.runtimeId} className="flex items-center gap-3 h-8" data-testid={`runtime-${r.runtimeId}`}>
            <span className="w-[130px] text-xs text-ink/85 shrink-0">{r.name}</span>
            <span className={cn('text-2xs px-1.5 h-[17px] leading-[15px] rounded-xs border shrink-0',
              r.status === 'READY' ? 'border-moss/35 text-moss'
                : r.status === 'NO_MODELS' ? 'border-amber/35 text-amber'
                : 'border-hairline text-faint')}>
              {r.status === 'READY' ? 'Listo' : r.status === 'NO_MODELS' ? 'Sin modelos' : r.status === 'OFFLINE' ? 'No responde' : 'No detectado'}
            </span>
            <span className="text-2xs text-faint truncate">
              {r.models.length ? `${r.models.length} modelos` : r.error ?? ''}
            </span>
          </div>
        ))}
        {!localAI && <p className="text-xs text-faint">Comprobando…</p>}
      </div>

      <p className="text-xs text-muted mt-5 leading-relaxed">
        {detected.length
          ? 'JARVIS usará la IA local para clasificar tareas sin salir del equipo.'
          : 'No encontré ninguna IA local. JARVIS funciona igualmente: clasifica con reglas locales.'}
      </p>

      <Button variant="solid" size="md" className="mt-8" onClick={nextStep}>Continuar</Button>
    </div>
  );
}

function Recommendation() {
  const { recommendation, nextStep, setLocalAIChoice, openOfficialSource } = useMachineStore();
  const [showAlternatives, setShowAlternatives] = useState(false);
  const router = recommendation?.router ?? null;
  const installed = recommendation?.alreadyInstalled ?? false;

  const performanceWord = recommendation
    ? { EXCELLENT: 'Excelente', GOOD: 'Buena', USABLE: 'Aceptable', SLOW: 'Lenta', NOT_RECOMMENDED: 'No recomendada' }[recommendation.expectedPerformance]
    : '—';

  if (installed && router) {
    return (
      <div data-testid="recommendation-ready">
        <Title eyebrow="IA local">Listo.</Title>
        <dl className="mt-6 grid grid-cols-[110px_1fr] gap-y-2.5 text-xs">
          <dt className="text-faint">Runtime</dt><dd className="text-ink/90">{recommendation?.runtimeId ?? '—'}</dd>
          <dt className="text-faint">Router</dt><dd className="text-ink/90">{router.displayName}</dd>
          <dt className="text-faint">Aceleración</dt><dd className="text-ink/90">{(recommendation?.acceleration ?? 'cpu').toUpperCase()}</dd>
          <dt className="text-faint">Rendimiento</dt><dd className="text-ink/90">{performanceWord}</dd>
        </dl>
        <Details recommendation={recommendation} />
        <Button variant="solid" size="md" className="mt-8" onClick={() => { setLocalAIChoice('configured'); nextStep(); }}>
          Continuar
        </Button>
      </div>
    );
  }

  return (
    <div data-testid="recommendation-missing">
      <Title eyebrow="IA local">No encontré una IA local adecuada.</Title>
      {router ? (
        <>
          <p className="text-sm text-muted mt-3">Recomendado para este equipo:</p>
          <dl className="mt-5 grid grid-cols-[110px_1fr] gap-y-2.5 text-xs">
            <dt className="text-faint">Runtime</dt><dd className="text-ink/90">{recommendation?.runtimeId ?? 'Ollama'}</dd>
            <dt className="text-faint">Modelo</dt><dd className="text-ink/90">{router.displayName}</dd>
            <dt className="text-faint">Descarga</dt><dd className="text-ink/90 tnum">{bytes(router.diskBytes)}</dd>
            <dt className="text-faint">Memoria</dt><dd className="text-ink/90 tnum">{bytes(router.estimatedRamBytes)}</dd>
            <dt className="text-faint">Rendimiento</dt><dd className="text-ink/90">{performanceWord}</dd>
          </dl>
          {!recommendation?.runtimeId && (
            <p className="text-2xs text-amber mt-4 leading-relaxed">
              Primero hace falta instalar el runtime. El botón sólo abre la página oficial;
              JARVIS no descarga ni ejecuta nada por su cuenta.
            </p>
          )}
          <Details recommendation={recommendation} />
          <div className="flex flex-wrap items-center gap-2 mt-8">
            <Button variant="solid" size="md" data-testid="get-setup" onClick={() => openOfficialSource(router.downloadPage)}>
              Obtener la configuración recomendada
            </Button>
            <Button variant="quiet" size="md" onClick={() => setShowAlternatives((v) => !v)}>Ver alternativas</Button>
            <Button variant="ghost" size="md" data-testid="skip-local-ai" onClick={() => { setLocalAIChoice('skipped'); nextStep(); }}>
              Continuar sin IA local
            </Button>
          </div>
          {showAlternatives && (
            <div className="mt-5 space-y-1" data-testid="alternatives">
              {(recommendation?.alternatives ?? []).map((m) => (
                <div key={m.id} className="flex items-center gap-3 h-7 text-xs">
                  <span className="text-ink/85 flex-1 truncate">{m.displayName}</span>
                  <span className="text-2xs text-faint tnum">{bytes(m.diskBytes)}</span>
                  <span className="text-2xs text-faint">{m.tier}</span>
                </div>
              ))}
              {!recommendation?.alternatives.length && <p className="text-2xs text-faint">Sin alternativas compatibles.</p>}
            </div>
          )}
        </>
      ) : (
        <>
          <p className="text-sm text-muted mt-3 leading-relaxed">
            {recommendation?.reason ?? 'No hay ningún modelo del catálogo que encaje en este equipo dejando margen al sistema.'}
          </p>
          <Button variant="solid" size="md" className="mt-8" data-testid="skip-local-ai" onClick={() => { setLocalAIChoice('skipped'); nextStep(); }}>
            Continuar sin IA local
          </Button>
        </>
      )}
    </div>
  );
}

function Details({ recommendation }: { recommendation: ReturnType<typeof useMachineStore.getState>['recommendation'] }) {
  if (!recommendation) return null;
  const b = recommendation.budget;
  return (
    <details className="mt-5">
      <summary className="text-2xs text-faint cursor-pointer">Detalles</summary>
      <div className="mt-2.5 text-2xs text-faint space-y-1 leading-relaxed">
        <p>{recommendation.reason}</p>
        <p className="tnum">
          Memoria utilizable {(b.safeAIRamBytes / GB).toFixed(1)} GB ·
          reserva del sistema {(b.systemReserveBytes / GB).toFixed(1)} GB ·
          reserva de la app {(b.appReserveBytes / GB).toFixed(1)} GB
        </p>
        {b.notes.map((n) => <p key={n}>{n}</p>)}
      </div>
    </details>
  );
}

const ACCESS_OPTIONS: { level: PermissionLevel; icon: typeof Eye; blurb: string }[] = [
  { level: 'RESTRICTED', icon: Eye, blurb: 'Política conservadora; sin ejecución nativa general.' },
  { level: 'FULL', icon: Sparkles, blurb: 'Trabajo nativo con los permisos normales de Windows, sin micro-prompts locales.' },
];

function AgentAccess() {
  const { firstRunConfig, setPermissionPreset, nextStep } = useMachineStore();
  const selected = firstRunConfig.permissionPreset;

  return (
    <div>
      <Title eyebrow="Acceso">¿Cuánto control puede tener JARVIS?</Title>
      <div className="mt-6 space-y-1.5">
        {ACCESS_OPTIONS.map(({ level, icon: Icon, blurb }) => (
          <button
            key={level}
            data-testid={`access-${level}`}
            onClick={() => setPermissionPreset(level)}
            className={cn(
              'w-full text-left rounded-lg border p-3.5 transition-colors flex gap-3',
              selected === level ? 'border-signal/50 bg-signal/[0.06]' : 'border-hairline hover:bg-white/[0.03]',
            )}
          >
            <Icon className={cn('h-4 w-4 mt-0.5 shrink-0', selected === level ? 'text-signal' : 'text-faint')} strokeWidth={1.7} />
            <span className="min-w-0">
              <span className="block text-sm text-ink">{permissionLabel(level)}</span>
              <span className="block text-xs text-muted mt-1 leading-relaxed">{blurb}</span>
            </span>
          </button>
        ))}
      </div>
      <p className="text-2xs text-faint mt-4 leading-relaxed">
        El botón abre el selector nativo: solo ese menú cambia la autoridad efectiva.
        FULL no evita UAC, ACL ni Secure Desktop. Los destinos externos no autorizados requieren confirmación.
      </p>
      <Button variant="solid" size="md" className="mt-7" onClick={nextStep}>Continuar</Button>
    </div>
  );
}

const SESSION_OPTIONS: { id: SessionPolicy; label: string; blurb: string; recommended?: boolean }[] = [
  { id: 'keep', label: 'Mantener la sesión iniciada', blurb: 'Las cookies de los sitios se conservan entre arranques.', recommended: true },
  { id: 'clear_on_exit', label: 'Borrar las sesiones al cerrar JARVIS', blurb: 'Cada arranque empieza sin sesiones iniciadas.' },
];

function Privacy() {
  const { firstRunConfig, setSessionPolicy, nextStep } = useMachineStore();

  return (
    <div>
      <Title eyebrow="Privacidad">Sesiones de los sitios web</Title>
      <div className="mt-6 space-y-1.5">
        {SESSION_OPTIONS.map((o) => (
          <button
            key={o.id}
            data-testid={`session-${o.id}`}
            onClick={() => setSessionPolicy(o.id)}
            className={cn(
              'w-full text-left rounded-lg border p-3.5 transition-colors',
              firstRunConfig.sessionPolicy === o.id ? 'border-signal/50 bg-signal/[0.06]' : 'border-hairline hover:bg-white/[0.03]',
            )}
          >
            <span className="flex items-center gap-2">
              <span className="text-sm text-ink">{o.label}</span>
              {o.recommended && <span className="text-2xs text-faint border border-hairline rounded-xs px-1.5">Recomendado</span>}
            </span>
            <span className="block text-xs text-muted mt-1">{o.blurb}</span>
          </button>
        ))}
      </div>
      <div className="mt-5 flex items-start gap-2.5 rounded-lg border border-hairline p-3.5">
        <Lock className="h-3.5 w-3.5 text-faint mt-0.5 shrink-0" strokeWidth={1.7} />
        <p className="text-xs text-muted leading-relaxed">
          JARVIS nunca guarda contraseñas. Inicias sesión dentro del navegador, como siempre.
          Una sesión no es una contraseña, y las contraseñas jamás salen de la página.
        </p>
      </div>
      <Button variant="solid" size="md" className="mt-7" onClick={nextStep}>Continuar</Button>
    </div>
  );
}

function Ready() {
  const { capabilities, finishFirstRun, firstRunConfig } = useMachineStore();
  const summary = summarizeCapabilities(capabilities as Capability[]);

  return (
    <div data-testid="first-run-ready">
      <JarvisOrb state="idle" size={38} />
      <div className="mt-6">
        <Title eyebrow="Listo">JARVIS está preparado.</Title>
      </div>
      <dl className="mt-6 grid grid-cols-[130px_1fr] gap-y-2.5 text-xs">
        <dt className="text-faint">Identidad</dt><dd className="text-ink/90">Perfil del sistema</dd>
        <dt className="text-faint">Cuenta JARVIS</dt><dd className="text-ink/90">Ninguna</dd>
        <dt className="text-faint">Acceso</dt><dd className="text-ink/90">{permissionLabel(firstRunConfig.permissionPreset)}</dd>
        <dt className="text-faint">Capacidades</dt>
        <dd className="text-ink/90">{summary.AVAILABLE} disponibles · {summary.RESTRICTED} restringidas</dd>
      </dl>
      <Button variant="solid" size="md" className="mt-8" data-testid="finish-first-run" onClick={finishFirstRun}>
        <ShieldCheck className="h-3.5 w-3.5" strokeWidth={1.8} /> Empezar
      </Button>
    </div>
  );
}

export function HardwareChangeBanner() {
  const { hardwareChange, dismissHardwareChange } = useMachineStore();
  if (!hardwareChange) return null;

  return (
    <div data-testid="hardware-change" className="shrink-0 hairline-b bg-amber/[0.06] px-4 py-2.5 flex items-center gap-3">
      <Cpu className="h-3.5 w-3.5 text-amber shrink-0" strokeWidth={1.7} />
      <span className="text-xs text-ink/90 flex-1 min-w-0">
        Detecté un cambio de hardware ({hardwareChange.fields.join(', ')}).
        JARVIS puede volver a ajustar su configuración de IA local.
      </span>
      <Button variant="quiet" size="xs" onClick={() => dismissHardwareChange(true)}>Optimizar</Button>
      <Button variant="ghost" size="xs" onClick={() => dismissHardwareChange(false)}>Mantener</Button>
    </div>
  );
}
