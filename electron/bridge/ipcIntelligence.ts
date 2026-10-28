import {app,BrowserWindow,ipcMain} from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
import {authority,authorityHandle,onAuthorityStop} from '../authority';
import {fabricDatabase} from '../fabric/ipcFabric';
import {connectedService} from '../connected/ipcConnected';
import {codexBridgeSnapshot} from '../bootstrap/ipcBootstrap';
import {boundedJson} from '../connected/HttpProvider';
import {LocalModelManager,OPEN_MODELS} from './LocalModelManager';
import {BridgeJournal} from './BridgeJournal';
import {McpBridge} from './McpBridge';
import {LocalMcpHost} from './LocalMcpHost';

let models:LocalModelManager|null=null,bridge:McpBridge|null=null,journal:BridgeJournal|null=null;
let capture:{action:string;at:number}|null=null,unsubscribe:(()=>void)|null=null,operation='';
let localHost:LocalMcpHost|null=null;
export function intelligenceSnapshot(){return {models:models?.snapshot()??[],economyModel:connectedService().policy.snapshot().economyModel??null,mcpModel:connectedService().policy.snapshot().mcpModel??null,
  documentModel:connectedService().policy.snapshot().documentModel??null,
  bridge:bridge?.snapshot()??null,jobs:journal?.list().slice(-50).reverse()??[],localHost:localHost?.snapshot()??null,codex:codexBridgeSnapshot(),operation:operation||null};}
export function registerIntelligenceIpc(owner:BrowserWindow){
  const directory=path.join(app.getPath('userData'),'intelligence-connections'),dependencies=path.dirname(process.env.JARVIS_RUNTIME_ROOT??'E:\\CODEX\\Aplicaciones\\JARVIS\\Dependencias\\Runtimes');
  const node=path.join(dependencies,'Herramientas','node-v24.21.0-win-x64','node.exe');
  const modelStore=process.env.OLLAMA_MODELS??'E:\\CODEX\\Aplicaciones\\Judicial Managment Suite\\ollama-models';
  models=new LocalModelManager(path.join(directory,'models'),modelStore,process.env.OLLAMA_HOST??'http://127.0.0.1:11434');
  journal=new BridgeJournal(fabricDatabase(),authority,connectedService().continuity,()=>connectedService().policy.snapshot().dataClass==='GENERIC');
  bridge=new McpBridge(path.join(directory,'mcp'),journal,node,app.isPackaged?path.join(process.resourcesPath,'bridge','jarvis-mcp.cjs'):path.join(app.getAppPath(),'dist-bridge','jarvis-mcp.cjs'));
  localHost=new LocalMcpHost(path.join(directory,'local-host'),path.join(dependencies,'Herramientas','Claude','claude.exe'),process.env.OLLAMA_HOST??'http://127.0.0.1:11434',bridge,journal);
  if(fs.existsSync(path.join(directory,'mcp','enabled.json')))void bridge.start().catch(()=>{});
  unsubscribe=onAuthorityStop(id=>{journal?.stop(id);if(operation===id)models?.cancel();return localHost?.stop(id);});
  ipcMain.on('intelligence:capture',(event,action:unknown)=>{if(event.sender===owner.webContents&&event.senderFrame===owner.webContents.mainFrame&&typeof action==='string'&&action.length<100)capture={action,at:Date.now()};});
  authorityHandle('intelligence:snapshot',()=>intelligenceSnapshot());
  authorityHandle('intelligence:config',()=>bridge!.config());
  authorityHandle('intelligence:queue',async(_event,id:unknown,prompt:unknown)=>{
    if(typeof id!=='string'||typeof prompt!=='string'||prompt.length>6000)throw Error('MCP_TASK_INVALID');
    authority.gate(id);await bridge!.start();authority.gate(id);return journal!.create(id,prompt);
  });
  authorityHandle('intelligence:action',async(_event,action:unknown)=>{
    const c=capture;capture=null;
    if(typeof action!=='string'||!c||c.action!==action||Date.now()-c.at>30000)throw Error('INTELLIGENCE_GESTURE_REQUIRED');
    if(action==='cancel'){models!.cancel();return intelligenceSnapshot();}
    if(action.startsWith('run-local:')){
      const taskId=action.slice(10),policy=connectedService().policy.snapshot(),model=policy.mcpModel??policy.economyModel;
      if(!model||!models!.verifiedModel(model))throw Error('MODEL_DAILY_VERIFIED_REQUIRED');
      authority.gate(taskId);await localHost!.run(taskId,model);return intelligenceSnapshot();
    }
    if(operation)throw Error('INTELLIGENCE_OPERATION_BUSY');
    const [verb,id]=action.split(':'),candidate=OPEN_MODELS.find(m=>m.id===id);
    if(action!=='prepare-mcp'&&(!candidate||!['install','probe','daily','mcp','documents'].includes(verb??'')))throw Error('INTELLIGENCE_ACTION_INVALID');
    if(verb==='install'&&authority.accessMode()!=='FULL')throw Error('MODEL_INSTALL_FULL_REQUIRED');
    const run='intelligence-'+randomUUID();authority.admit(run,createHash('sha256').update(action).digest('hex'),action,'USER_UI_GESTURE');operation=run;
    try{
      authority.gate(run);
      if(action==='prepare-mcp')await bridge!.start();
      else if(verb==='install')await models!.install(id!);
      else if(verb==='probe')await models!.probe(id!);
      else if(verb==='daily'||verb==='mcp'||verb==='documents'){
        if(!models!.verifiedModel(candidate!.model))throw Error('MODEL_PROBE_REQUIRED');
        await connectedService().refresh();authority.gate(run);
        const p=connectedService().snapshot().providers.find(p=>p.id==='ollama-local');
        if(!p?.surface?.models.includes(candidate!.model))throw Error('MODEL_NOT_DISCOVERED');
        if(verb==='mcp'){const info=await boundedJson((process.env.OLLAMA_HOST??'http://127.0.0.1:11434')+'/api/show',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({model:candidate!.model})});authority.gate(run);if(!info.capabilities?.includes('tools')||info.remote_host||info.remote_model)throw Error('MODEL_LOCAL_TOOLS_REQUIRED');}
        const policy=connectedService().policy.snapshot();connectedService().policy.userChange({...(verb==='mcp'?{mcpModel:candidate!.model}:verb==='documents'?{documentModel:candidate!.model}:{economyModel:candidate!.model}),enabled:[...new Set([...policy.enabled,'ollama-local'])]});
      }
      authority.gate(run);return intelligenceSnapshot();
    }finally{authority.stop(run);operation='';}
  });
}
export function unregisterIntelligenceIpc(){
  ['intelligence:snapshot','intelligence:config','intelligence:queue','intelligence:action'].forEach(c=>ipcMain.removeHandler(c));ipcMain.removeAllListeners('intelligence:capture');
  unsubscribe?.();unsubscribe=null;models?.cancel();void localHost?.stop();void bridge?.stop();capture=null;models=null;bridge=null;journal=null;localHost=null;
}
