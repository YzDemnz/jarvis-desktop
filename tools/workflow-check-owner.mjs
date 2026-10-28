import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {_electron} from 'playwright';
if(process.env.JARVIS_USER_DATA!=='E:\\CODEX\\DatosApps\\JARVIS')throw Error('EXTERNAL_OWNER_PROFILE_REQUIRED');
const env={...process.env};for(const k of ['ELECTRON_RUN_AS_NODE','JARVIS_ALLOW_FIXTURES','JARVIS_TEST_USER_DATA','JARVIS_BOOTSTRAP_PROVISION'])delete env[k];
const app=await _electron.launch({executablePath:path.resolve('../App instalada/JARVIS.exe'),args:[],env,timeout:300000});
try{
 const page=await app.firstWindow();await page.getByRole('button',{name:'Home',exact:true}).waitFor({timeout:180000});
 const host=await app.evaluate(({app})=>({version:app.getVersion(),profile:app.getPath('userData'),fixture:process.env.JARVIS_ALLOW_FIXTURES??null,temp:process.env.TEMP}));assert.equal(host.version,'0.4.1-dev');assert.equal(host.profile,env.JARVIS_USER_DATA);assert.equal(host.fixture,null);
 const boot=await page.evaluate(()=>window.jarvis.bootstrap.inspect()),connected=await page.evaluate(()=>window.jarvis.connected.refresh());assert.equal(boot.state.localHealth,'OPERATIVE');assert.equal(boot.state.receipts.length,4);assert.equal(connected.policy.allowPaidApi,false);assert.equal(connected.policy.allowPaidFallback,false);
 const r=spawnSync(path.resolve('node_modules/electron/dist/electron.exe'),['tools/bootstrap-owner-stats.mjs'],{env:{...env,ELECTRON_RUN_AS_NODE:'1'},encoding:'utf8',windowsHide:true});assert.equal(r.status,0,r.stderr);const stats=JSON.parse(r.stdout);assert.deepEqual(stats,JSON.parse(fs.readFileSync('docs/evidence/workflow-20261007/owner-before.json')).stats);
 await page.screenshot({path:'docs/evidence/workflow-20261007/owner.png'});fs.writeFileSync('docs/evidence/workflow-20261007/owner-installed.json',JSON.stringify({status:'VERIFIED_OWNER_STARTUP',test:false,host,stats,bootstrap:boot.state,policy:connected.policy,noTestTaskSubmitted:true,paidCalls:0,at:new Date().toISOString()},null,2));console.log('OWNER_WORKFLOW_STARTUP_PASS');
}finally{await app.close();}
