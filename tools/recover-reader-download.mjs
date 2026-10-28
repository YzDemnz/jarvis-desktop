// Recovery of a public, pinned Ollama layer. Does not alter internal model-store files.
// Admission uses the documented POST /api/blobs/:digest, followed by the normal pull.
import fs from 'node:fs';import path from 'node:path';import {createHash} from 'node:crypto';
const digest='2bada8a7450677000f678be90653b85d364de7db25eb5ea54136ada5f3933730',size=4683073952;
const root='E:/CODEX/Aplicaciones/JARVIS/Dependencias/Caches/reader-download';fs.mkdirSync(root,{recursive:true});
const file=path.join(root,digest+'.gguf'),receipt=path.resolve('docs/evidence/device-workflows-20261022/readers/range-download.json');
if(fs.existsSync(receipt))fs.copyFileSync(receipt,receipt.replace('.json','-attempt-'+Date.now()+'.json'));
const record={source:'https://registry.ollama.ai/v2/library/qwen2.5/blobs/sha256:'+digest,bytes:size,sha256:digest,received:0,startedAt:new Date().toISOString(),state:'DOWNLOADING',paidCalls:0};
const save=()=>fs.writeFileSync(receipt,JSON.stringify(record,null,2));save();
try{
 const hashFile=async()=>{const h=createHash('sha256');for await(const chunk of fs.createReadStream(file))h.update(chunk);return h.digest('hex');};
 if(!fs.existsSync(file)||fs.statSync(file).size!==size||await hashFile()!==digest){
  const fd=await fs.promises.open(file,'w');await fd.truncate(size);let next=0;const chunkSize=16*1024*1024;
  try{const results=await Promise.allSettled(Array.from({length:4},async()=>{while(next<size){const start=next;next+=chunkSize;const end=Math.min(size-1,start+chunkSize-1);let done=false;
   for(let attempt=0;attempt<3&&!done;attempt++){try{const options={headers:{range:`bytes=${start}-${end}`},redirect:'manual',signal:AbortSignal.timeout(180000)};let response=await fetch(record.source,options);
    if(response.status===307){const target=new URL(response.headers.get('location'));if(target.protocol!=='https:'||target.hostname!=='dd20bb891979d25aebc8bec07b2b3bbc.r2.cloudflarestorage.com')throw Error('UNEXPECTED_REGISTRY_REDIRECT');await response.body?.cancel();response=await fetch(target,{...options,redirect:'error'});}
    if(response.status!==206||response.headers.get('content-range')!==`bytes ${start}-${end}/${size}`)throw Error('RANGE_NOT_HONORED');const data=Buffer.from(await response.arrayBuffer());if(data.length!==end-start+1)throw Error('RANGE_LENGTH');let wrote=0;while(wrote<data.length){const result=await fd.write(data,wrote,data.length-wrote,start+wrote);if(!result.bytesWritten)throw Error('WRITE_SHORT');wrote+=result.bytesWritten;}record.received+=data.length;save();done=true;
   }catch(error){if(attempt===2)throw error;}}
  }}));const failed=results.find(r=>r.status==='rejected');if(failed)throw failed.reason;}finally{await fd.close();}
  record.state='HASHING';save();if(await hashFile()!==digest)throw Error('LAYER_HASH_MISMATCH');
 }
 record.state='UPLOADING_LOCAL_BLOB';record.received=size;save();
 const response=await fetch('http://127.0.0.1:11434/api/blobs/sha256:'+digest,{method:'POST',headers:{'content-type':'application/octet-stream','content-length':String(size)},body:fs.createReadStream(file),duplex:'half',signal:AbortSignal.timeout(600000)});
 if(response.status!==201)throw Error('LOCAL_BLOB_HTTP_'+response.status);
 record.state='VERIFIED_BLOB_UPLOADED';record.completedAt=new Date().toISOString();save();console.log(record.state);
}catch(error){record.state='FAILED';record.error=String(error);save();throw error;}
