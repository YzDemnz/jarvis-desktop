import {build} from 'esbuild';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import {pathToFileURL} from 'node:url';
const evidence='docs/evidence/intelligence-bridge-20261022';
const directory=fs.mkdtempSync(path.join(os.tmpdir(),'jarvis-owned-model-manager-'));
await build({entryPoints:['electron/bridge/LocalModelManager.ts'],bundle:true,platform:'node',format:'esm',outfile:path.join(directory,'manager.mjs')});
const {LocalModelManager,OPEN_MODELS}=await import(pathToFileURL(path.join(directory,'manager.mjs')));
const manager=new LocalModelManager(path.join(process.env.JARVIS_USER_DATA,'intelligence-connections/models'),process.env.OLLAMA_MODELS,process.env.OLLAMA_HOST??'http://127.0.0.1:11434');
const timer=setInterval(()=>fs.writeFileSync(path.join(evidence,'provision-progress.json'),JSON.stringify(manager.snapshot(),null,2)),2000);
const records=[];
const chosen=process.argv[2];if(chosen&&!OPEN_MODELS.some(m=>m.id===chosen))throw Error('UNKNOWN_CATALOG_MODEL');
try{for(const model of OPEN_MODELS.filter(m=>!chosen||m.id===chosen)){console.log('INSTALL '+model.model);try{await manager.install(model.id);const receipt=await manager.probe(model.id);records.push({model:model.model,receipt});console.log(model.model+' '+receipt.state);}catch(error){records.push({model:model.model,error:String(error)});console.log(model.model+' FAILED');}fs.writeFileSync(path.join(evidence,chosen?'provision-'+chosen+'.json':'provision-result.json'),JSON.stringify({status:'COMPLETED',records,store:process.env.OLLAMA_MODELS,paidApiCalls:0},null,2));}}
finally{clearInterval(timer);}
