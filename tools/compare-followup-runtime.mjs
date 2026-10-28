import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {build} from 'esbuild';
import {pathToFileURL} from 'node:url';
const dir='docs/evidence/intelligence-bridge-20261022',root=fs.mkdtempSync(path.join(os.tmpdir(),'jarvis-followup-compare-'));
await build({entryPoints:['electron/connected/WorkOrganization.ts'],bundle:true,platform:'node',format:'esm',outfile:path.join(root,'work.mjs')});
const {organizeWork}=await import(pathToFileURL(path.join(root,'work.mjs')));
const cases=JSON.parse(fs.readFileSync(dir+'/native-schema/frozen.json')).cases;
const variants=[{model:'qwen2.5:3b-instruct',tokens:512}];
fs.writeFileSync(dir+'/followup-stable-frozen.json',JSON.stringify({cases,variants,criteria:'Same input, prompt and schema; require shape, original markers and explicit missing fact; cold-load times not directly comparable'},null,2));
const schema={type:'object',properties:{summary:{type:'string'},tasks:{type:'array',minItems:1,items:{type:'string'}},unknowns:{type:'array',items:{type:'string'}}},required:['summary','tasks','unknowns'],additionalProperties:false};
const records=[];
for(const variant of variants)for(const fixture of cases){
  const provider={id:'ollama-local',state:'AVAILABLE',privacyClass:'LOCAL',costClass:'LOCAL',capabilities:[{id:'chat',available:true}],surface:{models:[variant.model]}};
  const prompt=organizeWork({kind:'followup',text:fixture.text,review:false},[provider],['ollama-local'],variant.model).plan.nodes[0].prompt;
  const started=Date.now(),data=await(await fetch('http://127.0.0.1:11434/api/'+(variant.chat?'chat':'generate')+'',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({model:variant.model,stream:false,...('think'in variant?{think:variant.think}:{}),...(variant.chat?{messages:[{role:'user',content:prompt}]}:{prompt}),format:schema,options:{temperature:0,num_ctx:4096,num_predict:variant.tokens}}),signal:AbortSignal.timeout(180000)})).json();
  const text=data.response??data.message?.content??'';let value;try{value=JSON.parse(text.trim().replace(/^```json\s*\n([\s\S]*?)\n```$/,'$1'));}catch{}
  const shape=typeof value?.summary==='string'&&['tasks','unknowns'].every(k=>Array.isArray(value?.[k])&&value[k].every(v=>typeof v==='string'));
  const markers=fixture.markers.every(s=>text.toLowerCase().includes(s.toLowerCase())),missing=Array.isArray(value?.unknowns)&&value.unknowns.some(s=>typeof s==='string'&&new RegExp(fixture.unknownPattern,'i').test(s));
  const record={variant,fixture,text,status:shape&&value.tasks.length>=1&&markers&&missing?'PASS':'FAIL',shape,markers,missing,inputTokens:data.prompt_eval_count,outputTokens:data.eval_count,thinkingChars:data.thinking?.length??data.message?.thinking?.length??0,doneReason:data.done_reason,elapsedMs:Date.now()-started,error:data.error??null};records.push(record);fs.writeFileSync(dir+'/followup-stable-result.json',JSON.stringify(records,null,2));console.log(variant.model,record.status,record.outputTokens,text);
}
