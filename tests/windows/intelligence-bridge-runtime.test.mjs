import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {_electron} from 'playwright';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';
const evidence=path.resolve(process.env.JARVIS_BRIDGE_EVIDENCE??'docs/evidence/intelligence-bridge-20261022/native');fs.mkdirSync(evidence,{recursive:true});
assert.equal(fs.existsSync(path.join(evidence,'result.json')),false,'PRESERVE_NATIVE_PROOF');
const profile=fs.mkdtempSync(path.join(os.tmpdir(),'jarvis-fabric-native-intelligence-'));assert.match(profile,/^E:\\CODEX\\/i);
const receiptDir=path.join(profile,'intelligence-connections/models');fs.mkdirSync(receiptDir,{recursive:true});
for(const id of ['qwen-daily','deepseek-small','internlm-small','qwen-stable'])fs.copyFileSync(path.join(process.env.JARVIS_USER_DATA,'intelligence-connections/models',id+'.json'),path.join(receiptDir,id+'.json'));
const cases=[{text:'El proyecto Atlas se entrega el viernes. Ana revisará las pruebas. Falta confirmar el presupuesto.',markers:['Atlas','viernes','Ana','presupuesto'],unknownPattern:'presupuesto'},
  {text:'El inventario Delta tiene 12 cajas. Luis debe contar las cajas el martes. No se conoce la ubicación del almacén.',markers:['Delta','12','Luis','martes'],unknownPattern:'ubicaci|almac'}];
