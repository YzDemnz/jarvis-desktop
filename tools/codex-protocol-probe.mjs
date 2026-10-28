import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import {spawn} from 'node:child_process';
import WebSocket from 'ws';
const home=fs.mkdtempSync(path.join(os.tmpdir(),'jarvis-codex-protocol-'));
const port=await new Promise((resolve,reject)=>{const s=net.createServer();s.on('error',reject);s.listen(0,'127.0.0.1',()=>{const p=s.address().port;s.close(()=>resolve(p));});});
const env=Object.fromEntries(Object.entries(process.env).filter(([k])=>['PATH','SYSTEMROOT','WINDIR','TEMP','TMP','DOTNET_BUNDLE_EXTRACT_BASE_DIR'].includes(k.toUpperCase())));env.CODEX_HOME=home;env.HOME=home;env.USERPROFILE=home;
const args=['app-server','--listen',`ws://127.0.0.1:${port}`,'-c','cli_auth_credentials_store="keyring"','-c','features.shell_tool=false','-c','features.unified_exec=false','-c','features.web_search_request=false','-c','features.apps=false','-c','features.plugins=false'];
const proc=spawn(process.env.JARVIS_CODEX_EXE,args,{env,cwd:home,windowsHide:true,stdio:[process.env.JARVIS_CODEX_PROBE_STDIN==='ignore'?'ignore':'pipe','pipe','pipe']});let diagnostic='',exit=null,ws=null;
proc.stderr.on('data',b=>{diagnostic=(diagnostic+b.toString()).slice(0,8000);});proc.stdout.resume();proc.on('exit',code=>exit=code);
const started=Date.now();const report={home,exit:null,protocolVerified:false,accountStatus:'UNKNOWN',diagnostic:null};
try{
 while(Date.now()-started<120000&&exit===null){try{ws=await new Promise((resolve,reject)=>{const socket=new WebSocket(`ws://127.0.0.1:${port}`,{handshakeTimeout:1000});socket.once('open',()=>resolve(socket));socket.once('error',()=>{socket.close();reject(Error('CONNECT_FAILED'));});});break;}catch{await new Promise(r=>setTimeout(r,500));}}
 if(!ws)throw Error('NO_WEBSOCKET');
 const pending=new Map();ws.on('message',b=>{const e=JSON.parse(b.toString());if(e.method&&e.id!==undefined)ws.send(JSON.stringify({id:e.id,error:{code:-32601,message:'No tools admitted'}}));else if(pending.has(e.id)){pending.get(e.id)(e);pending.delete(e.id);}});
 const rpc=(id,method,params)=>new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('RPC_TIMEOUT')),15000);pending.set(id,e=>{clearTimeout(timer);resolve(e);});ws.send(JSON.stringify({id,method,params}));});
 const result=await rpc(1,'initialize',{clientInfo:{name:'jarvis-probe',version:'0.4.0'},capabilities:{experimentalApi:false}});if(result.error)throw Error('INITIALIZE_REJECTED');report.protocolVerified=true;ws.send(JSON.stringify({method:'initialized'}));const account=await rpc(2,'account/read',{refreshToken:false});report.accountStatus=account.error?'RPC_FAILED':account.result?.account?'ACCOUNT_PRESENT_NOT_INFERRED':'AUTH_REQUIRED';
}catch(e){report.error=String(e);}finally{ws?.close();proc.kill();report.exit=exit;report.elapsedMs=Date.now()-started;report.diagnostic=diagnostic.split('\n').filter(x=>/listen|error|warning|unexpected|feature|transport|permission|WebSocket|bind|config/i.test(x)).join('\n').slice(0,3000);fs.writeFileSync('docs/evidence/bootstrap-20261007/codex-protocol-probe.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report));}
