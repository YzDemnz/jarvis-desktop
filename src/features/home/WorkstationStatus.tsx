import {useEffect,useState} from 'react';
import type {WorkReceipt} from '@/workbench/contracts';
export function WorkstationStatus(){
  const [runs,setRuns]=useState<WorkReceipt[]>([]),[error,setError]=useState('');
  useEffect(()=>{if(!window.jarvis?.workbench)return;let disposed=false;const refresh=()=>window.jarvis!.workbench.snapshot().then(s=>{if(!disposed){setRuns(s.runs);setError(s.warnings.length?'Hay registros ilegibles conservados; las otras tareas siguen disponibles.':'');}}).catch(()=>{if(!disposed)setError('No se pudo leer el estado de trabajos');});void refresh();const timer=setInterval(()=>void refresh(),1800);return()=>{disposed=true;clearInterval(timer);};},[]);
  if(!window.jarvis?.workbench)return null;
  return <section data-testid="workstation-status" className="mt-5 mb-8 text-xs text-muted rounded-lg border border-hairline p-4">
    <div className="text-ink/90 mb-2">Documentos y multimedia</div>
    <p>Busca «nombre del documento», léelo y crea un Word. También puedes pedir audio, una imagen o un vídeo ilustrado. Los archivos se guardan en el externo.</p>
    <p className="mt-1">Para leer un archivo concreto, incluye su ruta completa entre comillas. Una interpretación de IA conserva el estado de propuesta.</p>
    {error&&<p className="text-clay mt-2">{error}</p>}
    {runs.slice(0,4).map(run=><div key={run.id} data-testid="workstation-run" data-run-id={run.id} className="mt-3 border-t border-hairline pt-3">
      <div className="text-ink/90">{run.state} · {run.plan.kinds.join(' → ')}</div>
      <div className="truncate mt-1">{run.prompt}</div>
      {run.steps.map((s,i)=><div key={i} className="mt-1">{s.kind}: {s.state} · {s.executor}</div>)}
      {run.error&&<p className="text-clay mt-1">{run.error}</p>}
      {run.artifacts.map((artifact,i)=><button type="button" className="block text-signal mt-2 text-left break-all" key={artifact.path} onClick={()=>void window.jarvis!.workbench.reveal(run.id,i)}>{artifact.kind} · {artifact.path}</button>)}
    </div>)}
  </section>;
}
