import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {_electron} from 'playwright';
import {externalPath} from '../../tools/electron44-profile-metadata.mjs';

const evidence=externalPath('docs/evidence/economy-concilius-20261021/templates');fs.mkdirSync(evidence,{recursive:true});
assert.equal(fs.existsSync(path.join(evidence,'result.json')),false,'PRESERVE_TEMPLATE_PROOF');
const profile=fs.mkdtempSync(path.join(externalPath(os.tmpdir()),'jarvis-fabric-native-templates-'));
const cases=[{kind:'summary',text:'El proyecto Atlas se entrega el viernes.',review:false,markers:['Atlas','viernes']},
  {kind:'summary',text:'Project Cedar launches on Monday.',review:false,markers:['Cedar','lunes']},
  {kind:'tasks',text:'Compra arroz. Llama a Luis.',review:false,markers:['arroz','Luis']}];
fs.writeFileSync(path.join(evidence,'frozen-cases.json'),JSON.stringify({cases,criteriaAuthor:'Driver before inference; markers are observed case checks, not universal semantic verification'},null,2));
const records=[],checks=[];let app,page;
const wait=async predicate=>{const deadline=Date.now()+180000;while(!await predicate()){if(Date.now()>deadline)throw Error('TEMPLATE_WAIT_TIMEOUT');await new Promise(r=>setTimeout(r,100));}};
try{
  app=await _electron.launch({executablePath:externalPath(process.env.JARVIS_EXE??'../App instalada/JARVIS.exe'),env:{...process.env,JARVIS_ALLOW_FIXTURES:'1',JARVIS_TEST_USER_DATA:profile,JARVIS_BOOTSTRAP_ROOT:path.join(profile,'no-bootstrap-model')},timeout:180000});
  page=await app.firstWindow();page.setDefaultTimeout(60000);await page.getByRole('button',{name:'Home',exact:true}).waitFor();
  await page.evaluate(()=>localStorage.setItem('jarvis.firstRun',JSON.stringify({completed:true,version:1,permissionPreset:'FULL',sessionPolicy:'keep',localAIChoice:'skipped',fingerprint:null})));
  await page.reload();await page.getByRole('button',{name:'Settings',exact:true}).click();await page.getByRole('button',{name:'Proveedores de IA',exact:true}).click();await page.getByTestId('connected-ai').waitFor();
  for(const fixture of cases){
    const previous=await page.getByTestId('concilius-graph-id').innerText();
    await page.getByLabel('Tipo de tarea organizada').selectOption(fixture.kind);await page.getByLabel('Material para Concilius').fill(fixture.text);await page.locator('[data-org-review]').uncheck();
    await page.getByRole('button',{name:'Organizar y ejecutar',exact:true}).click();let id;
    await wait(async()=>{id=await page.getByTestId('concilius-graph-id').innerText();return id&&id!==previous;});
    await wait(async()=>{const g=await page.evaluate(id=>window.jarvis.connected.graphRead(id),id);return g&&g.state!=='STARTED';});
    const graph=await page.evaluate(id=>window.jarvis.connected.graphRead(id),id),checkpoint=await page.evaluate(id=>window.jarvis.connected.checkpoint(id),id);
    records.push({fixture,graph,checkpoint});fs.writeFileSync(path.join(evidence,'progress.json'),JSON.stringify(records,null,2));
    assert.equal(graph.state,'VERIFIED');assert.equal(graph.nodes.length,1);assert.equal(checkpoint.operations.length,1);assert.equal(checkpoint.operations[0].status,'SUCCESS');
    assert.equal(graph.organization.classificationModelCalls,0);assert.equal(graph.organization.plannedInferenceCalls,1);assert.equal(graph.plan.nodes[0].providerId,'ollama-local');
    const value=JSON.parse(checkpoint.operations[0].text)[fixture.kind==='summary'?'summary':'tasks'];
    if(fixture.kind==='summary')assert.equal(typeof value,'string');else assert.ok(Array.isArray(value)&&value.every(item=>typeof item==='string'));
    for(const marker of fixture.markers)assert.ok(JSON.stringify(value).toLowerCase().includes(marker.toLowerCase()),'FROZEN_CASE_MISSING_'+marker);
    checks.push({name:fixture.kind+' executes exactly one actual local inference and preserves frozen input markers',status:'PASS'});
  }
  const host=await app.evaluate(({app})=>({version:app.getVersion(),packaged:app.isPackaged,electron:process.versions.electron,compiledMainSha256:process.getBuiltinModule('crypto').createHash('sha256').update(process.getBuiltinModule('fs').readFileSync(app.getAppPath()+'/dist-electron/main.js')).digest('hex')}));
  assert.equal(host.version,'0.4.3-dev');assert.equal(host.packaged,true);
  fs.writeFileSync(path.join(evidence,'result.json'),JSON.stringify({status:'PASS',at:new Date().toISOString(),host,checks,records,profile,paidApiCalls:0,ownerProfileTouched:false,scope:'Three owned common-task fixtures; summaries follow Spanish app locale; one local inference each, not general semantic correctness'},null,2));
  console.log('ECONOMY_TEMPLATES_PASS '+checks.length);
}catch(error){fs.writeFileSync(path.join(evidence,'failure-'+Date.now()+'.json'),JSON.stringify({status:'FAIL',error:String(error),records,profile,body:page?await page.locator('body').innerText().catch(()=>null):null},null,2));throw error;}
finally{if(app)await app.close();}
