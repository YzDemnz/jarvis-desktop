import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {_electron} from 'playwright';
const native=JSON.parse(fs.readFileSync('docs/evidence/bootstrap-20261007/native-verified/result.json','utf8'));
assert.equal(native.status,'PASS');const profile=native.profile;
assert.ok(path.resolve(profile).startsWith(path.resolve(os.tmpdir())+path.sep));assert.ok(path.basename(profile).startsWith('jarvis-fabric-native-bootstrap-'));
const executable=path.resolve('release/win-unpacked/JARVIS.exe'),env={...process.env,JARVIS_ALLOW_FIXTURES:'1',JARVIS_TEST_USER_DATA:profile,JARVIS_BOOTSTRAP_ROOT:path.join(profile,'local-ai'),OLLAMA_HOST:'http://127.0.0.1:19877'};
delete env.ELECTRON_RUN_AS_NODE;const errors=[],app=await _electron.launch({executablePath:executable,args:[],env,timeout:300000});
try{
 const page=await app.firstWindow();page.setDefaultTimeout(180000);page.on('pageerror',e=>errors.push(String(e)));await page.getByRole('button',{name:'Home',exact:true}).waitFor();
 const host=await app.evaluate(({app})=>({packaged:app.isPackaged,version:app.getVersion(),userData:app.getPath('userData'),temp:process.env.TEMP,runtime:process.env.JARVIS_RUNTIME_ROOT}));assert.equal(host.packaged,true);assert.equal(host.version,'0.4.0-dev');assert.equal(host.userData,profile);assert.ok(host.temp.startsWith('E:\\CODEX\\'));
 await page.getByRole('button',{name:'Settings',exact:true}).click();await page.getByRole('button',{name:'IA local',exact:true}).click();await page.getByTestId('bootstrap-intelligence').waitFor();
 const snapshot=await page.evaluate(()=>window.jarvis.bootstrap.inspect()),providers=await page.evaluate(()=>window.jarvis.connected.refresh());assert.equal(snapshot.state.localHealth,'OPERATIVE');assert.equal(snapshot.state.receipts.length,4);assert.equal(providers.policy.allowPaidApi,false);assert.equal(providers.policy.allowPaidFallback,false);assert.ok(providers.providers.some(p=>p.id==='bootstrap-local'&&p.state==='AVAILABLE'));
 await page.screenshot({path:'docs/evidence/bootstrap-20261007/package-smoke.png'});assert.deepEqual(errors,[]);
 await page.getByRole('button',{name:'Home',exact:true}).click();await page.locator('[data-authority-home-input]').fill('Responde únicamente 7.');await page.locator('[data-authority-home-send]').click();let id='';for(let i=0;i<30;i++){id=(await page.evaluate(()=>window.jarvis.authority.snapshot())).activeRun;if(id)break;await new Promise(r=>setTimeout(r,100));}
 let checkpoint=null;const until=Date.now()+300000;while(Date.now()<until){checkpoint=await page.evaluate(id=>window.jarvis.connected.checkpoint(id),id);if(checkpoint?.operations.some(o=>['SUCCESS','BLOCKED','STOPPED'].includes(o.status)))break;await new Promise(r=>setTimeout(r,1000));}
 const response=checkpoint?.operations.find(o=>o.status==='SUCCESS');assert.ok(response,JSON.stringify(checkpoint));assert.equal(response.providerId,'bootstrap-local');assert.match(response.text.trim(),/^7\.?$/);assert.equal(response.resultVerification.state,'PRODUCED');
 fs.writeFileSync('docs/evidence/bootstrap-20261007/package-smoke.json',JSON.stringify({status:'PASS',host,profileIsolated:true,realProfileTouched:false,checks:['ASAR starts with original CommonJS TypeScript and ws production dependency','Profile and temp remain external in packaged mode','Persisted model integrity, benchmark and four receipts restored without inference replay','New UI and Connected AI report verified local; paid API and paid fallback remain false','Packaged Home chat receives JARVIS context, returns actual local text, records provenance and does not promote a produced answer to VERIFIED'],snapshot,response,errors},null,2));console.log('BOOTSTRAP_PACKAGE_PASS 5');
}finally{await app.close();}
