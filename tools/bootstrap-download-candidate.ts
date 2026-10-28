import fs from 'node:fs';
import path from 'node:path';
import { ArtifactInstaller } from '../electron/bootstrap/ArtifactInstaller';
import { TRUSTED_MODELS } from '../electron/bootstrap/BootstrapController';

const root=path.resolve('../Dependencias/BootstrapAssets');fs.mkdirSync(root,{recursive:true});
const candidate=TRUSTED_MODELS.find(x=>x.id==='qwen3-4b-gguf')!;
const signal=new AbortController();process.on('SIGINT',()=>signal.abort());let last=0;
const started=Date.now();
try{const file=await new ArtifactInstaller(root).obtain(candidate.artifact,signal.signal,received=>{if(Date.now()-last>10000||received===candidate.artifact.size){last=Date.now();console.log(JSON.stringify({candidate:candidate.id,received,total:candidate.artifact.size}));}});
const result={status:'VERIFIED',download:'REAL_NETWORK_OR_VERIFIED_RESUME',source:candidate.source,url:candidate.artifact.url,sha256:candidate.artifact.sha256,size:candidate.artifact.size,file,elapsedMs:Date.now()-started};fs.writeFileSync('docs/evidence/bootstrap-20261007/model-download.json',JSON.stringify(result,null,2));console.log('MODEL_DOWNLOAD_VERIFIED');}
catch(e){fs.writeFileSync('docs/evidence/bootstrap-20261007/download-failure-'+Date.now()+'.json',JSON.stringify({status:'FAIL',error:String(e),source:candidate.source},null,2));throw e;}
