import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {_electron} from 'playwright';
import {profileMetadata,externalPath} from './electron44-profile-metadata.mjs';
const evidence=externalPath('docs/evidence/intelligence-bridge-20261022'),recordFile=path.join(evidence,'owner-intelligence.json');assert.equal(fs.existsSync(recordFile),false,'PRESERVE_OWNER_PROOF');
assert.equal(process.env.JARVIS_USER_DATA,'E:\\CODEX\\DatosApps\\JARVIS');
const env={...process.env};for(const key of ['ELECTRON_RUN_AS_NODE','JARVIS_ALLOW_FIXTURES','JARVIS_TEST_USER_DATA'])delete env[key];
const app=await _electron.launch({executablePath:externalPath('../App instalada/JARVIS.exe'),env,timeout:180000});
try{
  const page=await app.firstWindow();await page.getByRole('button',{name:'Home',exact:true}).waitFor();
  const connected=await page.evaluate(()=>window.jarvis.connected.refresh());assert.equal(connected.policy.economyModel,'qwen2.5:3b-instruct');assert.equal(connected.policy.mcpModel,'qwen3.5:2b');assert.equal(connected.policy.allowPaidApi,false);assert.equal(connected.policy.allowPaidFallback,false);
  let state;const deadline=Date.now()+10000;do{state=await page.evaluate(()=>window.jarvis.intelligence.snapshot());if(state.bridge.state==='READY')break;await new Promise(r=>setTimeout(r,100));}while(Date.now()<deadline);
  assert.equal(state.bridge.state,'READY');assert.equal(state.bridge.scriptPresent,true);assert.equal(state.localHost.detected,true);assert.equal(state.models.length,4);assert.ok(state.models.every(m=>m.receipt?.state==='VERIFIED'));assert.equal(state.jobs.length,0);
  const before=JSON.parse(fs.readFileSync(path.join(evidence,'owner-current/owner-before.json'))),metadata=profileMetadata(path.join(process.env.JARVIS_USER_DATA,'intelligence-fabric/fabric.sqlite'));assert.deepEqual(metadata.tables,before.tables);
  await page.getByRole('button',{name:'Settings',exact:true}).click();await page.getByRole('button',{name:'Proveedores de IA',exact:true}).click();
  const colors=await page.getByLabel('Material para Concilius').evaluate(el=>({background:getComputedStyle(el).backgroundColor,text:getComputedStyle(el).color}));assert.notEqual(colors.background,'rgb(255, 255, 255)');
  await page.getByTestId('intelligence-connections').screenshot({path:path.join(evidence,'installed-connections.png')});await page.getByRole('button',{name:'Home',exact:true}).click();
  fs.writeFileSync(recordFile,JSON.stringify({status:'VERIFIED_OWNER_CONFIGURATION',version:await page.evaluate(()=>window.jarvis.app.version()),modelCalls:0,paidApiCalls:0,ownerTestTasks:0,models:state.models.map(m=>({model:m.model,state:m.receipt.state,store:m.store})),dailyModel:state.economyModel,mcpModel:state.mcpModel,bridge:state.bridge,localHostDetected:state.localHost.detected,fieldColors:colors,allOwnerRowsUnchanged:true,...metadata},null,2));
  console.log('OWNER_INTELLIGENCE_CONFIGURATION_PASS');
}finally{await app.close();}
