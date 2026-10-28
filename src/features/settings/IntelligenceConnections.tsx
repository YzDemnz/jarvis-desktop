import {useEffect,useState} from 'react';
type State=Awaited<ReturnType<NonNullable<typeof window.jarvis>['intelligence']['snapshot']>>;
export function IntelligenceConnections(){
  const api=window.jarvis,[state,setState]=useState<State|null>(null),[busy,setBusy]=useState(false),[notice,setNotice]=useState(''),[prompt,setPrompt]=useState('');
  const refresh=async()=>{if(api?.intelligence)setState(await api.intelligence.snapshot());};
  useEffect(()=>{void refresh().catch(()=>{});const timer=setInterval(()=>void refresh().catch(()=>{}),2000);return()=>clearInterval(timer);},[]);
  async function action(value:string){if(!api)return;setBusy(true);setNotice('');try{await api.intelligence.action(value);await refresh();}catch(error){setNotice(String(error));}finally{setBusy(false);}}
  async function codex(value:string){if(!api)return;setBusy(true);try{await api.bootstrap.action(value);await refresh();}catch{setNotice('Codex no pudo completar la conexión. Consulta su estado y usa el inicio de sesión oficial.');}finally{setBusy(false);}}
  async function queue(){if(!api)return;setBusy(true);try{const id='mcp-'+crypto.randomUUID(),text=prompt.trim();await api.authority.begin(id,text);await api.intelligence.queue(id,text);setPrompt('');await refresh();}catch(error){setNotice(String(error));}finally{setBusy(false);}}
  return <div data-testid="intelligence-connections" className="surface rounded-lg p-4 space-y-4">
    <h2 className="text-lg">Tu equipo de inteligencias</h2>
    <p>Trabajo diario local, especialistas reemplazables y tareas compartidas con otras aplicaciones.</p>
    <p data-testid="daily-model">IA diaria: {state?.economyModel??'Selección local anterior'}. El chat de Home y Concilius utilizan esta preferencia.</p>
    <p data-testid="mcp-model">Especialista MCP: {state?.mcpModel??'IA diaria'}. Puedes usar modelos distintos para cada función.</p>
    <p data-testid="document-model">Lectura y redacción: {state?.documentModel??'IA diaria'}. Selección independiente para documentos.</p>
    <div className="grid gap-3 xl:grid-cols-2">{state?.models.slice().sort((a,b)=>Number(b.model===state.economyModel)-Number(a.model===state.economyModel)).map(m=><div key={m.id} className="rounded-lg border border-hairline p-3" data-testid={'model-'+m.id}>
      <h3>{m.label}</h3><p>{m.model} · {(m.bytes/1e9).toFixed(1)} GB</p><p>{m.role}</p>
      <p>{m.receipt?.state??'NOT_INSTALLED'}{m.receipt?.state==='DOWNLOADING'?` · ${Math.round(m.receipt.received/m.bytes*100)}% del bloque principal`:''}</p>
      {m.receipt?.state==='PROBING'&&<p role="status">{m.receipt.phase==='INTEGRITY'?'Comprobando archivos del externo':'Cargando modelo y probando inferencia'}. Puede tardar hasta cuatro minutos; puedes cancelar.</p>}
      <p className="text-muted">{m.receipt?.probe?`Prueba básica: ${m.receipt.probe.observed===25?'correcta':'fallida'} · ${Math.round(m.receipt.probe.elapsedMs/1000)} s. Calidad según tarea.`:''}</p>
      <button disabled={busy} data-intelligence-action={'install:'+m.id} onClick={()=>void action('install:'+m.id)}>Instalar en externo</button>
      <button disabled={busy||!m.receipt||m.receipt.state==='DOWNLOADING'} data-intelligence-action={'probe:'+m.id} onClick={()=>void action('probe:'+m.id)}>Probar modelo</button>
      <button disabled={busy||m.receipt?.state!=='VERIFIED'} data-intelligence-action={'daily:'+m.id} onClick={()=>void action('daily:'+m.id)}>Usar a diario</button>
      <button disabled={busy||m.receipt?.state!=='VERIFIED'} data-intelligence-action={'mcp:'+m.id} onClick={()=>void action('mcp:'+m.id)}>Usar para MCP</button>
      <button disabled={busy||m.receipt?.state!=='VERIFIED'} data-intelligence-action={'documents:'+m.id} onClick={()=>void action('documents:'+m.id)}>Usar para documentos</button>
      {m.receipt?.error&&<p role="status">{m.receipt.error}</p>}
    </div>)}</div>
    <button data-intelligence-action="cancel" onClick={()=>void action('cancel')}>Cancelar descarga o prueba</button>
    <div><h3>Codex · conexión oficial</h3><p data-testid="codex-bridge-state">{state?.codex.status??'UNKNOWN'} · protocolo {state?.codex.protocolVerified?'TESTED':'UNKNOWN'}</p>
      <button disabled={busy} data-bootstrap-action="codex-status" onClick={()=>void codex('codex-status')}>Comprobar Codex</button>
      <button disabled={busy} data-bootstrap-action="codex-login" onClick={()=>void codex('codex-login')}>Conectar cuenta Codex</button>
      <p>App Server conserva el acceso oficial de tu cuenta. Modelos anunciados: {state?.codex.models.join(', ')||'UNKNOWN'}; el catálogo no confirma acceso ni inferencia.</p>
    </div>
    <div><h3>Claude y otras apps · puente MCP</h3><p data-testid="mcp-bridge-state">{state?.bridge?.state??'UNKNOWN'} · hosts observados: {state?.bridge?.peers.map(p=>p.name).join(', ')||'ninguno'}</p>
      <button disabled={busy} data-intelligence-action="prepare-mcp" onClick={()=>void action('prepare-mcp')}>Preparar conexión MCP</button>
      <button onClick={async()=>{try{if(api){await navigator.clipboard.writeText(JSON.stringify(await api.intelligence.config(),null,2));setNotice('Configuración copiada. Impórtala como servidor MCP en tu aplicación.');}}catch{setNotice('No se pudo copiar. La configuración está guardada en el externo.');}}}>Copiar configuración MCP</button>
      <p className="text-muted">{state?.bridge?.configFile}</p><p>El host conectado puede leer las tareas que envías y devolver propuestas. La inteligencia la aporta ese host; conectar MCP no activa por sí solo Claude. Comparte aquí material GENERIC.</p>
      <textarea aria-label="Tarea para otra app" data-mcp-input maxLength={6000} value={prompt} onChange={e=>setPrompt(e.target.value)} className="w-full bg-raised p-3" placeholder="Material y encargo para el especialista externo" />
      <button disabled={busy||!prompt.trim()} data-mcp-queue onClick={()=>void queue()}>Enviar al puente</button>
      <p>Runtime Claude Code local: {state?.localHost?.detected?'DETECTED':'NOT_INSTALLED'}. Usa el especialista MCP local; no consume una suscripción ni la API de Claude.</p>
      <div data-testid="local-mcp-host">{state?.localHost?.last?.state} · {state?.localHost?.last?.intelligence}</div>
      <div data-testid="mcp-jobs">{state?.jobs.map(j=><article key={j.id} className="border-t border-hairline py-2"><p>{j.id} · {j.state} · {j.verification}</p><p>{j.prompt}</p>{j.text&&<p className="whitespace-pre-wrap">{j.text}</p>}<p>{j.host}</p>{j.state==='WAITING_HOST'&&<button disabled={busy||!state.localHost?.detected||!(state.mcpModel??state.economyModel)} data-intelligence-action={'run-local:'+j.id} onClick={()=>void action('run-local:'+j.id)}>Resolver con host local</button>}</article>)}</div>
    </div>
    {notice&&<p role="status">{notice}</p>}
  </div>;
}
