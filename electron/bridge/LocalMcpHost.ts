import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {NodeProcessPort} from '../dev/nodePorts';
import {spawnWindowsJob,withProcessScope} from '../process/WindowsJobProcess';
import {loopbackEndpoint} from '../connected/HttpProvider';
import {safeContextText} from '../../src/fabric/ContinuityState';
import type {SpawnedProcess} from '../../src/dev/ports';
import type {McpBridge} from './McpBridge';
import type {BridgeJournal} from './BridgeJournal';
const CLAUDE_SHA='0e4195524b73eb77efbdf3e2b36de5322a29f0ca575dfd2d9b4f946b1d425469';
export interface LocalHostReceipt{taskId:string;state:'RUNNING'|'PRODUCED'|'FAILED'|'STOPPED'|'INTERRUPTED';runtime:'Claude Code 2.1.280';intelligence:string;endpoint:string;code:number|null;at:number;elapsedMs:number;output:string;error:string;scope:string}
/** Official CLI harness with an explicitly local intelligence, not Claude cloud access. */
export class LocalMcpHost{
  private proc:SpawnedProcess|null=null;private last:LocalHostReceipt|null=null;private running=false;
  constructor(private directory:string,private executable:string,private endpoint:string,private bridge:McpBridge,private journal:BridgeJournal){
    this.endpoint=loopbackEndpoint(endpoint);fs.mkdirSync(directory,{recursive:true});
    try{this.last=JSON.parse(fs.readFileSync(path.join(directory,'last.json'),'utf8'));if(this.last?.state==='RUNNING'){this.last.state='INTERRUPTED';this.save();}}catch{}
  }
  snapshot(){return {detected:fs.existsSync(this.executable),last:this.last};}
  private save(){if(!this.last)return;fs.writeFileSync(path.join(this.directory,'last.json'),JSON.stringify(this.last,null,2));}
  async run(taskId:string,model:string){
    if(this.running)throw Error('MCP_LOCAL_HOST_BUSY');this.running=true;
    try{return await this.execute(taskId,model);}finally{this.running=false;}
  }
  private async execute(taskId:string,model:string){
    this.journal.forHost(taskId);
    if(createHash('sha256').update(fs.readFileSync(this.executable)).digest('hex')!==CLAUDE_SHA)throw Error('MCP_CLAUDE_RUNTIME_CHANGED');
    await this.bridge.start();this.journal.forHost(taskId);
    const home=path.join(this.directory,taskId);fs.mkdirSync(home,{recursive:true});
    const config=path.join(home,'mcp.json');fs.writeFileSync(config,JSON.stringify(this.bridge.config(taskId)));
    const env={...new NodeProcessPort().baseEnv(),HOME:home,USERPROFILE:home,APPDATA:home,LOCALAPPDATA:home,CLAUDE_CONFIG_DIR:home,
      ANTHROPIC_BASE_URL:this.endpoint,ANTHROPIC_API_KEY:'ollama',ANTHROPIC_AUTH_TOKEN:'ollama',ANTHROPIC_DEFAULT_HAIKU_MODEL:model,ANTHROPIC_DEFAULT_SONNET_MODEL:model,ANTHROPIC_DEFAULT_OPUS_MODEL:model,
      CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC:'1',DISABLE_AUTOUPDATER:'1',API_TIMEOUT_MS:'175000',CLAUDE_CODE_MAX_OUTPUT_TOKENS:'1024',CLAUDE_CODE_MAX_RETRIES:'0',CLAUDE_CODE_MAX_CONTEXT_TOKENS:'8192'};
    const args=['--bare','-p',`Read JARVIS task ${taskId} using jarvis_read_task, reason about its material, then submit a concise Spanish answer with jarvis_submit_result. The task ID is ${taskId}. You must submit the answer through the MCP tool.`,
      '--model',model,'--tools','','--strict-mcp-config','--mcp-config',config,'--allowedTools','mcp__jarvis__jarvis_read_task,mcp__jarvis__jarvis_submit_result,mcp__jarvis__jarvis_list_tasks',
      '--permission-mode','dontAsk','--permission-prompts','none','--no-session-persistence','--setting-sources','','--output-format','json','--max-turns','4',
      '--system-prompt','You are a local JARVIS specialist. Only read the assigned task and submit a public proposal with the JARVIS MCP tools. Never claim to have executed actions. Do not access other files or services.'];
    const started=Date.now();this.last={taskId,state:'RUNNING',runtime:'Claude Code 2.1.280',intelligence:model,endpoint:this.endpoint,code:null,at:started,elapsedMs:0,output:'',error:'',scope:'Local Ollama inference through official CLI harness; not Anthropic Claude inference; MCP proposal remains UNVERIFIED'};this.save();
    const proc=withProcessScope(taskId,undefined,()=>spawnWindowsJob({file:this.executable,args,cwd:home,env}));this.proc=proc;
    let timer:ReturnType<typeof setTimeout>|undefined;
    try{
      const code=await new Promise<number|null>((resolve,reject)=>{
        proc.onStdout(text=>{if(this.last?.taskId===taskId)this.last.output=safeContextText((this.last.output+text).slice(0,32000));});
        proc.onStderr(text=>{if(this.last?.taskId===taskId)this.last.error=safeContextText((this.last.error+text).slice(0,3000));});
        proc.onExit(code=>resolve(code));proc.ready?.catch(reject);
        timer=setTimeout(()=>{void proc.killTree().finally(()=>resolve(null));},240000);
      });
      if(this.last.state==='RUNNING'){this.last.code=code;this.last.state=this.journal.read(taskId).state==='PRODUCED'?'PRODUCED':'FAILED';}
      return this.last;
    }catch(error){if(this.last.state==='RUNNING')this.last.state='FAILED';this.last.error=safeContextText(String(error)).slice(0,3000);throw error;}
    finally{if(timer)clearTimeout(timer);this.last.elapsedMs=Date.now()-started;this.save();await proc.killTree();if(this.proc===proc)this.proc=null;}
  }
  async stop(id?:string){if(this.proc&&(!id||this.last?.taskId===id)){if(this.last)this.last.state='STOPPED';this.save();await this.proc.killTree();}}
}