fs.writeFileSync(path.join(evidence,'frozen.json'),JSON.stringify({cases,models:['qwen3.5:2b','deepseek-r1:1.5b','internlm2:1.8b','qwen2.5:3b-instruct'],dailyCandidate:'qwen2.5:3b-instruct',mcpCandidate:'qwen3.5:2b',criteria:'One actual local inference each, bounded followup structure with at least one next step, frozen markers, explicit missing fact in unknowns, no invented final-phase/completed claim; a failed quality case is retained and does not mean transport failed. No universal factual verification.'},null,2));
let app,page,client,phase='launch';const checks=[],matrix=[],pass=name=>{checks.push({name,status:'PASS'});console.log('PASS '+name);};
const wait=async(fn,ms=240000)=>{const until=Date.now()+ms;while(!await fn()){if(Date.now()>until)throw Error('BRIDGE_WAIT_TIMEOUT_'+phase);await new Promise(r=>setTimeout(r,150));}};
const launch=async()=>{app=await _electron.launch({executablePath:path.resolve(process.env.JARVIS_EXE??'release/win-unpacked/JARVIS.exe'),env:{...process.env,JARVIS_ALLOW_FIXTURES:'1',JARVIS_TEST_USER_DATA:profile,JARVIS_BOOTSTRAP_ROOT:path.join(profile,'no-bootstrap')},timeout:180000});page=await app.firstWindow();page.setDefaultTimeout(60000);await page.getByRole('button',{name:'Home',exact:true}).waitFor();};
const settings=async()=>{await page.getByRole('button',{name:'Settings',exact:true}).click();await page.getByRole('button',{name:'Proveedores de IA',exact:true}).click();await page.getByTestId('intelligence-connections').waitFor();};
const snapshot=()=>page.evaluate(()=>window.jarvis.intelligence.snapshot());
const progress=setInterval(()=>fs.writeFileSync(path.join(evidence,'progress.json'),JSON.stringify({phase,checks,matrix,profile},null,2)),2000);
try{
  await launch();await page.evaluate(()=>localStorage.setItem('jarvis.firstRun',JSON.stringify({completed:true,version:1,permissionPreset:'FULL',sessionPolicy:'keep',localAIChoice:'skipped',fingerprint:null})));await page.reload();await settings();
  phase='probe-qwen';const previous=(await snapshot()).models[0].receipt.at;await page.getByTestId('model-qwen-daily').getByRole('button',{name:'Probar modelo',exact:true}).click();
  await wait(async()=>{const s=await snapshot();return !s.operation&&s.models[0].receipt.at!==previous;});assert.equal((await snapshot()).models[0].receipt.state,'VERIFIED');
  pass('Packaged UI verifies actual external Qwen blobs and local arithmetic inference');
  await page.getByTestId('model-qwen-daily').getByRole('button',{name:'Usar para MCP',exact:true}).click();await wait(async()=>!(await snapshot()).operation);assert.equal((await snapshot()).mcpModel,'qwen3.5:2b');
  for(const id of ['qwen-daily','deepseek-small','internlm-small','qwen-stable']){
    phase='followup-'+id;await page.getByTestId('model-'+id).getByRole('button',{name:'Usar a diario',exact:true}).click();await wait(async()=>!(await snapshot()).operation);
    const preferred=(await snapshot()).economyModel;
    for(const fixture of cases){
      const previousId=await page.getByTestId('concilius-graph-id').innerText();await page.getByLabel('Tipo de tarea organizada').selectOption('followup');await page.getByLabel('Material para Concilius').fill(fixture.text);await page.locator('[data-org-review]').uncheck();await page.getByRole('button',{name:'Organizar y ejecutar',exact:true}).click();let id;
      await wait(async()=>{id=await page.getByTestId('concilius-graph-id').innerText();return id&&id!==previousId;});
      await wait(async()=>{const g=await page.evaluate(id=>window.jarvis.connected.graphRead(id),id);return g&&g.state!=='STARTED';});
      const graph=await page.evaluate(id=>window.jarvis.connected.graphRead(id),id),cp=await page.evaluate(id=>window.jarvis.connected.checkpoint(id),id);
      assert.equal(graph.plan.nodes[0].model,preferred);assert.equal(graph.plan.nodes[0].maxOutputTokens,512);assert.equal(graph.organization.plannedInferenceCalls,1);assert.equal(cp.operations.length,1);
      const text=cp.operations[0].text??'',markers=fixture.markers.every(s=>text.toLowerCase().includes(s.toLowerCase()));let value;try{value=JSON.parse(text.trim().replace(/^```json\s*\n([\s\S]*?)\n```$/,'$1'));}catch{}
      const missingFact=Array.isArray(value?.unknowns)&&value.unknowns.some(s=>typeof s==='string'&&new RegExp(fixture.unknownPattern,'i').test(s)),inventedPhase=/fase final|ya est[aá] disponible|ha completado|est[aá] completado/i.test(text);
      matrix.push({model:preferred,fixture,graph,checkpoint:cp,qualityCase:graph.state==='VERIFIED'&&markers&&missingFact&&!inventedPhase?'PASS':'FAIL',markers,missingFact,inventedPhase});
      fs.writeFileSync(path.join(evidence,'matrix.json'),JSON.stringify(matrix,null,2));
    }
  }
  assert.ok(matrix.filter(r=>r.model==='qwen2.5:3b-instruct').every(r=>r.qualityCase==='PASS'),'QWEN_DAILY_FROZEN_CASES');
  pass('Eight actual model/task runs compare local Chinese models with frozen criteria and retain every result');
  await page.getByTestId('model-qwen-stable').getByRole('button',{name:'Usar a diario',exact:true}).click();await wait(async()=>!(await snapshot()).operation);
  phase='mcp';await page.getByRole('button',{name:'Preparar conexión MCP',exact:true}).click();await wait(async()=>(await snapshot()).bridge.state==='READY');
  await page.getByLabel('Tarea para otra app').fill('Resume material público Atlas. No ejecutes acciones.');await page.getByRole('button',{name:'Enviar al puente',exact:true}).click();await wait(async()=>(await snapshot()).jobs.length===1);
  const task=(await snapshot()).jobs[0],config=await page.evaluate(()=>window.jarvis.intelligence.config());client=new Client({name:'native-sdk-specialist',version:'1'});await client.connect(new StdioClientTransport({...config.mcpServers.jarvis,stderr:'pipe'}));
  assert.equal((await client.listTools()).tools.length,3);await client.callTool({name:'jarvis_read_task',arguments:{id:task.id}});await client.callTool({name:'jarvis_submit_result',arguments:{id:task.id,text:'Propuesta pública de Atlas; pendiente de revisión.'}});
  await wait(async()=>(await snapshot()).jobs[0].state==='PRODUCED');assert.equal((await snapshot()).jobs[0].verification,'UNVERIFIED');pass('Actual external stdio host exchanges a UI-admitted task with the packaged main journal');
  await page.getByLabel('Tarea para otra app').fill('Cancela esta propuesta pendiente.');await page.getByRole('button',{name:'Enviar al puente',exact:true}).click();await wait(async()=>(await snapshot()).jobs.length===2);const pending=(await snapshot()).jobs[0];await client.callTool({name:'jarvis_read_task',arguments:{id:pending.id}});await page.getByRole('button',{name:'STOP inteligencias',exact:true}).click();
  assert.equal((await client.callTool({name:'jarvis_submit_result',arguments:{id:pending.id,text:'late'}})).isError,true);assert.equal((await snapshot()).jobs[0].state,'STOPPED');pass('Native STOP revokes queued MCP task and refuses late host output');
  await client.close();client=null;
  phase='local-host';await page.getByLabel('Tarea para otra app').fill('Proyecto Atlas: entrega viernes, Ana revisa pruebas, falta confirmar presupuesto. Resume brevemente sólo estos hechos en español.');await page.getByRole('button',{name:'Enviar al puente',exact:true}).click();await wait(async()=>(await snapshot()).jobs.length===3);
  await page.getByRole('button',{name:'Resolver con host local',exact:true}).click();await wait(async()=>{const s=await snapshot();return s.localHost.last&&s.localHost.last.state!=='RUNNING';},300000);
  const localHost=(await snapshot()).localHost;assert.equal(localHost.last.state,'PRODUCED');assert.equal((await snapshot()).jobs[0].verification,'UNVERIFIED');pass('Packaged UI runs actual official Claude Code harness with local Qwen through task-scoped MCP');
  phase='codex';await page.getByRole('button',{name:'Comprobar Codex',exact:true}).click();await wait(async()=>!(await page.getByRole('button',{name:'Comprobar Codex',exact:true}).isDisabled()));
  const codex=(await snapshot()).codex;assert.equal(codex.protocolVerified,true);assert.equal(codex.catalogIsEntitlement,false);assert.ok(['AUTH_REQUIRED','NOT_VERIFIED','OPERATIVE'].includes(codex.status));pass('Actual official Codex App Server protocol/account discovery works without extracting desktop credentials or paid inference');
  phase='restart';await app.close();app=null;await launch();await settings();assert.equal((await snapshot()).economyModel,'qwen2.5:3b-instruct');assert.equal((await snapshot()).mcpModel,'qwen3.5:2b');assert.equal((await snapshot()).jobs.length,3);assert.equal((await snapshot()).jobs.find(j=>j.id===task.id).state,'PRODUCED');
  pass('Daily preference and external proposals persist through packaged restart without replay');
  phase='home';const priorRun=(await page.evaluate(()=>window.jarvis.authority.snapshot())).activeRun;await page.getByRole('button',{name:'Home',exact:true}).click();await page.locator('[data-authority-home-input]').fill('Responde brevemente en español: ¿cuánto es 6 más 9?');await page.locator('[data-authority-home-send]').click();let homeId;
  await wait(async()=>{homeId=(await page.evaluate(()=>window.jarvis.authority.snapshot())).activeRun;return !!homeId&&homeId!==priorRun;});
  await wait(async()=>{const cp=await page.evaluate(id=>window.jarvis.connected.checkpoint(id),homeId);return cp?.operations.some(o=>o.status==='SUCCESS');});
  const home=await page.evaluate(id=>window.jarvis.connected.checkpoint(id),homeId),response=home.operations.find(o=>o.status==='SUCCESS');assert.equal(response.model,'qwen2.5:3b-instruct');assert.match(response.text,/15/);pass('Home performs actual local daily inference and persists Qwen provenance');
  const host=await app.evaluate(({app})=>({version:app.getVersion(),packaged:app.isPackaged,electron:process.versions.electron,compiledMainSha256:process.getBuiltinModule('crypto').createHash('sha256').update(process.getBuiltinModule('fs').readFileSync(app.getAppPath()+'/dist-electron/main.js')).digest('hex')}));
  assert.equal(host.version,'0.4.4-dev');assert.equal(host.packaged,true);
  await page.screenshot({path:path.join(evidence,'home.png')});
  fs.writeFileSync(path.join(evidence,'result.json'),JSON.stringify({status:'PASS',host,checks,matrix,codex,localHost,home,profile,paidApiCalls:0,ownerProfileTouched:false,scope:'Finite task fixtures and actual SDK transport; external Claude cloud inference remains unverified'},null,2));
  console.log('INTELLIGENCE_NATIVE_PASS '+checks.length);
}catch(error){fs.writeFileSync(path.join(evidence,'failure-'+Date.now()+'.json'),JSON.stringify({status:'FAIL',phase,error:String(error),checks,matrix,profile,codex:page?(await snapshot().catch(()=>null))?.codex:null,body:page?await page.locator('body').innerText().catch(()=>null):null},null,2));throw error;}
finally{clearInterval(progress);await client?.close();await app?.close();}
