import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {createHash} from 'node:crypto';
import type {AuthorityState} from '../../src/authority/AuthorityState';
import {workPlan,checkAnalysis,annotateSources} from '../../src/workbench/contracts';
import type {DocumentSource,SourceLine,WorkReceipt,WorkKind,WorkArtifact,WorkState} from '../../src/workbench/contracts';
import {FileSystemService} from '../agent/FileSystemService';
import type {ConnectedAIService} from '../connected/ConnectedAIService';
import {spawnWindowsJob,withProcessScope,cancelOwnedRun} from '../process/WindowsJobProcess';
import {safeContextText} from '../../src/fabric/ContinuityState';
import {documentReasoningPrompt} from './DocumentReasoning';
import {pcmWavEvidence} from './MediaValidation';
const sha=(data:string|Buffer)=>createHash('sha256').update(data).digest('hex');
const ROOT='E:\\CODEX\\Aplicaciones\\JARVIS\\Dependencias\\Workstation';
const external=(file:string)=>/^E:\\CODEX\\/i.test(path.resolve(file));
export class WorkstationService {
  private readonly active=new Map<string,AbortController>();
  private readonly fs:FileSystemService;
  private readonly corrupt=new Set<string>();
  constructor(private readonly directory:string,private readonly authority:AuthorityState,private readonly connected:ConnectedAIService,private readonly node:string,private readonly worker:string){
    if(!external(directory))throw Error('WORKSTATION_EXTERNAL_STORAGE_REQUIRED');
    fs.mkdirSync(path.join(directory,'runs'),{recursive:true});this.fs=new FileSystemService(()=>authority.accessMode()==='FULL');
    for(const file of fs.readdirSync(path.join(directory,'runs')).filter(f=>f.endsWith('.json'))){const r=this.read(file);if(r?.state==='STARTED'){r.state='INTERRUPTED';r.error='Restart: explicit new request required; effects never replay';r.steps.filter(s=>s.state==='STARTED').forEach(s=>{s.state='INTERRUPTED';s.detail='Restart without replay';});this.persist(r);}}
  }
  private read(file:string):WorkReceipt|null{try{const target=path.join(this.directory,'runs',file);if(fs.statSync(target).size>2*1024*1024)throw Error('JOURNAL_SIZE');const r=JSON.parse(fs.readFileSync(target,'utf8')) as WorkReceipt;
    if(r.version!==1||typeof r.id!=='string'||sha(r.id)+'.json'!==file||typeof r.prompt!=='string'||!Array.isArray(r.steps)||!Array.isArray(r.sources)||!Array.isArray(r.artifacts)||!Array.isArray(r.plan?.kinds))throw Error('JOURNAL_SHAPE');return r;
  }catch{this.corrupt.add(file);return null;}}
  warnings(){return [...this.corrupt].map(file=>'Receipt unreadable and preserved; no replay: '+file);}
  private file(id:string){return path.join(this.directory,'runs',sha(id)+'.json');}
  private persist(r:WorkReceipt){r.updatedAt=Date.now();const file=this.file(r.id);fs.writeFileSync(file+'.tmp',JSON.stringify(r));fs.renameSync(file+'.tmp',file);}
  receipts(){return fs.readdirSync(path.join(this.directory,'runs')).filter(f=>f.endsWith('.json')).map(file=>this.read(file)).filter((r):r is WorkReceipt=>r!==null).sort((a,b)=>b.createdAt-a.createdAt).slice(0,30);}
  receipt(id:string):WorkReceipt|null{const file=this.file(id);if(!fs.existsSync(file))return null;const r=this.read(path.basename(file));if(!r)throw Error('WORKSTATION_JOURNAL_CORRUPT_NO_REPLAY');return r;}
  async stop(id:string){this.active.get(id)?.abort();this.connected.cancel(id);await cancelOwnedRun(id);}
  async dispose(){await Promise.all([...this.active.keys()].map(id=>this.stop(id)));}
  private gate(id:string){this.authority.gate(id);if(this.authority.accessMode()!=='FULL')throw Error('WORKSTATION_FULL_REQUIRED');if(this.active.get(id)?.signal.aborted)throw Error('WORKSTATION_STOPPED');}
  private async command(id:string,file:string,args:string[],cwd:string,timeoutMs:number,log:string){
    this.gate(id);const proc=withProcessScope(id,this.active.get(id)!.signal,()=>spawnWindowsJob({file,args,cwd,env:{...process.env,TEMP:path.join(ROOT,'temp'),TMP:path.join(ROOT,'temp'),PYTHONPYCACHEPREFIX:path.join(ROOT,'pycache'),HF_HOME:path.join(ROOT,'cache'),PYTHONUTF8:'1'}}),()=>this.gate(id));
    let output='',bytes=0;const append=(chunk:string)=>{bytes+=Buffer.byteLength(chunk);if(bytes<1024*1024){output+=chunk;fs.appendFileSync(log,chunk);}};proc.onStdout(append);proc.onStderr(append);
    const exit=new Promise<number|null>(resolve=>proc.onExit(code=>resolve(code)));let timedOut=false;
    const timer=setTimeout(()=>{timedOut=true;void proc.killTree();},timeoutMs);
    try{await proc.ready;const code=await exit;this.gate(id);if(timedOut)throw Error('WORKER_TIMEOUT');if(code!==0)throw Error('WORKER_EXIT_'+code);return output;}finally{clearTimeout(timer);await proc.killTree();}
  }
  private async document(id:string,job:string,request:Record<string,unknown>){
    const key=sha(JSON.stringify(request)).slice(0,16),result=path.join(job,key+'-result.json'),input=path.join(job,key+'-request.json');
    fs.writeFileSync(input,JSON.stringify({...request,result}),{flag:'wx'});
    try{await this.command(id,this.node,[this.worker,input],job,45000,path.join(job,'document-worker.log'));}catch(error){if(fs.existsSync(result)){const failed=JSON.parse(fs.readFileSync(result,'utf8'));if(!failed.ok&&typeof failed.error==='string')throw Error('DOCUMENT_WORKER_FAILED:'+safeContextText(failed.error).slice(0,300));}throw error;}
    const value=JSON.parse(fs.readFileSync(result,'utf8'));if(!value.ok)throw Error(value.error);return value.result;
  }
  private asset(name:string):string{
    const manifest=JSON.parse(fs.readFileSync(path.join(ROOT,'runtime.json'),'utf8')),entry=manifest.assets[name];
    if(!entry||typeof entry.path!=='string')throw Error('MEDIA_ASSET_NOT_CONFIGURED_'+name);
    const candidate=path.resolve(ROOT,entry.path),file=fs.realpathSync(candidate);if(!file.toLowerCase().startsWith(ROOT.toLowerCase()+path.sep)||sha(fs.readFileSync(file))!==entry.sha256)throw Error('MEDIA_ASSET_INTEGRITY_FAILED_'+name);return file;
  }
  capabilities(){let assets:Record<string,unknown>={};try{assets=JSON.parse(fs.readFileSync(path.join(ROOT,'runtime.json'),'utf8')).assets;}catch{}
    return [{id:'documents',capabilities:['find','read-docx','read-pdf-text','create-word'],state:'IMPLEMENTED',verification:'Per-task source/hash and Word text roundtrip'},
      {id:'ollama-local',capabilities:['understand','draft'],state:'DETECTED',verification:'Source references checked; meaning remains a model proposal'},
      {id:'piper-local',capabilities:['audio'],state:assets.voice&&assets.python?'DETECTED':'BLOCKED',verification:'Needs a real task; no cloud calls'},
      {id:'stable-diffusion-local',capabilities:['image'],state:assets.sd&&assets.imageModel?'DETECTED':'BLOCKED',verification:'Needs a real task; Vulkan device discovery is not inference'},
      {id:'ffmpeg-local',capabilities:['narrated-video'],state:assets.ffmpeg&&assets.ffprobe?'DETECTED':'BLOCKED',verification:'Image/audio composition; neural motion generation is not installed'}];
  }
  private async artifact(id:string,kind:WorkArtifact['kind'],file:string,verification:string,metadata?:Record<string,unknown>):Promise<WorkArtifact>{this.gate(id);const data=fs.readFileSync(file);if(!data.length)throw Error('ARTIFACT_EMPTY');return {kind,path:file,bytes:data.length,sha256:sha(data),verification,metadata};}
  private selected(source:DocumentSource,prompt:string,budget:number):DocumentSource{
    const tokens=prompt.toLowerCase().match(/[\p{L}\p{N}]{4,}/gu)??[];
    const ranked=source.lines.map((l,index)=>({l,index,rank:tokens.reduce((n,t)=>n+(l.text.toLowerCase().includes(t)?1:0),0)})).sort((a,b)=>b.rank-a.rank||a.index-b.index);
    let used=0;const selected:SourceLine[]=[];for(const {l,index}of ranked){if(used+l.text.length>budget||selected.length>=70)continue;selected.push({...l,id:source.id+'L'+(index+1)});used+=l.text.length;}
    selected.sort((a,b)=>Number(a.id.split('L')[1])-Number(b.id.split('L')[1]));return {...source,lines:selected,truncated:source.truncated||selected.length<source.lines.length};
  }
  async run(id:string,prompt:string):Promise<WorkReceipt>{
    this.authority.gate(id);const admission=this.authority.run(id)!,plan=workPlan(prompt);
    if(!plan||admission.source!=='USER_INPUT_GESTURE'||admission.originalHash!==sha(prompt.trim())||id.length>160)throw Error('WORKSTATION_ORIGINAL_INVALID');
    if(this.receipt(id))throw Error('WORKSTATION_ALREADY_USED');if(this.active.size)throw Error('WORKSTATION_BUSY');
    this.active.set(id,new AbortController());
    plan.mediaText=safeContextText(plan.mediaText);const r:WorkReceipt={version:1,id,originalHash:admission.originalHash,prompt:safeContextText(prompt),plan,state:'STARTED',createdAt:Date.now(),updatedAt:Date.now(),steps:[],sources:[],matches:[],searches:[],artifacts:[],answer:'',paidApiCalls:0};this.persist(r);
    const job=path.join(this.directory,'artifacts',sha(id).slice(0,24));fs.mkdirSync(job,{recursive:true});fs.mkdirSync(path.join(ROOT,'temp'),{recursive:true});
    const step=async(kind:WorkKind,executor:string,fn:()=>Promise<{state:WorkState;detail:string}>)=>{const item={kind,state:'STARTED' as WorkState,executor,detail:'',at:Date.now()};r.steps.push(item);this.persist(r);try{this.gate(id);Object.assign(item,await fn());}catch(error){item.state=this.active.get(id)?.signal.aborted||this.authority.run(id)?.stopped?'STOPPED':'BLOCKED';item.detail=String(error);r.error=item.detail;}this.persist(r);};
    try{
      let sources=[...plan.paths];
      if(plan.kinds.includes('FIND_DOCUMENTS'))await step('FIND_DOCUMENTS','jarvis.filesystem',async()=>{
        if(!plan.query)throw Error('SEARCH_NEEDS_QUOTED_DOCUMENT_NAME');
        const roots=plan.roots.length?plan.roots:[path.join(os.homedir(),'Documents'),path.join(os.homedir(),'Downloads'),path.join(os.homedir(),'Desktop'),'E:\\CODEX'];
        for(const root of roots.filter(fs.existsSync)){const found=await this.fs.search({query:plan.query,roots:[root],limit:12,maxDepth:12},this.active.get(id)!.signal);this.gate(id);r.searches.push({root,...this.fs.searchStatus()});for(const match of found.filter(f=>f.kind==='file'&&/\.(docx|pdf|txt|md|csv)$/i.test(f.path))){if(!r.matches.some(m=>m.path===match.path))r.matches.push({path:match.path,name:match.name});}}
        if(!r.matches.length)throw Error('DOCUMENT_NOT_FOUND_IN_SEARCHED_SCOPE');sources=[...new Set([...sources,...r.matches.slice(0,4).map(m=>m.path)])];return {state:'VERIFIED',detail:r.matches.length+' archivos encontrados; cobertura y límites en searches'};
      });
      if((plan.kinds.includes('READ_DOCUMENTS')||plan.kinds.includes('UNDERSTAND')||plan.kinds.includes('CREATE_WORD'))&&sources.length)await step('READ_DOCUMENTS','jarvis.document-worker',async()=>{
        const failures=[];for(const source of sources.slice(0,4)){try{const canonical=this.fs.documentPath(source),value=await this.document(id,job,{kind:'read',source:canonical});this.gate(id);r.sources.push(this.selected({id:'S'+(r.sources.length+1),...value},prompt,Math.floor(8500/sources.length)));}catch(error){failures.push({path:source,error:String(error)});}}
        if(failures.length)fs.writeFileSync(path.join(job,'read-failures.json'),JSON.stringify(failures));if(!r.sources.length)throw Error('NO_DOCUMENT_COULD_BE_READ:'+failures.map(f=>f.error).join('; '));return {state:failures.length?'PARTIAL':'VERIFIED',detail:r.sources.length+' documentos leídos, '+failures.length+' fallos; texto limitado, sin OCR'+(failures.length?'; '+failures.map(f=>f.error).join('; '):'')};
      });
      if(plan.kinds.includes('UNDERSTAND')||plan.kinds.includes('CREATE_WORD'))await step('UNDERSTAND','ollama-local',async()=>{
        if(sources.length&&!r.sources.length)throw Error('UNDERSTANDING_NEEDS_READABLE_SOURCE');
        const annotations=annotateSources(r.sources),instruction=documentReasoningPrompt(prompt,r.sources);
        if(instruction.length>15500)throw Error('DOCUMENT_CONTEXT_BUDGET_EXCEEDED');
        let repair='';for(const attempt of [0,1] as const){const result=await this.connected.analyzeDocuments(id,prompt,instruction+repair,attempt);this.gate(id);if(!result.ok||!result.text)throw Error('DOCUMENT_ANALYSIS_PROVIDER_FAILED');
          r.inference={operationId:result.operationId,providerId:result.providerId!,model:result.model??null,raw:result.text};
          let candidate:unknown=null;try{const parsed=JSON.parse(result.text.trim().replace(/^```(?:json)?\s*\n([\s\S]*?)\n```$/,'$1'));if(parsed&&Object.keys(parsed).join(',')==='answer')candidate={...parsed,...annotations};}catch{}
          const checked=checkAnalysis(JSON.stringify(candidate),r.sources,prompt);(r.inferenceAttempts??=[]).push({operationId:result.operationId,raw:result.text,errors:checked.errors});
          r.analysisVerification={state:checked.value?'VERIFIED':'FAILED',scope:'JSON bounds, exact source references, explicit debe/falta markers and requested numeric coverage in selected text only; general factual completeness and reasoning are not certified',errors:checked.errors};this.persist(r);
          if(checked.value){r.analysis=checked.value;return {state:'PRODUCED',detail:'Interpretación local propuesta; referencias y criterios acotados contrastados. Inferencias: '+(attempt+1)};}
          repair='\nTu respuesta anterior fue: '+result.text+'\nCorrige esa respuesta una sola vez conservando lo correcto. El verificador rechazó: '+checked.errors.join('; ')+'. Devuelve sólo {"answer":"síntesis en prosa"}. Incluye los datos que faltaron, sin inventar.';
        }throw Error(r.analysisVerification!.errors.join(','));
      });
      const lookup=(ids:string[])=>ids.map(id=>{for(const source of r.sources){const line=source.lines.find(l=>l.id===id);if(line)return '['+id+'] '+line.text;}throw Error('SOURCE_REFERENCE_MISSING');});
      if(plan.kinds.includes('CREATE_WORD'))await step('CREATE_WORD','jarvis.docx',async()=>{
        if(!r.analysis)throw Error('WORD_NEEDS_VALIDATED_ANALYSIS');this.unchanged(r.sources);const content={title:'Informe de documentos',sections:[{heading:'Síntesis propuesta',paragraphs:[r.analysis.answer]},
          ...(r.sources.length?[{heading:'Hechos citados',paragraphs:lookup(r.analysis.evidence)},{heading:'Acciones mencionadas en las fuentes',paragraphs:lookup(r.analysis.actions)},{heading:'Menciones textuales de datos pendientes',paragraphs:['Estas citas pueden corresponder a una propuesta anterior; no certifican por sí solas qué sigue pendiente.',...lookup(r.analysis.unknowns)]},
          {heading:'Fuentes',paragraphs:r.sources.map(s=>s.id+' '+s.path+'\nSHA256 '+s.sha256+(s.truncated?'\nLectura parcial':'\nTexto extraído completo dentro de límites'))}]:[])]};
        const file=path.join(job,'informe.docx'),value=await this.document(id,job,{kind:'word',output:file,content});r.artifacts.push(await this.artifact(id,'WORD',file,value.verification,{paragraphs:value.paragraphs}));return {state:'VERIFIED',detail:'Word creado y reabierto; texto contrastado, revisión visual separada'};
      });
      const speech=(r.analysis?.answer??(r.sources.length?r.sources.flatMap(s=>s.lines.map(l=>l.text)).join('\n'):plan.mediaText)).slice(0,2500);
      if(plan.kinds.includes('CREATE_AUDIO'))await step('CREATE_AUDIO','piper-local',async()=>{
        this.unchanged(r.sources);const config=this.asset('voiceConfig'),file=path.join(job,'narracion.wav'),input=path.join(job,'narracion.txt');fs.writeFileSync(input,speech);await this.command(id,this.asset('python'),[path.join(path.dirname(this.worker),'audio-worker.py'),this.asset('voice'),config,input,file],job,120000,path.join(job,'audio.log'));
        const samples=pcmWavEvidence(fs.readFileSync(file));
        r.artifacts.push(await this.artifact(id,'AUDIO',file,'PCM16_NON_SILENT_AND_DECODE_VERIFIED',{...await this.probe(id,job,file),...samples}));return {state:'VERIFIED',detail:'Voz neural local Piper; PCM no silencioso y WAV decodificado, pronunciación no certificada'};
      });
      if(plan.kinds.includes('CREATE_IMAGE'))await step('CREATE_IMAGE','stable-diffusion-local',async()=>{
        (r.resourceEvents??=[]).push(await this.connected.releaseDocumentMemory(id,this.active.get(id)!.signal));this.persist(r);this.gate(id);
        const file=path.join(job,'imagen.png');await this.command(id,this.asset('sd'),['-m',this.asset('imageModel'),'-p',plan.mediaText.slice(0,1200),'-o',file,'-W','512','-H','512','--steps','12','--seed','42','--sampling-method','euler_a','--backend','diffusion=vulkan0,vae=cpu,clip=cpu','--threads','4'],job,600000,path.join(job,'image.log'));
        const data=fs.readFileSync(file);if(data.subarray(0,8).toString('hex')!=='89504e470d0a1a0a'||data.readUInt32BE(16)!==512||data.readUInt32BE(20)!==512)throw Error('IMAGE_PNG_INVALID');r.artifacts.push(await this.artifact(id,'IMAGE',file,'PNG_DIMENSIONS_VERIFIED_SEMANTIC_QUALITY_UNREVIEWED',{width:512,height:512,seed:42,steps:12,model:'SD1.5-Q4_0'}));return {state:'VERIFIED',detail:'Imagen inferida localmente con Stable Diffusion y Vulkan; calidad visual se revisa aparte'};
      });
      if(plan.kinds.includes('CREATE_VIDEO'))await step('CREATE_VIDEO','ffmpeg-local',async()=>{
        const image=r.artifacts.find(a=>a.kind==='IMAGE'),audio=r.artifacts.find(a=>a.kind==='AUDIO');if(!image)throw Error('VIDEO_NEEDS_IMAGE_REQUEST_OR_ASSET');
        const file=path.join(job,'video.mp4'),args=['-nostdin','-v','error','-loop','1','-i',image.path,...(audio?['-i',audio.path]:[]),'-t','6','-vf','scale=512:512,format=yuv420p','-r','24','-c:v','libx264','-pix_fmt','yuv420p',...(audio?['-c:a','aac','-shortest']:[]),'-movflags','+faststart','-n',file];
        await this.command(id,this.asset('ffmpeg'),args,job,90000,path.join(job,'video.log'));const probe=await this.probe(id,job,file);if(!probe.video)throw Error('VIDEO_STREAM_MISSING');r.artifacts.push(await this.artifact(id,'VIDEO',file,'MP4_DECODE_VERIFIED_COMPOSED_VIDEO',{...probe,mode:'AI_IMAGE_WITH_OPTIONAL_NEURAL_NARRATION_NOT_GENERATIVE_MOTION'}));return {state:'VERIFIED',detail:'MP4 compuesto de la imagen con narración si existe; duración máxima 6 s, sin movimiento generativo'};
      });
      const failed=r.steps.some(s=>['BLOCKED','FAILED','PARTIAL'].includes(s.state));r.state=this.authority.run(id)?.stopped?'STOPPED':failed?(r.steps.some(s=>['VERIFIED','PRODUCED'].includes(s.state))?'PARTIAL':'BLOCKED'):r.analysis?'PRODUCED':'VERIFIED';
      r.answer=[r.analysis?.answer??'',...(r.analysis?.actions.length?['Acciones explícitas citadas:\n'+lookup(r.analysis.actions).join('\n')]:[]),...(r.analysis?.unknowns.length?['Información pendiente citada:\n'+lookup(r.analysis.unknowns).join('\n')]:[]),...r.steps.map(s=>s.kind+': '+s.state+' · '+s.detail),...r.artifacts.map(a=>a.kind+': '+a.path),...r.matches.slice(0,8).map(m=>m.path)].filter(Boolean).join('\n\n');return r;
    }finally{if(r.state==='STARTED'){r.state=this.authority.run(id)?.stopped?'STOPPED':'FAILED';r.error??='Execution interrupted';}this.persist(r);this.active.delete(id);}
  }
  private unchanged(sources:DocumentSource[]){for(const source of sources){const file=this.fs.documentPath(source.path),stat=fs.statSync(file);if(stat.size!==source.bytes||sha(fs.readFileSync(file))!==source.sha256)throw Error('SOURCE_CHANGED_SINCE_READING');}}
  private async probe(id:string,job:string,file:string){const raw=await this.command(id,this.asset('ffprobe'),['-v','error','-show_streams','-show_format','-of','json',file],job,20000,path.join(job,'probe.log')),info=JSON.parse(raw),duration=Number(info.format?.duration);if(!Number.isFinite(duration)||duration<=0)throw Error('MEDIA_DURATION_INVALID');
    await this.command(id,this.asset('ffmpeg'),['-nostdin','-v','error','-i',file,'-f','null','-'],job,20000,path.join(job,'decode.log'));return {duration,audio:info.streams.some((s:{codec_type:string})=>s.codec_type==='audio'),video:info.streams.some((s:{codec_type:string})=>s.codec_type==='video')};}
}
