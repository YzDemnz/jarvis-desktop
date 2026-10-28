import fs from 'node:fs';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {externalPath} from './electron44-profile-metadata.mjs';

const executable=externalPath(process.env.JARVIS_AUTOMATION_HELPER??'release/win-unpacked/resources/native/jarvis-automation-helper.exe');
const output=externalPath(process.env.JARVIS_HELPER_DIAGNOSTIC??'docs/evidence/electron44-20261011/helper-diagnostic-20261021.json');
const events=[];let stderr='',buffer='';
const child=spawn(executable,[],{stdio:['pipe','pipe','pipe'],windowsHide:true});
child.stdout.setEncoding('utf8');child.stderr.setEncoding('utf8');
child.stderr.on('data',text=>{stderr=(stderr+text).slice(-12000);});
child.stdout.on('data',text=>{buffer+=text;let end;while((end=buffer.indexOf('\n'))>=0){const line=buffer.slice(0,end);buffer=buffer.slice(end+1);try{
  const event=JSON.parse(line);if(event.event)continue;
  // Never export window titles, process names, UI text or user input.
  events.push({requestId:event.requestId,ok:event.ok,error:event.error??null,
    result:Array.isArray(event.result)?{count:event.result.length}:typeof event.result==='string'?event.result:typeof event.result});
}catch{events.push({parseError:true});}}});
child.stdin.on('error',()=>{});
const commands=['ping','sessionState','cancelInput','inputState','listWindows'];
const timers=commands.map((command,index)=>setTimeout(()=>child.stdin.write(JSON.stringify({requestId:'diagnostic-'+index,command,args:{}})+'\n'),index*250));
const watchdog=setTimeout(()=>child.kill(),4000);
const closed=await new Promise(resolve=>{child.on('exit',(code,signal)=>resolve({code,signal}));child.on('error',error=>resolve({error:error.code}));});
clearTimeout(watchdog);timers.forEach(clearTimeout);
fs.mkdirSync(path.dirname(output),{recursive:true});fs.writeFileSync(output,JSON.stringify({at:new Date().toISOString(),executable,closed,events,stderr,
  scope:'Owned closed-protocol helper; fixed non-interactive requests; window/UI/input text omitted; no owner profile or credentials'},null,2));
console.log(JSON.stringify({closed,events,stderr}));
