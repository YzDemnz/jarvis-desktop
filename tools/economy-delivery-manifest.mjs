import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import asar from '@electron/asar';
import {externalPath} from './electron44-profile-metadata.mjs';

const evidence=externalPath(process.env.JARVIS_ECONOMY_EVIDENCE??'docs/evidence/economy-concilius-20261021');
const read=file=>JSON.parse(fs.readFileSync(file,'utf8'));
const git=(...args)=>{const result=spawnSync('git',args,{encoding:'utf8',windowsHide:true});assert.equal(result.status,0,result.stderr);return result.stdout.trim();};
const productCommit=process.env.JARVIS_PRODUCT_COMMIT;assert.match(productCommit??'',/^[0-9a-f]{40}$/);
const pkg=read('package.json'),before=read(path.join(evidence,'owner-before.json')),owner=read(path.join(evidence,'owner-installed.json'));
const assurance=read(path.join(evidence,'assurance/result.json')),workflow=read(path.join(evidence,'workflow/result.json')),native=read(path.join(evidence,'native/result.json'));
const templates=read(path.join(evidence,'templates/result.json'));
assert.equal(templates.status,'PASS');assert.equal(templates.checks.length,3);assert.ok(templates.checks.every(c=>c.status==='PASS'));
assert.equal(templates.paidApiCalls,0);assert.equal(templates.ownerProfileTouched,false);
assert.equal(templates.host.version,pkg.version);assert.equal(templates.host.packaged,true);assert.equal(templates.host.electron,pkg.devDependencies.electron);
assert.equal(assurance.status,'PASS');assert.equal(assurance.checks.length,13);assert.ok(assurance.checks.every(c=>c.state==='VERIFIED'));
assert.equal(workflow.status,'PASS');assert.equal(workflow.checks.length,10);assert.equal(workflow.packaged,true);assert.equal(workflow.version,pkg.version);
assert.equal(native.status,'PASS');assert.ok(native.checks.length>=12);assert.ok(native.checks.every(c=>c.status==='PASS'));
assert.equal(native.graph.state,'VERIFIED');assert.deepEqual(native.graph.nodes.map(n=>n.state),['VERIFIED','VERIFIED','ADVISORY']);
assert.equal(native.organized.state,'VERIFIED');assert.deepEqual(native.organized.nodes.map(n=>n.state),['VERIFIED','ADVISORY']);
assert.equal(native.organized.organization.classificationModelCalls,0);assert.equal(native.organized.organization.plannedInferenceCalls,2);
assert.equal(native.organized.organization.automaticPaidFallback,false);
const contextUsage=native.organized.nodes[1].contextUsage;
assert.equal(contextUsage.policy,'DEPENDENCIES_ONLY');assert.equal(contextUsage.measurement,'CHARACTERS_NOT_BILLED_TOKENS');assert.ok(contextUsage.avoidedChars>0);
assert.equal(native.stoppedGraph.state,'STOPPED');assert.equal(native.paidApiCalls,0);assert.equal(native.ownerProfileTouched,false);
assert.equal(owner.status,'VERIFIED_OWNER_STARTUP');assert.equal(owner.host.fixture,null);
assert.equal(owner.policy.allowPaidApi,false);assert.equal(owner.policy.allowPaidFallback,false);assert.deepEqual(owner.stats,before.stats);assert.deepEqual(owner.tables,before.tables);
for(const host of [assurance.host,native.host,owner.host]) {assert.equal(host.packaged,true);assert.equal(host.version,pkg.version);assert.equal(host.electron,pkg.devDependencies.electron);}
const roots=['src','electron','native','package.json','package-lock.json','vite.config.ts','tools/native-helper-artifacts.json','tools/prepare-native-helpers.mjs','tools/check-portable-electron.mjs'];
assert.equal(git('diff','--name-only',productCommit,'--',...roots),'','SOURCE_CHANGED_AFTER_PRODUCT_COMMIT');assert.equal(git('ls-files','--others','--exclude-standard','--',...roots),'','UNTRACKED_PRODUCT_SOURCE');
const installed=externalPath('../App instalada'),archive=path.join(installed,'resources/app.asar'),identity=read(path.join(installed,'portable-electron-proof.json'));
assert.equal(identity.status,'VERIFIED_UPSTREAM_EXECUTABLE_IDENTITY');assert.equal(identity.fusesChanged,false);assert.equal(identity.windowsPolicyChanged,false);
const hash=bytes=>createHash('sha256').update(bytes).digest('hex'),compiledMainSha256=hash(fs.readFileSync('dist-electron/main.js'));
for(const host of [workflow.host,native.host,templates.host,owner.host])assert.equal(host.compiledMainSha256,compiledMainSha256,'EVIDENCE_FROM_ANOTHER_COMPILED_MAIN');
assert.equal(JSON.parse(asar.extractFile(archive,'package.json')).version,pkg.version);
function walk(dir){return fs.readdirSync(dir,{withFileTypes:true}).flatMap(entry=>entry.isDirectory()?walk(path.join(dir,entry.name)):[path.join(dir,entry.name)]);}
const compiled=[...walk('dist'),...walk('dist-electron')].filter(file=>!file.endsWith('.map'));
for(const file of compiled)assert.equal(asar.extractFile(archive,path.normalize(file)).compare(fs.readFileSync(file)),0,'PACKAGED_COMPILED_BYTES_MISMATCH '+file);
const sqlite='resources/app.asar.unpacked/node_modules/better-sqlite3/prebuilds/win32-x64.node';
assert.deepEqual(fs.readFileSync(path.join(installed,sqlite)),fs.readFileSync('node_modules/better-sqlite3/prebuilds/win32-x64.node'));
const digest=async file=>{const absolute=externalPath(file),h=createHash('sha256');for await(const chunk of fs.createReadStream(absolute))h.update(chunk);return {path:absolute,bytes:fs.statSync(absolute).size,sha256:h.digest('hex')};};
const fingerprints=[];for(const file of ['JARVIS.exe','resources/app.asar',sqlite,'resources/native/jarvis-process-host.exe','resources/native/jarvis-automation-helper.exe'])fingerprints.push(await digest(path.join(installed,file)));
assert.equal(fingerprints[0].sha256,identity.sha256);assert.equal((await digest('node_modules/electron/dist/electron.exe')).sha256,identity.sha256);
const artifacts=read('tools/native-helper-artifacts.json');for(const entry of artifacts.files)assert.equal(fingerprints.find(file=>file.path===path.join(installed,'resources/native',entry.name))?.sha256,entry.sha256);
const previousApp=externalPath(process.env.JARVIS_PREVIOUS_APP);assert.ok(fs.existsSync(path.join(previousApp,'JARVIS.exe')));
const previousManifest=read(externalPath(process.env.JARVIS_PREVIOUS_MANIFEST));assert.equal(previousManifest.version,'0.4.2-dev');assert.equal(previousManifest.codingBenchmark.verified,0);
const sources=[];for(const file of git('ls-files','--',...roots).split(/\r?\n/).filter(Boolean))sources.push(await digest(file));
const proofs=[];for(const file of ['entry.json','assurance/result.json','workflow/result.json','native/result.json','native/organization-result.json','templates/result.json','owner-before.json','owner-installed.json'])proofs.push(await digest(path.join(evidence,file)));
const manifest={status:'VERIFIED_PORTABLE_DELIVERY',at:new Date().toISOString(),version:pkg.version,electron:pkg.devDependencies.electron,
  repository:process.cwd(),branch:git('branch','--show-current'),productSourceCommit:productCommit,compiledMainSha256,installed,ownerProfile:owner.host.profile,
  sqlite:{package:pkg.dependencies['better-sqlite3'],binding:'NODE_API_PREBUILT',abi:owner.host.abi,schema:owner.stats.schema,actualPackagedStartup:true},
  ownerStats:owner.stats,allOwnerHistoryHashesUnchanged:true,allNewFilesWithin:'E:\\CODEX',assurances:assurance.checks.length,workflowChecks:workflow.checks.length,
  concilius:{checks:native.checks.length,models:native.realModels,state:native.organized.state,organization:native.organized.organization,contextUsage,readRequestMs:native.directReadMs,result:path.join(evidence,'native/result.json'),scope:native.limits},
  templates:{checks:templates.checks.length,observedInferenceCalls:templates.records.map(record=>({kind:record.fixture.kind,inferences:record.checkpoint.operations.length})),result:path.join(evidence,'templates/result.json'),scope:templates.scope},
  codingQuality:{status:'NOT_RETESTED',previousVersion:previousManifest.version,previousVerified:0,previousCases:3,previousResult:previousManifest.codingBenchmark.result,reason:'No coding proposal/model improvement is claimed; small coding workflow regression tested separately'},
  localModel:owner.bootstrap,executableIdentity:identity,nativeArtifacts:{kind:artifacts.kind,sourceCommit:artifacts.sourceCommit,nativeTree:artifacts.nativeTree},
  paidCalls:0,paidApiAllowed:false,paidFallbackAllowed:false,backups:{app:previousApp,database:before.backup},compiledFilesCompared:compiled.length,fingerprints,sources,proofs,
  limits:['Device reads cover text on accessible local drives; bounded search is partial and not a complete device index','Organization templates are deterministic and bounded; JSON shape is not semantic correctness','Criticism is advisory; no model controls bootstrap or authorizes effects','External API availability and free quotas remain unverified','Character reduction does not claim measured token billing or general speedup','Historical hard coding benchmark remains 0/3; no claim of general coding autonomy']};
fs.writeFileSync(path.join(evidence,'delivery-manifest.json'),JSON.stringify(manifest,null,2));fs.writeFileSync(externalPath('../Verificacion-paquete.json'),JSON.stringify(manifest,null,2));
console.log('ECONOMY_DELIVERY_MANIFEST_PASS '+sources.length+' sources; '+compiled.length+' compiled files');
