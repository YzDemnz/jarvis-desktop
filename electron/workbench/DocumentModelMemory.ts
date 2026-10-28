import {boundedJson,loopbackEndpoint} from '../connected/HttpProvider';
export interface ModelMemoryHandoff {state:'RELEASED'|'SKIPPED';model:string|null;reason:string;beforeVramBytes?:number;generationTokens:0;scope:string;residencyChecks?:number;elapsedMs?:number}
/** A supported scheduler unload, never a process kill or model deletion. */
export async function releaseDocumentModelMemory(model:string|null,endpoint:string,active:()=>number,gate:()=>void,signal?:AbortSignal,request:typeof boundedJson=boundedJson,timing={now:()=>performance.now(),wait:()=>new Promise<void>(resolve=>setTimeout(resolve,150))}):Promise<ModelMemoryHandoff>{
  gate();const scope='Only the last document model used by this JARVIS process; shared clients can reload it later';
  const skip=(reason:string):ModelMemoryHandoff=>({state:'SKIPPED',model,reason,generationTokens:0,scope});
  if(!model)return skip('NO_DOCUMENT_MODEL_OWNED');if(active())return skip('INFERENCE_ACTIVE');
  if(!/^[a-zA-Z0-9._:/-]{1,200}$/.test(model)||/(?:^|[-:])cloud(?:$|[-:])/.test(model))throw Error('MEMORY_MODEL_INVALID');
  const base=loopbackEndpoint(endpoint),before=await request(base+'/api/ps',{signal},20000);gate();
  if(!Array.isArray(before.models))throw Error('MEMORY_RESIDENCY_UNKNOWN');
  const resident=before.models.find((m:{name?:string;model?:string})=>m.name===model||m.model===model);
  if(!resident)return skip('ALREADY_NOT_RESIDENT');if(active())return skip('INFERENCE_BECAME_ACTIVE');
  const result=await request(base+'/api/generate',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({model,keep_alive:0,stream:false}),signal},30000);gate();
  if(result.done!==true||result.done_reason!=='unload'||result.response||result.eval_count)throw Error('MEMORY_UNLOAD_NOT_CONFIRMED');
  const started=timing.now();let residencyChecks=0;
  while(true){
    gate();if(active())throw Error('MEMORY_INFERENCE_BECAME_ACTIVE');const remaining=15000-(timing.now()-started);if(remaining<=0)throw Error('MEMORY_MODEL_STILL_RESIDENT');
    const after=await request(base+'/api/ps',{signal},Math.max(1,Math.min(2000,remaining)));gate();residencyChecks++;
    if(!Array.isArray(after.models))throw Error('MEMORY_RESIDENCY_UNKNOWN');
    if(!after.models.some((m:{name?:string;model?:string})=>m.name===model||m.model===model))return {state:'RELEASED',model,reason:'SUPPORTED_UNLOAD_AND_RESIDENCY_RECHECK',beforeVramBytes:Number(resident.size_vram)||0,generationTokens:0,scope,residencyChecks,elapsedMs:Math.round(timing.now()-started)};
    await timing.wait();gate();
  }
}
