import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {boundedJson,loopbackEndpoint} from '../connected/HttpProvider';
export const OPEN_MODELS=[
  {id:'qwen-daily',model:'qwen3.5:2b',label:'Qwen 3.5 · Alibaba',role:'Especialista MCP; seguimiento JSON experimental',bytes:2683396812,digest:'0689d44085e06d165161a8a9a1731344278cfb5aade63a3c3dbdb48ab54b130a',source:'https://ollama.com/library/qwen3.5'},
  {id:'deepseek-small',model:'deepseek-r1:1.5b',label:'DeepSeek R1 · destilado 1.5B',role:'Alternativa de razonamiento; seguimiento estructurado parcial',bytes:1117322768,digest:'e0979632db5a88d1a53884cb2a941772d10ff5d055aabaa6801c4e36f3a6c2d7',source:'https://ollama.com/library/deepseek-r1'},
  {id:'internlm-small',model:'internlm2:1.8b',label:'InternLM2 · Shanghai AI Lab',role:'Alternativa pequeña; seguimiento estructurado parcial',bytes:1113983695,digest:'653be3eb69a08cb0a42dfa19194888c74092bfdc59a270844be4842c62cb692d',source:'https://ollama.com/library/internlm2'},
  {id:'qwen-stable',model:'qwen2.5:3b-instruct',label:'Qwen 2.5 · Alibaba',role:'Trabajo diario y seguimientos estructurados',bytes:1929912432,digest:'357c53fb659c5076de1d65ccb0b397446227b71a42be9d1603d46168015c9e4b',source:'https://ollama.com/library/qwen2.5'},
  {id:'qwen-reader',model:'qwen2.5:7b-instruct',label:'Qwen 2.5 7B · lector local',role:'Candidato para comprensión documental; calidad por tarea',bytes:4683087332,digest:'845dbda0ea48ed749caafd9e6037047aa19acfcfd82e704d7ca97d631a0b697e',source:'https://ollama.com/library/qwen2.5'},
] as const;
export interface ModelReceipt {id:string;state:'DETECTED'|'DOWNLOADING'|'PROBING'|'INSTALLED'|'VERIFIED'|'FAILED'|'INTERRUPTED';received:number;total:number;at:number;error?:string;phase?:'INTEGRITY'|'INFERENCE';integrityMs?:number;probe?:{expected:number;observed:unknown;inputTokens:number|null;outputTokens:number|null;elapsedMs:number;responseHash:string;responseText?:string;scope:string}}
export class LocalModelManager {
  private records=new Map<string,ModelReceipt>();private active=new Map<string,AbortController>();
  private endpoint:string;
  constructor(private directory:string,readonly modelStore:string,endpoint:string){
    if(!path.isAbsolute(directory)||!path.isAbsolute(modelStore)||!/^E:\\CODEX\\/i.test(path.resolve(modelStore)))throw Error('MODEL_EXTERNAL_STORE_REQUIRED');
    this.endpoint=loopbackEndpoint(endpoint);fs.mkdirSync(directory,{recursive:true});
    for(const model of OPEN_MODELS){try{const r=JSON.parse(fs.readFileSync(this.file(model.id),'utf8')) as ModelReceipt;if(r.id===model.id){if(['DOWNLOADING','PROBING'].includes(r.state)){r.state='INTERRUPTED';r.error='Restart does not replay a download or probe';}this.records.set(model.id,r);}}catch{}
      if(!this.records.has(model.id)){try{const [name,tag]=model.model.split(':') as [string,string];const bytes=fs.readFileSync(path.join(modelStore,'manifests','registry.ollama.ai','library',name,tag));if(createHash('sha256').update(bytes).digest('hex')===model.digest)this.records.set(model.id,{id:model.id,state:'DETECTED',received:0,total:model.bytes,at:Date.now()});}catch{}}}
  }
  private file(id:string){return path.join(this.directory,id+'.json');}
  private save(receipt:ModelReceipt){this.records.set(receipt.id,receipt);fs.writeFileSync(this.file(receipt.id)+'.tmp',JSON.stringify(receipt));fs.renameSync(this.file(receipt.id)+'.tmp',this.file(receipt.id));}
  snapshot(){return OPEN_MODELS.map(model=>({...model,receipt:this.records.get(model.id)??null,store:this.modelStore}));}
  verifiedModel(model:string){return OPEN_MODELS.some(m=>m.model===model&&this.records.get(m.id)?.state==='VERIFIED');}
  cancel(){this.active.forEach(c=>c.abort());}
  private candidate(id:string){const model=OPEN_MODELS.find(m=>m.id===id);if(!model)throw Error('MODEL_NOT_IN_CATALOG');return model;}
  private async physical(id:string,signal?:AbortSignal){
    const model=this.candidate(id),[name,tag]=model.model.split(':') as [string,string];
    const manifest=fs.readFileSync(path.join(this.modelStore,'manifests','registry.ollama.ai','library',name,tag));
    if(createHash('sha256').update(manifest).digest('hex')!==model.digest)throw Error('MODEL_MANIFEST_CHANGED');
    const data=JSON.parse(manifest.toString());
    for(const layer of [data.config,...data.layers]){
      if(!/^sha256:[a-f0-9]{64}$/.test(layer.digest)||!Number.isSafeInteger(layer.size))throw Error('MODEL_LAYER_INVALID');
      const file=path.join(this.modelStore,'blobs',layer.digest.replace(':','-'));
      if(fs.statSync(file).size!==layer.size)throw Error('MODEL_LAYER_SIZE_CHANGED');
      const hash=createHash('sha256');for await(const chunk of fs.createReadStream(file)){signal?.throwIfAborted();hash.update(chunk);}
      if(hash.digest('hex')!==layer.digest.slice(7))throw Error('MODEL_LAYER_HASH_CHANGED');
    }
    const show=await boundedJson(this.endpoint+'/api/show',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({model:model.model})});
    if(show.remote_host||show.remote_model)throw Error('MODEL_IS_REMOTE');return show;
  }
  async install(id:string){
    const model=this.candidate(id);if(this.active.size)throw Error('MODEL_OPERATION_BUSY');
    const controller=new AbortController();this.active.set(id,controller);const timer=setTimeout(()=>controller.abort(),1200000);
    const record:ModelReceipt={id,state:'DOWNLOADING',received:0,total:model.bytes,at:Date.now()};this.save(record);
    try{
      const response=await fetch(this.endpoint+'/api/pull',{method:'POST',redirect:'error',headers:{'content-type':'application/json'},body:JSON.stringify({model:model.model,stream:true}),signal:controller.signal});
      if(!response.ok||!response.body)throw Error('MODEL_PULL_HTTP_'+response.status);
      let buffer='',last=0;const decoder=new TextDecoder();let success=false;
      const reader=response.body.getReader();
      while(true){
        const chunk=await reader.read();if(chunk.done)break;
        buffer+=decoder.decode(chunk.value,{stream:true});if(buffer.length>1024*1024)throw Error('MODEL_PULL_RESPONSE_TOO_LARGE');
        let end;while((end=buffer.indexOf('\n'))>=0){const line=buffer.slice(0,end);buffer=buffer.slice(end+1);if(!line.trim())continue;const event=JSON.parse(line);if(event.error)throw Error('MODEL_PULL_FAILED');
          if(event.status==='success')success=true;
          if(Number.isFinite(event.completed))record.received=Math.max(record.received,Math.min(event.completed,model.bytes));
          if(Date.now()-last>300){last=Date.now();this.save(record);}}
      }
      if(!success)throw Error('MODEL_PULL_INCOMPLETE');controller.signal.throwIfAborted();await this.physical(id,controller.signal);controller.signal.throwIfAborted();
      record.state='INSTALLED';record.received=model.bytes;record.at=Date.now();this.save(record);return record;
    }catch(error){record.state=controller.signal.aborted?'INTERRUPTED':'FAILED';record.error=controller.signal.aborted?'Cancelled request; partial layers may remain for an explicit retry':/^MODEL_[A-Z_0-9]+$/.test(String((error as Error).message))?(error as Error).message:'MODEL_OPERATION_FAILED';record.at=Date.now();this.save(record);throw Error(record.error);}
    finally{clearTimeout(timer);this.active.delete(id);}
  }
  async probe(id:string){
    const model=this.candidate(id);if(this.active.size)throw Error('MODEL_OPERATION_BUSY');
    const controller=new AbortController();this.active.set(id,controller);const timer=setTimeout(()=>controller.abort(),240000);
    const record:ModelReceipt={id,state:'PROBING',phase:'INTEGRITY',received:model.bytes,total:model.bytes,at:Date.now()};this.save(record);
    try{
      const show=await this.physical(id,controller.signal),started=Date.now();record.integrityMs=started-record.at;record.phase='INFERENCE';this.save(record);controller.signal.throwIfAborted();
      const result=await boundedJson(this.endpoint+'/api/chat',{method:'POST',headers:{'content-type':'application/json'},signal:controller.signal,body:JSON.stringify({model:model.model,stream:false,...(show.capabilities?.includes('thinking')?{think:false}:{}),messages:[{role:'user',content:'Calcula 17 + 8. Devuelve solamente JSON con el resultado numérico en el campo value.'}],format:{type:'object',properties:{value:{type:'number'}},required:['value'],additionalProperties:false},options:{temperature:0,num_ctx:4096,num_predict:256}})},180000);
      const text=result.message?.content;if(typeof text!=='string'||text.length>12000)throw Error('MODEL_PROBE_EMPTY');let observed:unknown;try{const parsed=JSON.parse(text.trim().replace(/^```json\s*\n([\s\S]*?)\n```$/,'$1'));if(parsed&&Object.keys(parsed).join(',')==='value')observed=parsed.value;}catch{}
      record.probe={expected:25,observed:observed??null,inputTokens:result.prompt_eval_count??null,outputTokens:result.eval_count??null,elapsedMs:Date.now()-started,responseHash:createHash('sha256').update(text).digest('hex'),responseText:text,scope:'Probe v2: one frozen 17+8 numeric JSON object, optional whole JSON Markdown fence; not general quality or Spanish competence'};
      record.state=observed===25?'VERIFIED':'FAILED';record.at=Date.now();this.save(record);return record;
    }catch(error){record.state=controller.signal.aborted?'INTERRUPTED':'FAILED';record.error=String((error as Error).message).slice(0,100);this.save(record);throw error;}
    finally{clearTimeout(timer);this.active.delete(id);}
  }
}
