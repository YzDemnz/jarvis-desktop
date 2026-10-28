// Authorized installation/activation for the owner's real profile. This is
// separate from the isolated regression and packaged smoke tests.
import fs from 'node:fs';
import path from 'node:path';
import {_electron} from 'playwright';
import {spawnSync} from 'node:child_process';
if(process.env.JARVIS_ACTIVATE_OWNER!=='1'||process.env.JARVIS_USER_DATA!=='E:\\CODEX\\DatosApps\\JARVIS')throw Error('EXPLICIT_OWNER_ACTIVATION_REQUIRED');
const env={...process.env};for(const key of ['ELECTRON_RUN_AS_NODE','JARVIS_ALLOW_FIXTURES','JARVIS_TEST_USER_DATA','JARVIS_BOOTSTRAP_PROVISION'])delete env[key];
const app=await _electron.launch({executablePath:path.resolve('../App instalada/JARVIS.exe'),args:[],env,timeout:300000});let page;
try{
 page=await app.firstWindow();page.setDefaultTimeout(180000);await page.getByRole('button',{name:'Settings',exact:true}).waitFor();
 await page.getByRole('button',{name:'Settings',exact:true}).click();await page.getByRole('button',{name:'IA local',exact:true}).click();await page.getByTestId('bootstrap-intelligence').waitFor();
 let s=await page.evaluate(()=>window.jarvis.bootstrap.inspect());
 if(!['OPERATIVE','DEGRADED'].includes(s.state.localHealth)){
  const options=page.locator('summary').filter({hasText:'Ver opciones'});await options.click();await page.getByLabel('Modelo local de bootstrap').selectOption('qwen3-4b-gguf');await page.getByRole('button',{name:/^Instalar recomendada$|^Instalar \/ verificar alternativa$/}).click();
  const until=Date.now()+600000;while(Date.now()<until){s=await page.evaluate(()=>window.jarvis.bootstrap.snapshot());if(['OPERATIVE','DEGRADED','FAILED'].includes(s.state.phase))break;await new Promise(r=>setTimeout(r,1000));}
 }
 if(!['OPERATIVE','DEGRADED'].includes(s.state.localHealth))throw Error('OWNER_ACTIVATION_FAILED '+s.state.failure);
 const host=await app.evaluate(({app})=>({version:app.getVersion(),profile:app.getPath('userData'),temp:process.env.TEMP,fixture:process.env.JARVIS_ALLOW_FIXTURES??null})),providers=await page.evaluate(()=>window.jarvis.connected.refresh());
 if(host.profile!=='E:\\CODEX\\DatosApps\\JARVIS'||host.fixture)throw Error('OWNER_PROFILE_MISMATCH');
 const inspected=spawnSync(path.resolve('node_modules/electron/dist/electron.exe'),['tools/bootstrap-owner-stats.mjs'],{env:{...env,ELECTRON_RUN_AS_NODE:'1'},encoding:'utf8',windowsHide:true});if(inspected.status!==0)throw Error('OWNER_STATS_READ_FAILED');const phase=JSON.parse(inspected.stdout.trim());
 await page.screenshot({path:'docs/evidence/bootstrap-20261007/owner-activated.png'});
 fs.writeFileSync('docs/evidence/bootstrap-20261007/owner-activated.json',JSON.stringify({status:'ACTIVATED',kind:'AUTHORIZED_OWNER_INSTALLATION',test:false,host,phase,bootstrap:s.state,policy:providers.policy,paidApiCalls:0,at:new Date().toISOString()},null,2));console.log('OWNER_LOCAL_ACTIVATED '+s.state.localHealth);
}finally{await app.close();}
