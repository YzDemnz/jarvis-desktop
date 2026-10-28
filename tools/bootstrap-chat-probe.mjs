import fs from 'node:fs';
import path from 'node:path';
import { _electron } from 'playwright';
const profile=process.env.JARVIS_BOOTSTRAP_PROBE_PROFILE;
if(!profile||!path.isAbsolute(profile)||!path.basename(profile).startsWith('jarvis-fabric-native-bootstrap-'))throw Error('ISOLATED_PROFILE_REQUIRED');
const env={...process.env,JARVIS_ALLOW_FIXTURES:'1',JARVIS_TEST_USER_DATA:profile,JARVIS_BOOTSTRAP_ROOT:path.join(profile,'local-ai'),OLLAMA_HOST:'http://127.0.0.1:19877'};delete env.ELECTRON_RUN_AS_NODE;
const app=await _electron.launch({executablePath:path.resolve('node_modules/electron/dist/electron.exe'),args:[process.cwd()],env,timeout:300000});
let page;
try{
 page=await app.firstWindow();page.setDefaultTimeout(180000);await page.getByRole('button',{name:'Home',exact:true}).waitFor();
 await page.locator('[data-authority-home-input]').fill('Explica en español qué hace un enrutador de tareas.');await page.locator('[data-authority-home-send]').click();
 const started=Date.now();let d=null;
 while(Date.now()-started<240000){d=await page.evaluate(()=>window.jarvis.bootstrap.diagnostics());if(d.pid)break;await new Promise(r=>setTimeout(r,1000));if(Math.round((Date.now()-started)/1000)%15===0)console.log(JSON.stringify({elapsed:Date.now()-started,diagnostics:d,body:(await page.locator('body').innerText()).slice(-5000)}));}
 const state=await page.evaluate(()=>window.jarvis.bootstrap.snapshot());const authority=await page.evaluate(()=>window.jarvis.authority.snapshot());
 fs.writeFileSync('docs/evidence/bootstrap-20261007/chat-probe.json',JSON.stringify({elapsed:Date.now()-started,diagnostics:d,state,authority,body:await page.locator('body').innerText()},null,2));
 if(d.pid){await page.evaluate(()=>window.jarvis.authority.stop());console.log('ACTUAL_JOB_STOPPED '+d.pid);}else throw Error('NO_CHAT_RUNTIME_PID');
}finally{await app.close();}
