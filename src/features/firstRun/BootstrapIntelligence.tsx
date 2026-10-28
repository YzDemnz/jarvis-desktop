import { useEffect, useState } from 'react';
import type { BootstrapSnapshot, LocalCandidate } from '../../../electron/bootstrap/contracts';
import { Button } from '@/components/ui/Button';
import { bytes } from '@/lib/format';
const ACTIVE = ['PLANNING', 'DOWNLOADING_RUNTIME', 'DOWNLOADING_MODEL', 'VERIFYING', 'STARTING', 'BENCHMARKING'];
const PHASE: Record<string, string> = { DETECTING: 'Comprobando inteligencia', CONNECT_INTELLIGENCE: 'Conecta inteligencia para comenzar', OFFER_LOCAL: '¿Quieres instalar IA local?', EXTERNAL_ONLY: 'Inteligencia externa / herramientas disponibles', PLANNING: 'Comprobando equipo y espacio libre', DOWNLOADING_RUNTIME: 'Descargando runtime', DOWNLOADING_MODEL: 'Descargando modelo', VERIFYING: 'Verificando integridad', STARTING: 'Cargando modelo', BENCHMARKING: 'Comprobando respuestas y velocidad', OPERATIVE: 'IA local operativa', DEGRADED: 'IA local responde, con rendimiento lento', INTERRUPTED: 'Instalación interrumpida: puedes retomarla', CANCELLED: 'Instalación cancelada', FAILED: 'La instalación requiere atención' };
export function BootstrapIntelligence({ onContinue }: {
    onContinue?: () => void;
}) {
    const [state, setState] = useState<BootstrapSnapshot | null>(null), [candidates, setCandidates] = useState<LocalCandidate[]>([]), [external, setExternal] = useState('UNKNOWN');
    const [selected, setSelected] = useState(''), [model, setModel] = useState(''), [provider, setProvider] = useState('codex-app-server'), [error, setError] = useState<string | null>(null), [busy, setBusy] = useState(false);
    const api = window.jarvis?.bootstrap;
    const refresh = async () => { if (!api)
        return; const x = await api.snapshot(); setState(x.state); setCandidates(x.candidates); setExternal(x.external); setSelected(old => old || x.state.candidateId || x.state.plan?.candidateId || ''); };
    useEffect(() => { let disposed = false; if (api)
        void api.inspect().then(x => { if (!disposed) {
            setState(x.state);
            setCandidates(x.candidates);
            setExternal(x.external);
            setSelected(x.state.candidateId || x.state.plan?.candidateId || '');
        } }).catch(() => setError('No pude comprobar el estado. Reintenta desde Ajustes.')); const timer = setInterval(() => { if (!disposed)
        void refresh().catch(() => { }); }, 1000); return () => { disposed = true; clearInterval(timer); }; }, []);
    if (!api)
        return null;
    const act = async (action: string) => { setError(null); setBusy(true); try {
        await api.action(action);
        await refresh();
    }
    catch (e) {
        const message = String(e);
        setError(message.includes('GESTURE') ? 'La acción necesita un clic del propietario.' : message.includes('RESTRICTED') ? 'Selecciona FULL en el menú nativo de autoridad para instalar.' : message.includes('EXTERNAL') ? 'La inferencia externa no está verificada. Revisa inicio de sesión, proveedor habilitado, modelo y permiso de API de pago.' : message.includes('EXISTING') ? 'El modelo existente no superó la prueba real. Puedes instalar una alternativa.' : 'No se completó la acción. Revisa la conexión y el estado; puedes reintentar.');
    }
    finally {
        setBusy(false);
    } };
    const actionButton = (label: string, action: string) => <Button key={action} disabled={busy} variant="quiet" data-bootstrap-action={action} onClick={() => void act(action)}>{label}</Button>;
    const active = !!state && ACTIVE.includes(state.phase), local = state && ['OPERATIVE', 'DEGRADED'].includes(state.localHealth), candidate = candidates.find(c => c.id === selected);
    return <section data-testid="bootstrap-intelligence" className="space-y-4 rounded-lg border border-hairline p-4">
    <h2 className="text-lg text-ink">{state ? PHASE[state.phase] : 'Comprobando inteligencia'}</h2>
    <p className="text-sm text-muted">IA local: {state?.localHealth ?? 'UNKNOWN'} · Codex: {external}</p>
    {<>
      <div className="flex flex-wrap gap-2">
        {actionButton('Conectar Codex', 'codex-login')}
        {(['claude-api', 'gemini-api', 'grok-api'] as const).map((id, i) => <Button key={id} variant="quiet" onClick={() => { setProvider(id); void window.jarvis?.connected.credential(id); }}>{['Claude', 'Gemini', 'Grok'][i]} · API</Button>)}
        {actionButton('Comprobar inicio de sesión', 'codex-status')}
      </div>
      <p className="text-xs text-muted">Codex usa su inicio de sesión oficial. Claude, Gemini y Grok requieren acceso por API separado de sus apps y suscripciones.</p>
      <details><summary className="text-xs cursor-pointer">Verificar inteligencia externa</summary><div className="space-y-2 mt-2">
        <select aria-label="Inteligencia de bootstrap" value={provider} onChange={e => setProvider(e.target.value)} className="bg-panel border border-hairline rounded p-2">{['codex-app-server', 'openai-api', 'claude-api', 'gemini-api', 'grok-api'].map(x => <option key={x}>{x}</option>)}</select>
        <input aria-label="Modelo de bootstrap" value={model} onChange={e => setModel(e.target.value)} placeholder="Modelo oficial de tu cuenta" className="bg-panel border border-hairline rounded p-2 w-full"/>
        <Button variant="quiet" onClick={() => void window.jarvis?.connected.choose()}>Habilitar proveedor / permiso de API</Button>
        {actionButton('Probar respuesta real', `probe:${provider}|${model || 'default'}`)}
        <p className="text-xs text-faint">El login no demuestra inferencia. Las API permanecen bloqueadas hasta autorizar su gasto en el menú nativo. No se usa fallback de pago automáticamente.</p>
      </div></details>
      {!local && actionButton('Comprobar un modelo Ollama existente', 'verify-existing')}
    </>}
    {!active && <>
      <p className="text-sm text-muted">{local ? 'Puedes conservar este modelo o probar una alternativa. La inteligencia externa permanece disponible como especialista.' : '¿Quieres instalar IA local? La instalación la controla JARVIS y puede continuar sin conexión a un modelo externo.'}</p>
      {state?.plan && <p className="text-xs text-muted">{state.plan.reason}</p>}
      <div className="flex flex-wrap gap-2">
        {selected && actionButton(local ? 'Instalar / verificar alternativa' : 'Instalar recomendada', `install:${selected}`)}
        {actionButton('Ahora no', 'decline')}
      </div>
      <details><summary className="text-xs cursor-pointer">Ver opciones</summary><div className="space-y-2 mt-2">
        <select aria-label="Modelo local de bootstrap" value={selected} onChange={e => setSelected(e.target.value)} className="bg-panel border border-hairline rounded p-2 w-full">{candidates.map(c => <option key={c.id} value={c.id}>{c.label} · {bytes(c.artifact.size)}</option>)}</select>
        <select aria-label="Runtime local de bootstrap" className="bg-panel border border-hairline rounded p-2 w-full" defaultValue="llama-cpp-b6500-cpu-x64"><option value="llama-cpp-b6500-cpu-x64">llama.cpp b6500 · CPU x64 verificado</option></select>
        <p className="text-xs text-faint">SHA-256 fijado. Contexto inicial: 2048 tokens. CPU; aceleración GPU UNKNOWN. Ubicación: {state?.plan?.location ?? 'No disponible'}.</p>
        {actionButton('Cambiar ubicación dentro de CODEX', 'choose-location')}
        {candidate && <p className="text-xs text-faint">Descarga {bytes(candidate.artifact.size)} · RAM estimada {bytes(candidate.ramBytes)} · {candidate.license}. {candidate.limitations.join(' ')}</p>}
      </div></details>
    </>}
    {active && <div className="space-y-2"><p className="text-xs text-muted">{state?.progress ? `${state.progress.artifact}: ${bytes(state.progress.received)} / ${bytes(state.progress.total)}` : 'Comprobación en curso; STOP está disponible.'}</p>{actionButton('STOP / cancelar', 'cancel')}</div>}
    {state?.benchmark && <p className="text-xs text-muted">Prueba: {state.benchmark.correct && state.benchmark.stable ? 'respuestas verificadas' : 'fallida'} · Primer token {state.benchmark.firstTokenMs === null ? 'UNKNOWN' : `${state.benchmark.firstTokenMs} ms`} · tokens/s {state.benchmark.tokensPerSecond === null ? 'UNKNOWN' : state.benchmark.tokensPerSecond.toFixed(1)} · RAM/VRAM del runtime: UNKNOWN.</p>}
    {state?.phase === 'DEGRADED' && <p className="text-xs text-muted">El resultado fue correcto, pero lento. En Ver opciones puedes elegir un modelo menor y repetir la comprobación.</p>}
    {(error || state?.failure) && <p role="status" className="text-sm text-clay">{error ?? state?.failure}</p>}
    {onContinue && <Button variant="solid" disabled={active} onClick={onContinue}>{local || state?.externalProviderId ? 'Continuar' : 'Continuar con herramientas locales'}</Button>}
  </section>;
}
