export type WorkKind='FIND_DOCUMENTS'|'READ_DOCUMENTS'|'UNDERSTAND'|'CREATE_WORD'|'CREATE_AUDIO'|'CREATE_IMAGE'|'CREATE_VIDEO';
export type WorkState='STARTED'|'VERIFIED'|'PRODUCED'|'PARTIAL'|'BLOCKED'|'FAILED'|'STOPPED'|'INTERRUPTED';
export interface WorkPlan {version:1;kinds:WorkKind[];paths:string[];roots:string[];query:string|null;mediaText:string;classificationModelCalls:0}
export interface SourceLine {id:string;text:string;page?:number}
export interface DocumentSource {id:string;path:string;sha256:string;bytes:number;format:string;lines:SourceLine[];truncated:boolean;pages?:number;warnings:string[]}
export interface GroundedAnalysis {answer:string;evidence:string[];actions:string[];unknowns:string[]}
export interface WorkArtifact {kind:'WORD'|'AUDIO'|'IMAGE'|'VIDEO';path:string;sha256:string;bytes:number;verification:string;metadata?:Record<string,unknown>}
export interface WorkStep {kind:WorkKind;state:WorkState;executor:string;detail:string;at:number}
export interface WorkReceipt {version:1;id:string;originalHash:string;prompt:string;plan:WorkPlan;state:WorkState;createdAt:number;updatedAt:number;steps:WorkStep[];sources:DocumentSource[];matches:{path:string;name:string}[];searches:unknown[];analysis?:GroundedAnalysis;analysisVerification?:{state:'VERIFIED'|'FAILED';scope:string;errors:string[]};inference?:{operationId:string;providerId:string;model:string|null;raw:string};inferenceAttempts?:{operationId:string;raw:string;errors:string[]}[];resourceEvents?:{state:'RELEASED'|'SKIPPED';model:string|null;reason:string;beforeVramBytes?:number;generationTokens:0;scope:string}[];artifacts:WorkArtifact[];answer:string;error?:string;paidApiCalls:0}
const norm=(text:string)=>text.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
/** JARVIS selects a closed capability plan from the original instruction only. */
export function workPlan(original:string):WorkPlan|null {
  if(!original.trim()||original.length>12000)return null;
  const normalizedQuotes=original.replace(/[«»]/g,'"');
  const quoted=[...normalizedQuotes.matchAll(/["“]([^"”\r\n]+)["”]/g)].map(m=>m[1]!);
  const paths=quoted.filter(s=>/^[a-z]:[\\/]/i.test(s)&&/\.(docx|pdf|txt|md|csv)$/i.test(s)).slice(0,4);
  const roots=quoted.filter(s=>/^[a-z]:[\\/]/i.test(s)&&!pathExt(s)).slice(0,4);
  const command=norm(normalizedQuotes.replace(/["“][^"”\r\n]+["”]/g,' SOURCE ')).replace(/\bno\s+(?:me\s+)?(?:crees|crea|generes|genera|hagas|haga|quiero|necesito|escribas|escriba)\b[^.;\n]*(?:[.;\n]|$)/g,' ');
  if(/^\s*(?:[¿?]\s*)?(?:(?:puedes?\s+)?(?:decirme|explicarme|explica(?:me)?|ensena(?:me)?)\s+)?(?:como|que es)\b/.test(command))return null;
  if(/\b(codigo|code|bug|refactor|compila|typecheck|repositorio)\b/.test(command)&&/\b(corrige|repara|arregla|implementa|refactoriza)\b/.test(command))return null;
  const action=/\b(crea|crear|creame|genera|generar|generame|haz|hazme|prepara|preparar|escribe|escribir|redacta|convierte|convertir)\b/.test(command);
  const find=/\b(busca|buscar|encuentra|encontrar|localiza|localizar)\b/.test(command);
  const understand=/\b(lee|leer|leelo|leelos|leela|leelas|entiende|entender|analiza|analizar|resume|resumir|resumelo|resumelos|compara|comparar|extrae|extraer|explica|explicar)\b/.test(command);
  if(find&&!action&&!understand&&/\.(xlsx?|json|tsx?|jsx?|png|jpe?g|zip|exe)\b/i.test(original))return null;
  const documents=paths.length>0||/\b(documentos?|archivos?|contratos?|informes?|pdfs?|docx|word)\b/.test(command);
  const kinds:WorkKind[]=[];
  const structuredDocuments=/\b(documentos?|contratos?|informes?|pdfs?|docx|word)\b/.test(command)||paths.some(p=>/\.(docx|pdf)$/i.test(p));
  if(find&&structuredDocuments)kinds.push('FIND_DOCUMENTS');
  if(documents&&understand)kinds.push('READ_DOCUMENTS','UNDERSTAND');
  if(action&&/\b(word|docx)\b/.test(command))kinds.push('CREATE_WORD');
  if((action&&/\b(audio|audios|voz|narracion|wav)\b/.test(command))||/\b(lee|leer|lelo|leelo)\b.*\bvoz\b/.test(command))kinds.push('CREATE_AUDIO');
  if(action&&/\b(imagen|imagenes|foto|fotos|ilustracion|ilustraciones)\b/.test(command))kinds.push('CREATE_IMAGE');
  if(action&&/\b(video|videos|mp4)\b/.test(command)){if(!kinds.includes('CREATE_IMAGE'))kinds.push('CREATE_IMAGE');kinds.push('CREATE_VIDEO');}
  if(!kinds.length)return null;
  if(paths.length&&!kinds.includes('READ_DOCUMENTS'))kinds.unshift('READ_DOCUMENTS');
  if(kinds.includes('CREATE_WORD')&&paths.length&&!kinds.includes('UNDERSTAND'))kinds.splice(kinds.indexOf('CREATE_WORD'),0,'UNDERSTAND');
  const firstClause=normalizedQuotes.replace(/["“][^"”\r\n]+["”]/g,' ').split(/[,;.!?]|\s+y\s+|\s+e\s+/i)[0]??'';
  const fallback=firstClause.split(/\s+/).filter(s=>s&&!/^(?:busca|buscar|encuentra|encontrar|localiza|localizar|el|la|los|las|un|una|unos|unas|mi|mis|de|del|en|documento|documentos|archivo|archivos|contrato|contratos|informe|informes|pdf|word|llamado|llamada|sobre)$/i.test(norm(s))).slice(0,3).join(' ');
  const query=find?(quoted.find(s=>!(/^[a-z]:[\\/]/i.test(s)))??normalizedQuotes.match(/[\wáéíóúñ.-]+\.(?:docx|pdf|txt|md)\b/i)?.[0]?.trim()??(fallback||null)):null;
  const mediaText=quoted.find(s=>!(/^[a-z]:[\\/]/i.test(s)))??original;
  return {version:1,kinds:[...new Set(kinds)],paths,roots,query,mediaText,classificationModelCalls:0};
}
function pathExt(value:string){return /\.[a-z0-9]{1,8}$/i.test(value);}

export function checkAnalysis(raw:string,sources:DocumentSource[],question=''):{value:GroundedAnalysis|null;errors:string[]} {
  let value:unknown;try{value=JSON.parse(raw.trim().replace(/^```(?:json)?\s*\n([\s\S]*?)\n```$/,'$1'));}catch{return {value:null,errors:['ANALYSIS_JSON_INVALID']};}
  const v=value as Partial<GroundedAnalysis>|null,errors:string[]=[];
  if(!v||typeof v!=='object'||Array.isArray(v)||Object.keys(v).sort().join(',')!=='actions,answer,evidence,unknowns'||typeof v.answer!=='string'||!v.answer.trim()||v.answer.length>5000)return {value:null,errors:['ANALYSIS_SHAPE_INVALID']};
  const ids=new Set(sources.flatMap(s=>s.lines.map(l=>l.id)));
  if(/^[\[{]/.test(v.answer.trim()))errors.push('ANALYSIS_ANSWER_MUST_BE_PROSE');
  for(const field of ['evidence','actions','unknowns']as const){const list=v[field];if(!Array.isArray(list)||list.length>12||list.some(id=>typeof id!=='string'||!ids.has(id))||new Set(list).size!==list.length)errors.push('ANALYSIS_SOURCE_REFERENCE_INVALID_'+field);}
  if(sources.length&&(!Array.isArray(v.evidence)||!v.evidence.length))errors.push('ANALYSIS_EVIDENCE_REQUIRED');
  if(!errors.length){
    const lines=sources.flatMap(s=>s.lines);
    for(const line of lines.filter(l=>/\bdebe(?:rá|ran|n)?\b/i.test(l.text)).slice(0,12))if(!v.actions!.includes(line.id))errors.push('ANALYSIS_ACTION_REFERENCE_REQUIRED:'+line.id);
    for(const line of lines.filter(l=>/\bfalta\b|\bno se conoce\b|\bsin confirmar\b|\ba[uú]n no\b.*\b(?:aprobad|confirmad)/i.test(l.text)).slice(0,12))if(!v.unknowns!.includes(line.id))errors.push('ANALYSIS_UNKNOWN_REFERENCE_REQUIRED:'+line.id);
    if(/cantidad|cifra|importe|presupuesto|numer/i.test(norm(question))){const numbers=[...new Set(lines.flatMap(l=>l.text.match(/\b\d+(?:[.,]\d+)?\b/g)??[]))].slice(0,16);for(const n of numbers)if(!v.answer!.includes(n))errors.push('ANALYSIS_QUANTITY_MISSING:'+n);}
  }
  return {value:errors.length?null:v as GroundedAnalysis,errors};
}
/** Exact references and obvious source markers need no model tokens. */
export function annotateSources(sources:DocumentSource[]){const lines=sources.flatMap(s=>s.lines);return {evidence:lines.slice(0,12).map(l=>l.id),actions:lines.filter(l=>/\bdebe(?:rá|ran|n)?\b/i.test(l.text)).slice(0,12).map(l=>l.id),unknowns:lines.filter(l=>/\bfalta\b|\bno se conoce\b|\bsin confirmar\b|\ba[uú]n no\b.*\b(?:aprobad|confirmad)/i.test(l.text)).slice(0,12).map(l=>l.id)};}
export function analysisFormat(){return {type:'object',properties:{answer:{type:'string'}},required:['answer'],additionalProperties:false};}
