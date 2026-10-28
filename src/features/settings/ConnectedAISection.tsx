import { useEffect, useState } from 'react';
import type { ConnectedAIService } from '../../../electron/connected/ConnectedAIService';
import {IntelligenceConnections} from './IntelligenceConnections';
type Snapshot = ReturnType<ConnectedAIService['snapshot']>;
export function ConnectedAISection() {
  const [state, setState] = useState<Snapshot | null>(null), [prompt, setPrompt] = useState(''), [model, setModel] = useState(''), [provider, setProvider] = useState('ollama-local');
  const [output, setOutput] = useState(''), [run, setRun] = useState(''), [busy, setBusy] = useState(false);
  const [starting, setStarting] = useState(false);
  const [taskId, setTaskId] = useState('');
  const [organizationKind,setOrganizationKind]=useState<'summary'|'tasks'|'followup'>('followup'),[organizationText,setOrganizationText]=useState(''),[organizationReview,setOrganizationReview]=useState(false);
  const [brief,setBrief]=useState<{summary:string;tasks:string[];unknowns:string[]}|null>(null);
  const [contractText, setContractText] = useState('{"kind":"JSON_SHAPE","fields":{"items":"array"}}'), [memoryQuery, setMemoryQuery] = useState('items'), [evidence, setEvidence] = useState('');
  const [planText, setPlanText] = useState('{"version":1,"dataClass":"LOCAL_ONLY","nodes":[{"id":"produce","role":"producer","dependsOn":[],"providerId":"ollama-local","model":"smollm2:1.7b-instruct-q4_K_M","prompt":"Return JSON only: {\\"items\\":[]}","verification":{"kind":"JSON_SHAPE","fields":{"items":"array"}}}]}'), [graphId, setGraphId] = useState('');
  const [checkpoint, setCheckpoint] = useState<Awaited<ReturnType<NonNullable<typeof window.jarvis>['connected']['checkpoint']>>>(null);
  const bridge = window.jarvis;
  const refresh = async () => { try { if (bridge?.connected) setState(await bridge.connected.refresh()); else setOutput('Connected AI no disponible: no hay proceso principal conectado. Los estados son UNKNOWN, no Offline ni conexiones simuladas.'); } catch { setOutput('Connected AI no disponible en este entorno.'); } };
  useEffect(() => { void refresh(); }, []);
  async function execute() {
    const id = 'connected-' + crypto.randomUUID(); setRun(id); setBusy(true); setOutput('');
    try {
      if (!bridge) throw Error('NO_BRIDGE');
      await bridge.authority.begin(id, prompt);
      if (!taskId) await bridge.fabric.saveTask({ taskId: id, conversationId: id, goal: prompt, currentTask: 'Connected AI', instructions: [], findings: [], decisions: [], artifacts: [], openQuestions: [], pendingSteps: [], updatedAt: Date.now() });
      const continuation = taskId && checkpoint?.state.taskId === taskId ? { taskId, revision: checkpoint.revision } : undefined;
      const result = await bridge.connected.execute(id, prompt, { providerId: provider, model, ...(continuation ? { continuation } : {}) }); setOutput(JSON.stringify(result, null, 2));
      setCheckpoint(await bridge.connected.checkpoint(result.taskId ?? taskId ?? id));
    } catch { setOutput('Solicitud no admitida o superficie no disponible.'); }
    finally { setBusy(false); await refresh(); }
  }
  const candidates = checkpoint?.operations.filter(o => o.kind === 'INFERENCE' && o.status === 'SUCCESS');
  const source = candidates?.filter(o => o.resultVerification?.state === 'VERIFIED').at(-1) ?? candidates?.at(-1);
  async function artifact() {
    if (!bridge || !checkpoint || !source) return;
    setBusy(true); setOutput(''); const id = 'artifact-' + crypto.randomUUID(); setRun(id);
    const choice = { taskId: checkpoint.state.taskId, revision: checkpoint.revision };
    try {
      await bridge.authority.begin(id, JSON.stringify({ ...choice, sourceOperationId: source.operationId }));
      setOutput(JSON.stringify(await bridge.connected.artifact(id, choice, source.operationId), null, 2));
    } catch { setOutput('Artefacto no admitido o requiere revisión. No se reintentó el efecto automáticamente.'); }
    finally { setCheckpoint(await bridge.connected.checkpoint(choice.taskId)); setBusy(false); }
  }
  async function verify() {
    if (!bridge || !checkpoint || !source) return;
    const choice = { taskId: checkpoint.state.taskId, revision: checkpoint.revision }, contract = JSON.parse(contractText), id = 'verify-' + crypto.randomUUID();
    setBusy(true); setEvidence('');
    try {
      await bridge.authority.begin(id, JSON.stringify({ ...choice, sourceOperationId: source.operationId, contract }));
      setEvidence(JSON.stringify(await bridge.connected.verify(id, choice, source.operationId, contract), null, 2));
      setCheckpoint(await bridge.connected.checkpoint(choice.taskId));
    } catch { setEvidence('Criterios inválidos, verificación revocada o sujeto no producido. No se otorgó una garantía.'); }
    finally { setBusy(false); }
  }
  async function organize() {
    if(!bridge)return;
    const request={kind:organizationKind,text:organizationText,review:organizationReview},id='organization-'+crypto.randomUUID();
    setBusy(true);setRun(id);setGraphId(id);setEvidence('');setBrief(null);
    try {
      await bridge.authority.begin(id,JSON.stringify(request));
      const result=await bridge.connected.organize(id,request);
      setEvidence(JSON.stringify(result,null,2));setTaskId(id);const cp=await bridge.connected.checkpoint(id);setCheckpoint(cp);
      if(organizationKind==='followup'&&result.state==='VERIFIED'){try{const text=cp?.operations.find(o=>o.operationId===result.resultOperationId)?.text??'';setBrief(JSON.parse(text.trim().replace(/^```json\s*\n([\s\S]*?)\n```$/,'$1')));}catch{}}
    } catch {setEvidence('No se pudo completar la tarea. Consulta los modelos locales disponibles y el estado del plan.');}
    finally {setBusy(false);await refresh();}
  }
  async function graph() {
    if (!bridge) return;
    setBusy(true); setEvidence('');
    try {
      const plan = JSON.parse(planText), id = 'graph-' + crypto.randomUUID(); setGraphId(id); setRun(id);
      await bridge.authority.begin(id, JSON.stringify(plan));
      const result = await bridge.connected.graph(id, plan); setEvidence(JSON.stringify(result, null, 2));
      setTaskId(id); setCheckpoint(await bridge.connected.checkpoint(id));
    } catch { setEvidence('Grafo inválido, proveedor no autorizado o raíz revocada. No se inició una alternativa silenciosa.'); }
    finally { setBusy(false); await refresh(); }
  }
  return <section data-testid="connected-ai" className="space-y-3 text-sm [&_textarea]:bg-raised [&_textarea]:text-ink [&_textarea]:border [&_textarea]:border-hairline [&_textarea]:rounded-md [&_textarea]:p-3 [&_textarea]:min-h-24 [&_button]:rounded-md [&_button]:border [&_button]:border-hairline [&_button]:bg-raised [&_button]:px-3 [&_button]:py-2 [&_button]:mr-2 [&_button]:mb-2 [&_input]:bg-raised [&_input]:text-ink [&_input]:border [&_input]:border-hairline [&_input]:rounded-md [&_input]:px-2 [&_input]:py-1 [&_select]:bg-raised [&_select]:text-ink [&_select]:border [&_select]:border-hairline [&_select]:rounded-md [&_select]:px-2 [&_select]:py-1">
    <IntelligenceConnections />
    <div className="space-y-2">
      <h3>Concilius · coordinación acotada</h3>
      <p>Organización económica: clasificación sin modelo, un trabajador local y revisión adicional sólo si la eliges.</p>
      <label>Tarea <select aria-label="Tipo de tarea organizada" data-org-kind value={organizationKind} onChange={e=>setOrganizationKind(e.target.value as typeof organizationKind)}><option value="followup">Seguimiento breve</option><option value="tasks">Extraer tareas</option><option value="summary">Resumir material</option></select></label>
      <textarea aria-label="Material para Concilius" data-org-input maxLength={2000} value={organizationText} onChange={e=>setOrganizationText(e.target.value)} placeholder="Pega el material; JARVIS organiza el trabajo" className="w-full" />
      <label><input type="checkbox" data-org-review checked={organizationReview} onChange={e=>setOrganizationReview(e.target.checked)} /> Añadir revisión de especialista</label>
      <button data-connected-organize disabled={busy||!organizationText.trim()} onClick={()=>void organize()}>Organizar y ejecutar</button>
      {brief&&<article data-testid="followup-brief" className="surface p-3"><h4>Estado</h4><p>{brief.summary}</p><h4>Próximos pasos</h4><ul>{brief.tasks.map((t,i)=><li key={i}>{t}</li>)}</ul><h4>Por confirmar</h4><ul>{brief.unknowns.map((t,i)=><li key={i}>{t}</li>)}</ul></article>}
      <p>La comprobación automática de estas tareas valida la forma JSON; la calidad del contenido requiere revisión.</p>
      <p>Plan explícito LOCAL_ONLY. Máximo 4 nodos, una reparación y 15 minutos. Crítico = consejo, no garantía. Sin herramientas OS, pagos, broadcast ni reejecución tras reinicio.</p>
      <textarea aria-label="Plan Concilius" data-concilius-plan value={planText} onChange={e => setPlanText(e.target.value)} className="w-full" />
      <button data-connected-graph disabled={busy} onClick={() => void graph()}>Ejecutar plan Concilius</button>
      <button disabled={!graphId} onClick={async () => { if (bridge) setEvidence(JSON.stringify(await bridge.connected.graphRead(graphId), null, 2)); }}>Leer estado Concilius</button>
      <p data-testid="concilius-graph-id">{graphId}</p>
    </div>

    <h2>Inteligencias conectadas · resultados y continuidad</h2>
    <p className="text-muted">Sin herramientas de sistema operativo en esta superficie. Catálogo ≠ inferencia. Cuota y costo no medidos: UNKNOWN.</p>
    <div className="flex gap-3">
      <button onClick={() => void refresh()}>Actualizar estados</button>
      <button onClick={async () => { await bridge?.connected.choose(); }}>Política de datos y costo</button>
      <button onClick={async () => { try { await bridge?.connected.credential(['openai-api', 'claude-api', 'gemini-api', 'grok-api', 'groq-api', 'openrouter-api'].includes(provider) ? provider : 'openai-api'); } catch { setOutput('Cifrado de credenciales no disponible.'); } }}>Guardar credencial privada</button>
      <button disabled={starting} onClick={async () => { setStarting(true); try { await bridge?.connected.startLocal(); await refresh(); } catch { setOutput('No fue posible iniciar Ollama. No se descargó ni instaló nada.'); } finally { setStarting(false); } }}>Iniciar Ollama instalado</button>
    </div>
    {starting && <p role="status">Iniciando servicio local. La detección GPU instalada puede tardar hasta 4 minutos. No se modifican drivers ni se descargan modelos.</p>}
    <button onClick={async () => { if (bridge) setState(await bridge.connected.snapshot()); }}>Leer política aplicada</button>
    <pre data-testid="connected-policy">{state ? JSON.stringify(state.policy, null, 2) : 'UNKNOWN'}</pre>
    {state?.providers.map(p => <div className="surface rounded-lg p-3" key={p.id} data-testid={'connected-provider-' + p.id}>
      <div>{p.label} · {p.state} · {p.surface?.verification}</div>
      <div>Auth: {p.surface?.auth} · destino: {p.surface?.destination ?? 'UNKNOWN'} · latencia: {p.surface?.latencyMs ?? 'UNKNOWN'} · cuota: {p.quota} · contexto: {p.contextLimit ?? 'UNKNOWN'}</div>
      <div>Costo: {p.costClass} (importe UNKNOWN) · rate limits: UNKNOWN · respuestas observadas en sesión: {p.surface?.successfulRequests ?? 0}. Historial persistido en History.</div>
      <div>Modelos descubiertos: {p.surface?.models.join(', ') || 'UNKNOWN'}</div>
      {p.surface?.lastFailure && <p>{p.surface.lastFailure}</p>}
    </div>)}
    <label>Superficie <select aria-label="Superficie conectada" value={provider} onChange={e => { setProvider(e.target.value); setModel(''); }}><option value="ollama-local">Ollama local</option><option value="bootstrap-local">IA local instalada por JARVIS</option><option value="codex-app-server">Codex (login oficial)</option><option value="llama-cpp-local">llama.cpp independiente (provisionado)</option><option value="openai-api">OpenAI API (requiere opt-in)</option><option value="claude-api">Claude API (requiere opt-in)</option><option value="gemini-api">Gemini API (requiere opt-in)</option><option value="grok-api">Grok API (requiere opt-in)</option><option value="groq-api">Groq API (requiere credencial y opt-in)</option><option value="openrouter-api">OpenRouter (solo GENERIC, requiere opt-in)</option></select></label>
    <label>Modelo <input aria-label="Modelo conectado" value={model} onChange={e => setModel(e.target.value)} placeholder={provider === 'ollama-local' ? 'Primer modelo descubierto' : 'Identificador habilitado por tu cuenta'} /></label>
    <div className="space-y-2">
      <label>Continuar tarea <input aria-label="Continuar tarea" data-connected-task value={taskId} onChange={e => setTaskId(e.target.value)} placeholder="Vacío = tarea nueva; ID = relevo explícito" /></label>
      <button disabled={busy || !taskId} onClick={async () => { try { setCheckpoint(await bridge?.connected.checkpoint(taskId) ?? null); } catch { setOutput('Checkpoint no disponible.'); } }}>Cargar checkpoint</button>
      <button disabled={busy} onClick={() => { setTaskId(''); setCheckpoint(null); }}>Nueva tarea</button>
      {checkpoint && <div data-connected-checkpoint-revision={checkpoint.revision} data-testid="connected-checkpoint">
        <p>Tarea: {checkpoint.state.taskId} · checkpoint {checkpoint.revision} · datos {checkpoint.dataClass}</p>
        <p>Objetivo: {checkpoint.state.goal}</p>
        <p>Pendiente: {checkpoint.state.pendingSteps.join('; ') || 'Ninguna operación pendiente'}</p>
        <p>Operaciones: {checkpoint.operations.map(o => `${o.kind}: ${o.status} (${o.model ?? 'sin modelo'})`).join(' → ')}</p>
        <p>Efectos: {checkpoint.effects.map(e => `${e.status}; escrituras: ${e.writes}`).join('; ') || 'Ninguno'}</p>
        <p data-testid="result-verifications">Resultados: {checkpoint.operations.filter(o => o.kind === 'INFERENCE').map(o => `${o.model}: ${o.resultVerification?.state ?? 'PRODUCED'} — ${o.resultVerification?.scope ?? 'No comprobado'}`).join('; ')}</p>
      </div>}
      <button data-connected-artifact data-task-id={checkpoint?.state.taskId ?? ''} data-revision={checkpoint?.revision ?? -1} data-source-operation={source?.operationId ?? ''} disabled={busy || !source} onClick={() => void artifact()}>Guardar resultado como artefacto</button>
      <p className="text-muted">El artefacto se guarda dentro de JARVIS. Repetir la solicitud verifica el existente, no vuelve a escribirlo. El relevo no ejecuta herramientas OS del modelo.</p>
    </div>
    <div className="space-y-2">
      <p>Inferencia exitosa ≠ resultado verificado. Los criterios comprueban únicamente su alcance; revisión de otro modelo es consejo.</p>
      <label>Criterios de verificación <textarea aria-label="Criterios de verificación" data-verification-contract value={contractText} onChange={e => setContractText(e.target.value)} className="w-full" /></label>
      <button data-connected-verify data-task-id={checkpoint?.state.taskId ?? ''} data-revision={checkpoint?.revision ?? -1} data-source-operation={source?.operationId ?? ''} disabled={busy || !source} onClick={() => void verify()}>Verificar resultado</button>
      <label>Buscar memoria comprobada <input aria-label="Buscar memoria comprobada" value={memoryQuery} onChange={e => setMemoryQuery(e.target.value)} /></label>
      <button disabled={!checkpoint} onClick={async () => { if (bridge && checkpoint) setEvidence(JSON.stringify(await bridge.connected.memory(checkpoint.state.taskId, memoryQuery), null, 2)); }}>Recuperar referencias</button>
      <button disabled={!checkpoint} onClick={async () => { try { if (bridge && checkpoint) { const refs = await bridge.connected.memory(checkpoint.state.taskId, memoryQuery); const ref = refs.references[0]; setEvidence(ref ? JSON.stringify(await bridge.connected.expandMemory(checkpoint.state.taskId, ref), null, 2) : 'No hay referencia comprobada vigente.'); } } catch { setEvidence('Referencia modificada, caducada o no autorizada; no se recuperó contenido.'); } }}>Recuperar resultado original</button>
      <button onClick={async () => { try { if (bridge) { const r = await bridge.connected.recommend(checkpoint?.state.taskId ?? 'new', JSON.parse(contractText)); setEvidence(JSON.stringify(r, null, 2)); if (r.audit.selectedProviderId) { setProvider(r.audit.selectedProviderId); if (r.model) setModel(r.model); } } } catch { setEvidence('Criterios no disponibles para selección comparable.'); } }}>Sugerir inteligencia con evidencia</button>
      <pre className="whitespace-pre-wrap" data-testid="connected-evidence">{evidence}</pre>
    </div>
    <textarea aria-label="Petición conectada" data-connected-prompt value={prompt} onChange={e => setPrompt(e.target.value)} className="w-full bg-raised p-3" />
    <button data-connected-execute disabled={busy || !prompt.trim() || (!!taskId && checkpoint?.state.taskId !== taskId)} onClick={() => void execute()}>Ejecutar inteligencia</button>
    <button onClick={() => void bridge?.authority.stop()}>STOP inteligencias</button>
    <p data-testid="connected-run-id">{run}</p><pre className="whitespace-pre-wrap" data-testid="connected-output">{output}</pre>
  </section>;
}
