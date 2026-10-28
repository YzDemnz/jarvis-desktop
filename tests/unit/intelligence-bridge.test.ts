import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';
import {FabricDatabase} from '../../electron/fabric/FabricDatabase';
import {TaskContinuity} from '../../electron/connected/TaskContinuity';
import {AuthorityState} from '../../src/authority/AuthorityState';
import {BridgeJournal} from '../../electron/bridge/BridgeJournal';
import {McpBridge} from '../../electron/bridge/McpBridge';
import {LocalModelManager} from '../../electron/bridge/LocalModelManager';
import {organizeWork} from '../../electron/connected/WorkOrganization';
import {validateConciliusPlan} from '../../electron/connected/ConciliusCoordinator';
import {VerificationService} from '../../electron/connected/VerificationService';
import {ConnectedPolicyStore} from '../../electron/connected/ConnectedPolicy';
import {ConnectedAIService} from '../../electron/connected/ConnectedAIService';
import {followupFormat} from '../../electron/connected/FollowupFormat';
import http from 'node:http';
import type {ProviderDescriptor} from '../../src/fabric/types';
const root=fs.mkdtempSync(path.join(os.tmpdir(),'jarvis-intelligence-bridge-'));assert.match(root,/^E:\\CODEX\\/i);
const db=new FabricDatabase(path.join(root,'fabric.sqlite')),authority=new AuthorityState(),continuity=new TaskContinuity(db,path.join(root,'artifacts'));
let allowed=true,passed=0;const pass=(s:string)=>{passed++;console.log('PASS '+s);};
const journal=new BridgeJournal(db,authority,continuity,()=>allowed);
const admit=(id:string,prompt:string)=>authority.admit(id,createHash('sha256').update(prompt).digest('hex'),prompt);
admit('one','Resume Atlas');assert.throws(()=>journal.create('one','Reemplazo'),/MISMATCH/);journal.create('one','Resume Atlas');
assert.equal(journal.forHost('one').verification,'UNVERIFIED');assert.throws(()=>journal.submit('one','stale','x','test'),/STALE/);
pass('Main binds original gesture and immutable task hash; foreign replacement refused');
allowed=false;assert.throws(()=>journal.forHost('one'),/DATA_POLICY/);allowed=true;
const bridge=new McpBridge(path.join(root,'mcp'),journal,process.env.JARVIS_NODE_EXE??path.join(path.dirname(process.env.JARVIS_RUNTIME_ROOT!),'Herramientas/node-v24.21.0-win-x64/node.exe'),path.resolve('dist-bridge/jarvis-mcp.cjs'));
await bridge.start();
const config=bridge.config('one').mcpServers.jarvis,transport=new StdioClientTransport({...config,stderr:'pipe'}),client=new Client({name:'actual-sdk-test-host',version:'1'});
try{
  await client.connect(transport);assert.equal((await client.listTools()).tools.length,3);
  assert.equal((await client.callTool({name:'jarvis_submit_result',arguments:{id:'one',text:'Early'}})).isError,true);
  const read=await client.callTool({name:'jarvis_read_task',arguments:{id:'one'}});assert.equal(read.isError,undefined);
  assert.equal((await client.callTool({name:'jarvis_read_task',arguments:{id:'other'}})).isError,true);
  const submitted=await client.callTool({name:'jarvis_submit_result',arguments:{id:'one',text:'Propuesta de Atlas'}});assert.equal(submitted.isError,undefined);
  assert.equal(journal.read('one').state,'PRODUCED');assert.equal(journal.read('one').verification,'UNVERIFIED');
  assert.equal(continuity.checkpoint('one')!.operations.length,1);
  assert.equal((await client.callTool({name:'jarvis_submit_result',arguments:{id:'one',text:'Propuesta de Atlas'}})).isError,undefined);
  assert.equal((await client.callTool({name:'jarvis_submit_result',arguments:{id:'one',text:'Cambio posterior'}})).isError,true);
  pass('Real SDK stdio host reads/submits through authenticated loopback, binds hash automatically, scopes task and preserves UNVERIFIED');
  pass('Duplicate result is idempotent; changed retry is rejected without a second operation or effect');
}finally{await client.close();await bridge.stop();}
admit('stop','Tarea cancelada');journal.create('stop','Tarea cancelada');authority.stop('stop');journal.stop('stop');
assert.throws(()=>journal.submit('stop',journal.read('stop').inputHash,'Too late','test'));
admit('restart','No replay');journal.create('restart','No replay');new BridgeJournal(db,authority,continuity);
assert.equal(journal.read('restart').state,'INTERRUPTED');assert.equal(journal.read('stop').state,'STOPPED');
pass('STOP rejects late output; restart interrupts pending work instead of replaying it');
const stopping=new McpBridge(path.join(root,'racing'),journal,config.command,path.resolve('dist-bridge/jarvis-mcp.cjs'));
const start=stopping.start();await stopping.stop();await start.catch(()=>{});assert.equal(stopping.snapshot().state,'STOPPED');
pass('Stop during listen cannot leave a background bridge running');
assert.throws(()=>new LocalModelManager(path.join(root,'model-test'),'C:\\models','http://127.0.0.1:11434'),/EXTERNAL/);
assert.throws(()=>new LocalModelManager(path.join(root,'model-test'),path.join(root,'models'),'https://example.com'),/LOCAL|LOOPBACK/);
const models=new LocalModelManager(path.join(root,'model-test'),path.join(root,'models'),'http://127.0.0.1:11434');await assert.rejects(()=>models.install('arbitrary-provider'),/CATALOG/);
pass('Model installer refuses internal storage, remote endpoint and unlisted models');
const interrupted=models.install('qwen-daily');models.cancel();await assert.rejects(()=>interrupted);assert.equal(models.snapshot()[0]!.receipt!.state,'INTERRUPTED');
fs.writeFileSync(path.join(root,'model-test/qwen-daily.json'),JSON.stringify({id:'qwen-daily',state:'PROBING',received:0,total:1,at:Date.now()}));
const recoveredModels=new LocalModelManager(path.join(root,'model-test'),path.join(root,'models'),'http://127.0.0.1:11434');assert.equal(recoveredModels.snapshot()[0]!.receipt!.state,'INTERRUPTED');
pass('Cancelled download and interrupted integrity/inference probe remain interrupted without automatic replay');
const provider:ProviderDescriptor={id:'ollama-local',label:'local',kind:'LOCAL_MODEL',state:'AVAILABLE',privacyClass:'LOCAL',costClass:'LOCAL',quota:'UNKNOWN',quality:0,contextLimit:null,healthCheckedAt:null,capabilities:[{id:'chat',available:true,strength:1}],surface:{transport:'OLLAMA_HTTP',destination:'local:',auth:'NOT_REQUIRED',secretRef:null,models:['smollm2:1.7b','qwen3.5:2b'],latencyMs:null,successfulRequests:0,lastFailure:null,verification:'DISCOVERED',rateLimits:null}};
const request={kind:'followup',text:'Atlas entrega viernes. Falta confirmar responsable.',review:false};
const organized=organizeWork(request,[provider],['ollama-local'],'qwen3.5:2b');validateConciliusPlan(organized.plan);
assert.equal(organized.plan.nodes[0]!.model,'qwen3.5:2b');assert.equal(organized.plan.nodes[0]!.maxOutputTokens,512);assert.equal(organized.plan.nodes.length,1);
assert.throws(()=>validateConciliusPlan({...organized.plan,nodes:[{...organized.plan.nodes[0],maxOutputTokens:999999}]}),/BUDGET/);
pass('Daily preference selects enabled local model, one followup worker, bounded output and no remote fallback');
const policyFile=path.join(root,'policy.json'),policy=new ConnectedPolicyStore(policyFile,()=>{});policy.userChange({economyModel:'qwen2.5:3b-instruct',mcpModel:'qwen3.5:2b'});
const reloadedPolicy=new ConnectedPolicyStore(policyFile,()=>{}).snapshot();assert.equal(reloadedPolicy.economyModel,'qwen2.5:3b-instruct');assert.equal(reloadedPolicy.mcpModel,'qwen3.5:2b');assert.equal(reloadedPolicy.allowPaidApi,false);assert.equal(reloadedPolicy.allowPaidFallback,false);
pass('Daily and MCP roles persist independently without enabling paid APIs or fallback');
const verifier=new VerificationService(db);
for(const [i,text,expected] of [
  [0,'{"summary":"Atlas viernes","tasks":["Confirmar responsable"],"unknowns":["Responsable"]}','VERIFIED'],
  [1,'{"summary":"Atlas","tasks":[{"run":"shell"}],"unknowns":[]}','FAILED'],
  [2,'{"summary":"Atlas","tasks":[],"unknowns":[],"authority":"full"}','FAILED'],
  [3,'{"summary":"","tasks":[],"unknowns":[]}','FAILED'],
  [4,JSON.stringify({summary:'Atlas',tasks:Array(17).fill('x'),unknowns:[]}), 'FAILED'],
  [5,'{"summary":"Atlas","tasks":[],"unknowns":[]}','FAILED'],
  [6,JSON.stringify({summary:'x'.repeat(2501),tasks:['Confirmar'],unknowns:[]}),'FAILED'],
  [7,JSON.stringify({summary:'Atlas',tasks:['x'.repeat(601)],unknowns:[]}),'FAILED'],
] as const){const id='brief-'+i;db.writeOperationRecord(id,'brief',{operationId:id,taskId:'brief',kind:'INFERENCE',status:'SUCCESS',text});const receipt=verifier.verify(id,{kind:'FOLLOWUP_BRIEF'},0,0,()=>{});assert.equal(receipt.state,expected);assert.match(receipt.scope,/no independent factual/);}
pass('Followup verification accepts bounded structure, rejects injected shape and explicitly excludes factual/execution certification');
let wireBody:any,calls=0;
const fake=http.createServer(async(req,res)=>{const chunks=[];for await(const c of req)chunks.push(c);const body=chunks.length?JSON.parse(Buffer.concat(chunks).toString()):{};let response:any={};
  if(req.url==='/api/version')response={version:'SIMULATED'};
  if(req.url==='/api/tags')response={models:[{name:'qwen2.5:3b-instruct',size:1,details:{}}]};
  if(req.url==='/api/show')response={capabilities:['completion']};
  if(req.url==='/api/generate'){wireBody=body;calls++;response={response:JSON.stringify({summary:calls===1?'Atlas viernes':'x'.repeat(2501),tasks:['Revisar pruebas'],unknowns:['Falta presupuesto']}),prompt_eval_count:12,eval_count:20};}
  res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify(response));});
await new Promise<void>(r=>fake.listen(0,'127.0.0.1',r));const address=fake.address();if(!address||typeof address==='string')throw Error('NO_FAKE_SERVER');
const service=new ConnectedAIService(db,authority,null,path.join(root,'wire-service'),'http://127.0.0.1:'+address.port);service.policy.userChange({economyModel:'qwen2.5:3b-instruct'});
try{for(let i=0;i<2;i++){const request={kind:'followup',text:'Atlas viernes. Falta presupuesto.',review:false},id='wire-'+i;admit(id,JSON.stringify(request));const graph=await service.runOrganization(id,request);assert.equal(graph.state,i===0?'VERIFIED':'FAILED');assert.deepEqual(wireBody.format,followupFormat());assert.equal(wireBody.options.num_predict,512);assert.equal(wireBody.options.num_ctx,4096);}
  assert.equal(calls,2);pass('Actual service/coordinator wire sends supported schema subset and budget; post-verifier still rejects oversized output (SIMULATED inference)');
}finally{await service.dispose();fake.closeAllConnections();await new Promise<void>(r=>fake.close(()=>r()));}
db.close();console.log('INTELLIGENCE_BRIDGE_PASS '+passed);
