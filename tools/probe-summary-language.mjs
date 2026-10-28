import fs from 'node:fs';
import path from 'node:path';
const folder='docs/evidence/economy-concilius-20261021/summary-language-probe';fs.mkdirSync(folder,{recursive:true});
const previous=JSON.parse(fs.readFileSync('docs/evidence/economy-concilius-20261021/templates/progress.json','utf8'))[0];
const text=previous.fixture.text,system=previous.checkpoint.operations[0].handoff;
const candidates=[
  'Resume brevemente el texto. Conserva su idioma original y sus nombres. No traduzcas. Devuelve sólo JSON {"summary":"..."}.\nTexto:\n'+text,
  'Devuelve un resumen breve en español. Mantén nombres propios y fecha. Responde exclusivamente con JSON {"summary":"..."}.\nTexto:\n'+text,
];
fs.writeFileSync(path.join(folder,'frozen.json'),JSON.stringify({text,system,candidates,markers:previous.fixture.markers,model:'smollm2:1.7b-instruct-q4_K_M',status:'EXPLORATORY_NOT_PRODUCT_VERIFICATION'},null,2),{flag:'wx'});
const results=[];
for(const prompt of candidates){
  const started=Date.now(),response=await fetch('http://127.0.0.1:11434/api/generate',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({model:'smollm2:1.7b-instruct-q4_K_M',system,prompt,stream:false,options:{temperature:0,num_predict:128}}),signal:AbortSignal.timeout(85000)});
  if(!response.ok)throw Error('LOCAL_HTTP_'+response.status);
  const body=await response.json();let parsed;try{parsed=JSON.parse(body.response);}catch{}
  const passed=typeof parsed?.summary==='string'&&previous.fixture.markers.every(marker=>parsed.summary.toLowerCase().includes(marker.toLowerCase()));
  results.push({prompt,response:body.response,inputTokens:body.prompt_eval_count,outputTokens:body.eval_count,elapsedMs:Date.now()-started,passed});fs.writeFileSync(path.join(folder,'result.json'),JSON.stringify({status:'EXPLORATORY',results,paidApiCalls:0},null,2));
}
console.log(JSON.stringify(results.map(r=>({passed:r.passed,response:r.response,elapsedMs:r.elapsedMs})),null,2));
