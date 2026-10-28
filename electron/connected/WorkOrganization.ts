import type {ProviderDescriptor} from '../../src/fabric/types';
import {safeContextText} from '../../src/fabric/ContinuityState';
import type {ConciliusPlan} from './ConciliusCoordinator';

export interface OrganizationRequest {kind:'summary'|'tasks'|'followup';text:string;review:boolean}
export function organizationRequest(raw:unknown):OrganizationRequest {
  const r=raw as Partial<OrganizationRequest>|null;
  if(!r||typeof r!=='object'||Object.keys(r).some(key=>!['kind','text','review'].includes(key))
    ||!['summary','tasks','followup'].includes(r.kind??'')||typeof r.text!=='string'||!r.text.trim()||r.text.length>2000||typeof r.review!=='boolean')throw Error('ORGANIZATION_INVALID_REQUEST');
  return {kind:r.kind as OrganizationRequest['kind'],text:safeContextText(r.text.trim()),review:r.review};
}
/** Deterministic roles, no paid selection, no model-generated authority or plan. */
export function organizeWork(raw:unknown, providers:ProviderDescriptor[], enabled:string[],preferredModel?:string) {
  const request=organizationRequest(raw);
  const options=providers.filter(p=>enabled.includes(p.id)&&p.privacyClass==='LOCAL'&&p.costClass==='LOCAL'
    &&['ollama-local','bootstrap-local','llama-cpp-local'].includes(p.id)
    &&['AVAILABLE','DETECTED','CONNECTED'].includes(p.state)&&p.capabilities.some(c=>c.id==='chat'&&c.available))
    .flatMap(p=>(p.surface?.models??[]).map(model=>({providerId:p.id as ConciliusPlan['nodes'][number]['providerId'],model})));
  const rank=(model:string)=>preferredModel&&model===preferredModel?-1:/smollm2:1\.7b/i.test(model)?0:/qwen3.*4b/i.test(model)?1:/qwen2\.5.*3b/i.test(model)?2:10;
  options.sort((a,b)=>rank(a.model)-rank(b.model)||a.providerId.localeCompare(b.providerId)||a.model.localeCompare(b.model));
  const worker=options[0];if(!worker)throw Error('ORGANIZATION_NO_ENABLED_LOCAL_MODEL');
  const expert=options.find(o=>o.providerId!==worker.providerId)||worker;
  const field=request.kind==='summary'?'summary':'tasks';
  const plan:ConciliusPlan={version:1,dataClass:'LOCAL_ONLY',nodes:[{id:'produce',role:'producer',dependsOn:[],...worker,
    ...(request.kind==='followup'?{maxOutputTokens:512}:{}),
    prompt:(request.kind==='followup'?"Extrae un seguimiento breve en español usando sólo el material recibido. Devuelve SOLO JSON con tres campos. summary: un solo texto con los hechos, conservando nombres, cantidades y plazos. tasks: lista de textos con las acciones mencionadas que aún deben hacerse, incluidas las expresadas en futuro; conserva sujeto y plazo. unknowns: copia literalmente las oraciones del material que indiquen falta de información o confirmación (falta, pendiente, no se conoce, sin confirmar). Si existe alguna de esas oraciones, unknowns no puede quedar vacío. No inventes fases, progreso, acciones realizadas ni nuevos datos. Ninguna lista contiene objetos.\nMaterial:\n":request.kind==='summary'?'Devuelve un resumen breve en español. Mantén nombres propios y fecha. Responde exclusivamente con JSON {"summary":"..."}.\nTexto:\n':'Extract explicit actionable tasks. Return ONLY JSON {"tasks":["..."]} in the input language. Every array element must be a plain JSON string, never an object. No name/title/task keys. Preserve natural language, not snake_case. Do not invent missing tasks.\nInput data:\n')
      +request.text,verification:request.kind==='followup'?{kind:'FOLLOWUP_BRIEF'}:request.kind==='tasks'?{kind:'JSON_STRING_LIST',field}:{kind:'JSON_SHAPE',fields:{[field]:'string'}}}]};
  if(request.review)plan.nodes.push({id:'review',role:'critic',dependsOn:['produce'],...expert,
    prompt:'Review the preceding result against this original input. Give a brief public critique; advisory only.\nOriginal input:\n'+request.text,verification:{kind:'MODEL_REVIEW'}});
  return {plan,organization:{policy:'ECONOMY_LOCAL_V1',classificationModelCalls:0,plannedInferenceCalls:plan.nodes.length,
    reviewRequested:request.review,automaticPaidFallback:false,verificationScope:request.kind==='followup'?'Bounded summary/tasks/unknowns structure only; factual accuracy and execution are not certified':request.kind==='tasks'?'Bounded JSON string list only; semantic quality is not certified':'JSON shape only; semantic quality is not certified'}};
}
