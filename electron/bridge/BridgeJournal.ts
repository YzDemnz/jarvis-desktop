import {createHash} from 'node:crypto';
import type {FabricDatabase} from '../fabric/FabricDatabase';
import type {AuthorityState} from '../../src/authority/AuthorityState';
import type {TaskContinuity} from '../connected/TaskContinuity';
import {safeContextText} from '../../src/fabric/ContinuityState';
export interface BridgeTask {kind:'MCP_EXCHANGE';id:string;prompt:string;inputHash:string;state:'WAITING_HOST'|'PRODUCED'|'STOPPED'|'INTERRUPTED';text:string|null;responseHash:string|null;host:string|null;createdAt:number;updatedAt:number;verification:'UNVERIFIED'}
export class BridgeJournal {
  constructor(private db:FabricDatabase,private authority:AuthorityState,private continuity:TaskContinuity,private canExchange=()=>true){
    for(const task of this.list())if(task.state==='WAITING_HOST'){task.state='INTERRUPTED';task.updatedAt=Date.now();this.save(task);this.continuity.finish(task.id,'INTERRUPTED',null,'external-mcp',null);}
  }
  private save(task:BridgeTask){this.db.writeOperationRecord('mcp-state:'+task.id,task.id,task);}
  list():BridgeTask[]{return this.db.operationRecords().filter((t:any)=>t?.kind==='MCP_EXCHANGE') as BridgeTask[];}
  read(id:string){const task=this.db.operationRecord('mcp-state:'+id) as BridgeTask|null;if(!task||task.kind!=='MCP_EXCHANGE')throw Error('MCP_TASK_NOT_FOUND');return task;}
  create(id:string,prompt:string){
    if(!this.canExchange())throw Error('MCP_DATA_POLICY_REQUIRES_GENERIC');
    this.authority.gate(id);const inputHash=createHash('sha256').update(prompt).digest('hex'),run=this.authority.run(id)!;
    if(run.originalHash!==inputHash||run.source!=='USER_INPUT_GESTURE'||!prompt.trim()||prompt.length>6000)throw Error('MCP_TASK_ORIGINAL_MISMATCH');
    if(this.db.task(id)||this.list().filter(t=>t.state==='WAITING_HOST').length>=20)throw Error('MCP_TASK_DUPLICATE_OR_LIMIT');
    const now=Date.now(),text=safeContextText(prompt);this.db.saveTask({taskId:id,conversationId:id,goal:text,currentTask:'Awaiting external MCP host',instructions:[],findings:[],decisions:[],artifacts:[],openQuestions:[],pendingSteps:['Await external host proposal; no automatic effects'],updatedAt:now});
    this.continuity.begin(id,prompt,'external-mcp',null,'GENERIC');
    const task:BridgeTask={kind:'MCP_EXCHANGE',id,prompt:text,inputHash,state:'WAITING_HOST',text:null,responseHash:null,host:null,createdAt:now,updatedAt:now,verification:'UNVERIFIED'};this.save(task);return task;
  }
  forHost(id:string){if(!this.canExchange())throw Error('MCP_DATA_POLICY_REQUIRES_GENERIC');const task=this.read(id);if(task.state!=='WAITING_HOST')throw Error('MCP_TASK_NOT_WAITING');this.authority.gate(id);return task;}
  submit(id:string,inputHash:string,text:string,host:string){
    if(!this.canExchange())throw Error('MCP_DATA_POLICY_REQUIRES_GENERIC');
    const task=this.read(id);if(typeof text!=='string'||!text.trim()||text.length>12000||inputHash!==task.inputHash)throw Error('MCP_RESULT_INVALID_OR_STALE');
    const safe=safeContextText(text),responseHash=createHash('sha256').update(safe).digest('hex');
    if(task.state==='PRODUCED'){if(task.responseHash!==responseHash)throw Error('MCP_RESULT_ALREADY_SETTLED');return {task,reused:true};}
    this.authority.gate(id);if(task.state!=='WAITING_HOST')throw Error('MCP_TASK_REVOKED');
    task.state='PRODUCED';task.text=safe;task.responseHash=responseHash;task.host=safeContextText(host).slice(0,100);task.updatedAt=Date.now();
    this.continuity.finish(id,'SUCCESS',safe,'external-mcp',null);this.save(task);return {task,reused:false};
  }
  stop(id:string){const task=this.list().find(t=>t.id===id);if(task?.state==='WAITING_HOST'){task.state='STOPPED';task.updatedAt=Date.now();this.continuity.finish(id,'STOPPED',null,'external-mcp',null);this.save(task);}}
}
