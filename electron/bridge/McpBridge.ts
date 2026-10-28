import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import {randomBytes,timingSafeEqual} from 'node:crypto';
import type {BridgeJournal} from './BridgeJournal';
export class McpBridge {
  private server:http.Server|null=null;private token='';private starting:Promise<void>|null=null;private epoch=0;
  peers=new Map<string,{name:string;at:number}>();
  constructor(readonly directory:string,private journal:BridgeJournal,readonly node:string,readonly script:string){fs.mkdirSync(directory,{recursive:true});}
  get connectionFile(){return path.join(this.directory,'connection.json');}
  get configFile(){return path.join(this.directory,'mcp-config.json');}
  snapshot(){return {state:this.server?'READY':'STOPPED',peers:[...this.peers.values()],configFile:this.configFile,connectionFile:this.connectionFile,scriptPresent:fs.existsSync(this.script),scope:'Selected task context and unverified proposals only; no provider-owned OS effects'};}
  start(){if(this.server)return Promise.resolve();if(this.starting)return this.starting;this.starting=this.open().finally(()=>this.starting=null);return this.starting;}
  private async open(){
    const epoch=this.epoch;
    if(!fs.existsSync(this.node)||!fs.existsSync(this.script))throw Error('MCP_PORTABLE_RUNTIME_MISSING');
    this.token=randomBytes(32).toString('hex');const server=http.createServer((req,res)=>{void this.handle(req,res);});
    server.requestTimeout=10000;server.headersTimeout=10000;
    await new Promise<void>((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',()=>resolve());});
    if(epoch!==this.epoch){server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));throw Error('MCP_START_CANCELLED');}this.server=server;
    const address=server.address();if(!address||typeof address==='string')throw Error('MCP_ADDRESS_INVALID');
    fs.writeFileSync(this.connectionFile,JSON.stringify({version:1,url:'http://127.0.0.1:'+address.port+'/bridge',token:this.token,pid:process.pid}),{mode:0o600});
    fs.writeFileSync(this.configFile,JSON.stringify(this.config(),null,2));
    fs.writeFileSync(path.join(this.directory,'enabled.json'),'true');
  }
  config(task?:string){return {mcpServers:{jarvis:{command:this.node,args:[this.script,'--connection',this.connectionFile,...(task?['--task',task]:[])]}}};}
  private async handle(req:http.IncomingMessage,res:http.ServerResponse){
    const reply=(code:number,value:unknown)=>{res.writeHead(code,{'content-type':'application/json','cache-control':'no-store'});res.end(JSON.stringify(value));};
    try{
      const token=String(req.headers['x-jarvis-bridge']??'');
      if(req.method!=='POST'||req.url!=='/bridge'||req.headers.origin||token.length!==this.token.length||!timingSafeEqual(Buffer.from(token),Buffer.from(this.token))){reply(403,{error:'MCP_BRIDGE_DENIED'});return;}
      const chunks:Buffer[]=[];let size=0;for await(const chunk of req){size+=chunk.length;if(size>48000)throw Error('MCP_BODY_TOO_LARGE');chunks.push(Buffer.from(chunk));}
      if(!this.server)throw Error('MCP_BRIDGE_STOPPED');
      const body=JSON.parse(Buffer.concat(chunks).toString()),args=body.args??{},client=body.client;
      if(!client||typeof client.name!=='string'||client.name.length>100||Object.keys(body).some(k=>!['method','args','client'].includes(k)))throw Error('MCP_REQUEST_INVALID');
      this.peers.set(client.name,{name:client.name,at:Date.now()});if(this.peers.size>20)this.peers.delete(this.peers.keys().next().value!);
      let result:unknown;
      if(body.method==='hello'&&Object.keys(args).length===0)result={name:'JARVIS',version:'0.4.4',tools:'CONTEXT_AND_PROPOSALS',inference:'HOST_OWNED'};
      else if(body.method==='list_jobs'&&Object.keys(args).length===0)result=this.journal.list().filter(t=>t.state==='WAITING_HOST').flatMap(t=>{try{this.journal.forHost(t.id);return [{id:t.id,state:t.state}];}catch{return [];}});
      else if(body.method==='read_job'&&Object.keys(args).every(k=>k==='id')&&typeof args.id==='string')result=this.journal.forHost(args.id);
      else if(body.method==='submit_result'&&Object.keys(args).every(k=>['id','inputHash','text'].includes(k))&&[args.id,args.inputHash,args.text].every(v=>typeof v==='string'))result=this.journal.submit(args.id,args.inputHash,args.text,client.name);
      else throw Error('MCP_METHOD_OR_ARGUMENTS_INVALID');reply(200,{result});
    }catch(error){reply(400,{error:/^(MCP_|AUTHORITY_)/.test((error as Error).message)?(error as Error).message:'MCP_REQUEST_FAILED'});}
  }
  async stop(){this.epoch++;const server=this.server;this.server=null;this.token='';if(server){server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));}await this.starting?.catch(()=>{});}
}
