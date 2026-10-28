import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { _electron as electron } from 'playwright';

const repo=process.cwd(), evidence=path.resolve(process.env.JARVIS_BOOTSTRAP_EVIDENCE??'docs/evidence/bootstrap-20261007/native');fs.mkdirSync(evidence,{recursive:true});
const candidate=process.env.JARVIS_BOOTSTRAP_CANDIDATE??'qwen2.5-3b-recovery';
const reuse=process.env.JARVIS_BOOTSTRAP_PROFILE;const profile=reuse??fs.mkdtempSync(path.join(os.tmpdir(),'jarvis-fabric-native-bootstrap-'));
if(!path.isAbsolute(profile)||!path.resolve(profile).startsWith(path.resolve(os.tmpdir())+path.sep)||!path.basename(profile).startsWith('jarvis-fabric-native-bootstrap-'))throw Error('ISOLATED_PROFILE_REQUIRED');
const old=JSON.parse(fs.readFileSync(path.resolve('../Dependencias/Runtimes/llama-cpp/b6500/qwen-runtime.json')));
const downloaded=fs.existsSync('docs/evidence/bootstrap-20261007/model-download.json')?JSON.parse(fs.readFileSync('docs/evidence/bootstrap-20261007/model-download.json')).file:null;
const env={...process.env,JARVIS_ALLOW_FIXTURES:'1',JARVIS_TEST_USER_DATA:profile,JARVIS_BOOTSTRAP_ROOT:path.join(profile,'local-ai'),JARVIS_RUNTIME_ROOT:path.join(profile,'uninstalled-runtimes'),OLLAMA_HOST:'http://127.0.0.1:19877',JARVIS_BOOTSTRAP_PROVISION:JSON.stringify([path.resolve('../Dependencias/Runtimes/llama-cpp/b6500/official.zip'),old.model.file,...(downloaded?[downloaded]:[])]),JARVIS_CODEX_EXE:path.resolve('../Dependencias/Herramientas/Codex/codex.exe')};
delete env.ELECTRON_RUN_AS_NODE;let app,page;const checks=[],errors=[];
async function launch(){app=await electron.launch({executablePath:path.resolve('node_modules/electron/dist/electron.exe'),args:[repo],env,timeout:300000});page=await app.firstWindow();page.setDefaultTimeout(90000);page.on('pageerror',e=>errors.push(String(e)));await page.getByRole('button',{name:'Home',exact:true}).waitFor({timeout:180000});}
async function settings(){await page.evaluate(()=>localStorage.setItem('jarvis.firstRun',JSON.stringify({completed:true,version:1,permissionPreset:'FULL',sessionPolicy:'keep',localAIChoice:'skipped',fingerprint:null})));await page.reload();await page.getByRole('button',{name:'Settings',exact:true}).click();await page.getByRole('button',{name:'IA local',exact:true}).click();await page.getByTestId('bootstrap-intelligence').waitFor();}
async function installed(){const deadline=Date.now()+600000;while(Date.now()<deadline){const s=await page.evaluate(()=>window.jarvis.bootstrap.snapshot());if(['OPERATIVE','DEGRADED','FAILED'].includes(s.state.phase))return s;await new Promise(r=>setTimeout(r,1000));}throw Error('INSTALL_TIMEOUT');}
try{
 await launch();await settings();let s=await page.evaluate(()=>window.jarvis.bootstrap.inspect());if(!reuse)assert.equal(s.state.localHealth,'NOT_INSTALLED');else assert.ok(['OPERATIVE','DEGRADED'].includes(s.state.localHealth));assert.equal(s.state.externalProviderId,null);checks.push(reuse?'Explicit retry in an isolated previous native profile, verified files reused, no external inference or paid permission':'Real isolated profile starts with no bootstrap runtime/model, no external inference and no paid permission');
 await assert.rejects(()=>page.evaluate(()=>window.jarvis.bootstrap.action('install:qwen2.5-3b-recovery')),/GESTURE_REQUIRED/);checks.push('Forged renderer request cannot install');
 await page.getByRole('button',{name:'Comprobar inicio de sesión',exact:true}).click();
 await page.getByRole('button',{name:'Comprobar inicio de sesión',exact:true}).waitFor({state:'visible'});
 await page.waitForFunction(()=>[...document.querySelectorAll('button')].some(b=>b.textContent==='Comprobar inicio de sesión'&&!b.disabled),null,{timeout:180000});
 const codexStatus=await page.evaluate(()=>window.jarvis.bootstrap.snapshot());
 assert.equal(codexStatus.externalDiagnostics.protocolVerified,true,JSON.stringify(codexStatus.externalDiagnostics));
 assert.equal(codexStatus.external,'AUTH_REQUIRED');checks.push('Actual official Codex AppServer initialized and account/read proved AUTH_REQUIRED; no token copy, login or external inference');
 fs.writeFileSync(path.join(evidence,'codex-auth.json'),JSON.stringify({status:codexStatus.external,...codexStatus.externalDiagnostics,paidCalls:0},null,2));
 await page.getByRole('button',{name:'Ver opciones',exact:true}).count().then(async n=>{if(n)await page.getByRole('button',{name:'Ver opciones',exact:true}).click();else await page.locator('summary').filter({hasText:'Ver opciones'}).click();});
 await page.getByLabel('Modelo local de bootstrap').selectOption(candidate);await page.getByRole('button',{name:/^Instalar recomendada$|^Instalar \/ verificar alternativa$/}).click();
 await installed();
 s=await page.evaluate(()=>window.jarvis.bootstrap.snapshot());assert.ok(['OPERATIVE','DEGRADED'].includes(s.state.phase),JSON.stringify(s.state));assert.equal(s.state.benchmark.correct,true);assert.equal(s.state.benchmark.stable,true);assert.equal(s.state.receipts.length,4);assert.ok(s.state.benchmark.outputTokens>0);checks.push('Copied/provisioned known official runtime/model, verified every asset and GGUF, Windows Job server loaded and two real inference probes passed');
 const receipts=s.state.receipts;await page.screenshot({path:path.join(evidence,'local-verified.png')});await app.close();app=null;
 await launch();await settings();s=await page.evaluate(()=>window.jarvis.bootstrap.inspect());assert.ok(['OPERATIVE','DEGRADED'].includes(s.state.phase));assert.deepEqual(s.state.receipts,receipts);checks.push('Restart rechecks integrity without rerunning installer or inference; receipts remain unchanged');
 const providers=await page.evaluate(()=>window.jarvis.connected.refresh());assert.ok(providers.providers.some(x=>x.id==='bootstrap-local'&&x.state==='AVAILABLE'));assert.equal(providers.policy.allowPaidApi,false);checks.push('Connected AI exposes verified local intelligence, zero paid opt-in');
 // STOP during a new job-backed real inference, admitted by an actual Home click.
 await page.getByRole('button',{name:'Home',exact:true}).click();await page.locator('[data-authority-home-input]').fill('Explica en español qué hace un enrutador de tareas.');await page.locator('[data-authority-home-send]').click();
 let diagnostics=null;for(let i=0;i<360;i++){diagnostics=await page.evaluate(()=>window.jarvis.bootstrap.diagnostics());if(diagnostics.pid)break;await new Promise(r=>setTimeout(r,500));}
 assert.ok(diagnostics?.pid,'Expected a real owned runtime PID before STOP');assert.equal(diagnostics.ownership,'WINDOWS_JOB');await page.evaluate(()=>window.jarvis.authority.stop());
 const stopped=await page.evaluate(()=>window.jarvis.bootstrap.diagnostics());assert.equal(stopped.pid,null);const processCheck=spawnSync('powershell.exe',['-NoProfile','-Command',`Get-Process -Id ${diagnostics.pid} -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Id`],{encoding:'utf8',windowsHide:true});assert.equal(processCheck.stdout.trim(),'');checks.push('Global STOP closed the anonymous Windows Job; actual runtime PID no longer exists');
 await page.locator('[data-authority-home-input]').fill('Responde únicamente 7.');await page.locator('[data-authority-home-send]').click();
 const chatAuthority=await page.evaluate(()=>window.jarvis.authority.snapshot());let checkpoint=null;const chatDeadline=Date.now()+300000;
 while(Date.now()<chatDeadline){checkpoint=await page.evaluate(id=>window.jarvis.connected.checkpoint(id),chatAuthority.activeRun);if(checkpoint?.operations.some(o=>o.status==='SUCCESS'||o.status==='BLOCKED'||o.status==='STOPPED'))break;await new Promise(r=>setTimeout(r,1000));}
 const response=checkpoint?.operations.find(o=>o.status==='SUCCESS');assert.ok(response,JSON.stringify(checkpoint));assert.equal(response.providerId,'bootstrap-local');assert.match(response.text.trim(),/^7\.?$/);
 const messages=await page.evaluate(id=>window.jarvis.fabric.messagePage(id,100),checkpoint.state.conversationId);const own=messages.filter(r=>r.message.taskId===chatAuthority.activeRun);assert.equal(own.filter(r=>r.message.role==='user').length,1);assert.equal(own.filter(r=>r.message.role==='assistant').length,1);
 const usage=await page.evaluate(()=>window.jarvis.fabric.usagePage('bootstrap-local',100));assert.ok(usage.some(u=>u.taskId===chatAuthority.activeRun));checks.push('Normal Home chat produced a real local answer with main operation, measured request usage, actual model provenance and exactly one user/assistant message');
 fs.writeFileSync(path.join(evidence,'chat.json'),JSON.stringify({operation:response,messages:own,usage:usage.filter(u=>u.taskId===chatAuthority.activeRun)},null,2));
 await settings();await page.getByRole('button',{name:'Comprobar inicio de sesión',exact:true}).count().then(async n=>{if(n)await page.getByRole('button',{name:'Comprobar inicio de sesión',exact:true}).click();});
 await page.screenshot({path:path.join(evidence,'stopped.png')});
 fs.writeFileSync(path.join(evidence,'result.json'),JSON.stringify({status:'PASS',checks,profile,state:s.state,providers,errors,external:'AUTH_REQUIRED / NOT_VERIFIED; no login or external inference claimed',realProfileTouched:false},null,2));console.log('BOOTSTRAP_NATIVE_PASS '+checks.length);
}catch(e){fs.writeFileSync(path.join(evidence,'failure-'+Date.now()+'.json'),JSON.stringify({status:'FAIL',checks,error:String(e),errors,body:page?await page.locator('body').innerText().catch(()=>null):null,state:page?await page.evaluate(()=>window.jarvis?.bootstrap?.snapshot()).catch(()=>null):null},null,2));throw e;}finally{if(app)await app.close();}
