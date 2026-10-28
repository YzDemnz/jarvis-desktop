import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { CredentialStore } from '../../electron/connected/CredentialStore';
import { ChatCompletionsProvider } from '../../electron/connected/ChatCompletionsProvider';
import { safeContextText } from '../../src/fabric/ContinuityState';

const directory=fs.mkdtempSync(path.join(os.tmpdir(),'jarvis-bootstrap-providers-'));
const credential='sentinel-bootstrap-private-secret-never-record';let route='',calls=0,replyTools=false;const bodies:any[]=[];
const server=http.createServer((req,res)=>{let body='';req.on('data',x=>body+=x);req.on('end',()=>{calls++;bodies.push(JSON.parse(body));assert.ok(req.headers.authorization===`Bearer ${credential}`||req.headers['x-api-key']===credential);assert.equal(req.url,route==='claude-api'?'/messages':'/chat/completions');res.setHeader('Content-Type','application/json');res.end(JSON.stringify(route==='claude-api'?{type:'message',role:'assistant',stop_reason:'end_turn',content:[{type:replyTools?'tool_use':'text',text:'JARVIS_READY'}],usage:{input_tokens:4,output_tokens:3}}:{choices:[{finish_reason:'stop',message:{role:'assistant',content:'JARVIS_READY',...(replyTools?{tool_calls:[{id:'unsafe',function:{name:'install',arguments:'https://evil.example'}}]}:{})}}],usage:{prompt_tokens:4,completion_tokens:3}}));});});
await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));const address=server.address();if(!address||typeof address==='string')throw Error('SERVER');const endpoint=`http://127.0.0.1:${address.port}`;
try{for(const id of ['claude-api','gemini-api','grok-api'] as const){route=id;replyTools=false;const vault=new CredentialStore(path.join(directory,id+'.json'),{isEncryptionAvailable:()=>true,encryptString:s=>Buffer.from(s).map(x=>x^85),decryptString:b=>Buffer.from(b).map(x=>x^85).toString()});vault.put(id,endpoint,credential);
  let admitted=false;const provider=new ChatCompletionsProvider(id,vault,'fixture-model',()=>{if(!admitted)throw Error('PAID_POLICY_DENIED');},{fixtureEndpoint:endpoint});const before=calls;await assert.rejects(()=>provider.execute({taskId:'probe',prompt:'Hello'}));assert.equal(calls,before);admitted=true;
  const result=await provider.execute({taskId:'probe',prompt:'Text only'});assert.equal(result.text,'JARVIS_READY');assert.equal(result.usage?.[0]?.output,3);assert.equal((await provider.entitlement()).paid,true);
  const request=bodies.at(-1);if(id==='claude-api')assert.equal(request.tools,undefined);else{assert.deepEqual(request.tools,[]);assert.equal(request.tool_choice,'none');assert.equal(request.provider,undefined);}
  replyTools=true;await assert.rejects(()=>provider.execute({taskId:'probe',prompt:'Text only'}),/PROVIDER_RESPONSE_NOT_COMPLETED/);
  assert.ok(!fs.readFileSync(path.join(directory,id+'.json'),'utf8').includes(credential));assert.ok(!safeContextText('echo '+credential).includes(credential));
}}
finally{await new Promise<void>(r=>server.close(()=>r()));}
console.log('BOOTSTRAP_PROVIDER_PASS: Claude Messages, Gemini and Grok compatible API schemas; unadmitted paid requests make zero HTTP calls; tool responses rejected; SecretRef encryption/redaction. All remote servers and credentials are SIMULATED, no paid API calls.');
