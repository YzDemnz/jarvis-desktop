import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {organizeWork,organizationRequest} from '../../electron/connected/WorkOrganization';
import {validateConciliusPlan} from '../../electron/connected/ConciliusCoordinator';
import {FabricDatabase} from '../../electron/fabric/FabricDatabase';
import {TaskContinuity,continuityHash} from '../../electron/connected/TaskContinuity';
import {dependencyContext} from '../../electron/connected/DependencyContext';
import {VerificationService,checkedContract} from '../../electron/connected/VerificationService';
import type {ProviderDescriptor} from '../../src/fabric/types';
let passed=0;const pass=(s:string)=>{passed++;console.log('PASS '+s);};
const provider=(id:string,model:string):ProviderDescriptor=>({id,label:id,kind:'LOCAL_MODEL',state:'AVAILABLE',privacyClass:'LOCAL',costClass:'LOCAL',quota:'UNKNOWN',quality:0,contextLimit:null,healthCheckedAt:null,capabilities:[{id:'chat',available:true,strength:1}],surface:{transport:'OLLAMA_HTTP',destination:'local:',auth:'NOT_REQUIRED',secretRef:null,models:[model],latencyMs:null,successfulRequests:0,lastFailure:null,verification:'DISCOVERED',rateLimits:null}});
const small=provider('ollama-local','smollm2:1.7b-instruct-q4_K_M'),expert=provider('bootstrap-local','qwen3-4b-gguf');
const request={kind:'tasks',text:'Compra pan. Llama a Ana.',review:false};
const a=organizeWork(request,[expert,small],[small.id,expert.id]);
assert.equal(a.plan.nodes.length,1);assert.equal(a.plan.nodes[0]!.providerId,'ollama-local');assert.equal(a.organization.classificationModelCalls,0);validateConciliusPlan(a.plan);
pass('Simple work chooses an enabled small local model with one planned inference and no model classification');
const b=organizeWork({...request,review:true},[expert,small],[small.id,expert.id]);validateConciliusPlan(b.plan);
assert.deepEqual(b.plan.nodes.map(n=>n.role),['producer','critic']);assert.equal(b.plan.nodes[1]!.providerId,'bootstrap-local');assert.match(b.plan.nodes[1]!.prompt,/Compra pan/);
pass('Requested review uses a second local surface and gets original input explicitly; critic remains advisory');
assert.throws(()=>organizeWork(request,[{...small,costClass:'PAID_API',privacyClass:'REMOTE'}],[small.id]),/NO_ENABLED_LOCAL/);
assert.throws(()=>organizeWork(request,[small],[]),/NO_ENABLED_LOCAL/);
assert.throws(()=>organizationRequest({...request,tools:['shell']}),/INVALID_REQUEST/);
pass('Absent local model, disabled model and injected authority cannot introduce a paid fallback or new plan fields');
const root=fs.mkdtempSync(path.join(os.tmpdir(),'jarvis-owned-economy-'));assert.match(root,/^E:\\CODEX\\/i);
const db=new FabricDatabase(path.join(root,'fabric.sqlite'));const continuity=new TaskContinuity(db,path.join(root,'artifacts'));
db.saveTask({taskId:'task',conversationId:'task',goal:'owned',currentTask:'new',instructions:[],findings:[],decisions:[],artifacts:[],openQuestions:[],pendingSteps:[],updatedAt:Date.now()});
continuity.begin('task','Root material '+ 'public '.repeat(220),small.id,'small','LOCAL_ONLY');
continuity.finish('task','SUCCESS','{"items":["pan","Ana"]}',small.id,'small');
const verified=new VerificationService(db).verify('task',{kind:'JSON_SHAPE',fields:{items:'array'}},0,0,()=>{});
const cp=continuity.checkpoint('task')!;
const next=continuity.begin('task-2','Produce from selected dependency',expert.id,'expert','LOCAL_ONLY',{taskId:'task',revision:cp.revision},'INFERENCE',['task']);
assert.equal(next.handoffHash,continuityHash(next.handoff));assert.ok(next.contextUsage!.avoidedChars>0);assert.equal(JSON.parse(next.handoff.slice(next.handoff.indexOf("\n")+1)).dependencies[0].result,'{"items":["pan","Ana"]}');assert.ok(!next.handoff.includes('public public'));
pass('Actual SQLite operation transmits only the selected dependency and records exact character reduction against its own legacy packet');
const dependency=JSON.parse(next.handoff.slice(next.handoff.indexOf('\n')+1)).dependencies[0];
assert.equal(dependency.verification.id,verified.id);assert.equal(dependency.verification.state,'VERIFIED');assert.equal(dependency.verification.subjectHash,continuityHash(dependency.result));
pass('Dependency handoff resolves the current receipt from its separate main journal and binds the exact result');
continuity.finish('task-2','SUCCESS','output á😀',expert.id,'expert');
const ops=continuity.checkpoint('task')!.operations;
const projected=dependencyContext('task',2,ops,['task-2'],'x'.repeat(5000));
assert.match(projected.text,/output á😀/);assert.ok(!projected.text.includes('pan'));assert.equal(projected.usage.omittedOperations,1);
assert.throws(()=>dependencyContext('other',2,ops,['task-2'],''),/FOREIGN/);
assert.throws(()=>dependencyContext('task',2,ops,['task-2','task-2'],''),/INVALID_SCOPE/);
assert.throws(()=>dependencyContext('task',2,[{...ops[1]!,text:'a'.repeat(8000)}],['task-2'],''),/TOO_LARGE/);
pass('Dependency projection preserves full Unicode output, excludes unrelated output and refuses foreign, duplicate and oversized context');
db.writeVerificationRecord({...verified,id:'expired-owned-receipt',expiresAt:Date.now()-1});
const expired=continuity.begin('task-3','Inspect an expired dependency',expert.id,'expert','LOCAL_ONLY',{taskId:'task',revision:continuity.checkpoint('task')!.revision},'INFERENCE',['task']);
assert.equal(JSON.parse(expired.handoff.slice(expired.handoff.indexOf('\n')+1)).dependencies[0].verification.state,'REVIEW_REQUIRED');
continuity.finish('task-3','SUCCESS','expired proof retained as data',expert.id,'expert');
pass('Expired dependency proof is projected REVIEW_REQUIRED instead of presenting historical verification as current');
const listVerifier=new VerificationService(db),listContract={kind:'JSON_STRING_LIST' as const,field:'tasks'};
checkedContract(listContract);assert.throws(()=>checkedContract({...listContract,field:'constructor'}));
assert.throws(()=>checkedContract({...listContract,command:'execute'}));
for(const [index,text,expected] of [
  [0,'{"tasks":["Compra pan","Llama a Ana"]}','VERIFIED'],[1,'{"tasks":[{"name":"compra_pan"}]}','FAILED'],
  [2,'{"tasks":[""]}','FAILED'],[3,'{"tasks":[]}','VERIFIED'],[4,JSON.stringify({tasks:Array(101).fill('x')}),'FAILED'],
  [5,'not JSON','FAILED'],[6,JSON.stringify({tasks:['x'.repeat(2001)]}),'FAILED'],[7,'{"tasks":[null]}','FAILED']
] as const){
  const id='list-'+index;db.writeOperationRecord(id,'owned-list',{operationId:id,taskId:'owned-list',kind:'INFERENCE',status:'SUCCESS',text});
  assert.equal(listVerifier.verify(id,listContract,0,0,()=>{}).state,expected);
}
pass('Real string-list verifier rejects observed object output, blanks, nulls, invalid JSON and excessive items without declaring semantic truth');
db.close();const reopened=new FabricDatabase(path.join(root,'fabric.sqlite'));assert.deepEqual((reopened.operationRecord('task-2') as any).contextUsage,next.contextUsage);reopened.close();
pass('Main context measurements survive SQLite restart without an inference cache or replay');
console.log('WORK_ORGANIZATION_PASS '+passed);
