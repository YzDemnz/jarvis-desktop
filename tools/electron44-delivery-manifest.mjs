import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import asar from '@electron/asar';
import {externalPath} from './electron44-profile-metadata.mjs';

const repo=process.cwd(), base=externalPath('..');
const evidence=externalPath(process.env.JARVIS_MIGRATION_EVIDENCE_DIR??'docs/evidence/electron44-20261011');
const read=file=>JSON.parse(fs.readFileSync(file,'utf8'));
const git=(...args)=>{const result=spawnSync('git',args,{encoding:'utf8',windowsHide:true});assert.equal(result.status,0,result.stderr);return result.stdout.trim();};
const productCommit=process.env.JARVIS_PRODUCT_COMMIT; assert.match(productCommit??'',/^[0-9a-f]{40}$/);
const pkg=read('package.json'), before=read(path.join(evidence,'owner-before.json')), owner=read(path.join(evidence,'owner-installed.json'));
const assurance=read(path.join(evidence,'assurance-packaged/result.json'));
const benchmarkFile=externalPath(process.env.JARVIS_FINAL_BENCHMARK_RESULT), benchmark=read(benchmarkFile);
const workflow=read(path.join(evidence,'workflow-packaged/result.json'));
const conciliusFile=externalPath(process.env.JARVIS_CONCILIUS_RESULT??path.join(evidence,'concilius-basic-packaged-resumed-20261021/result.json'));
const concilius=read(conciliusFile);
assert.equal(assurance.status,'PASS'); assert.equal(assurance.host.packaged,true);
assert.equal(assurance.host.electron,pkg.devDependencies.electron); assert.equal(assurance.host.version,pkg.version);
assert.equal(workflow.status,'PASS'); assert.equal(workflow.packaged,true); assert.equal(workflow.version,pkg.version);
assert.equal(concilius.status,'PASS');assert.equal(concilius.host.packaged,true);assert.equal(concilius.host.version,pkg.version);assert.equal(concilius.host.electron,pkg.devDependencies.electron);
assert.equal(concilius.graph.state,'VERIFIED');assert.deepEqual(concilius.graph.nodes.map(node=>node.state),['VERIFIED','VERIFIED','ADVISORY']);
assert.equal(concilius.stoppedGraph.state,'STOPPED');assert.equal(concilius.paidApiCalls,0);assert.equal(concilius.ownerProfileTouched,false);
assert.equal(benchmark.status,'COMPLETED'); assert.equal(benchmark.completedCases,3); assert.equal(benchmark.host.packaged,true);
assert.equal(benchmark.host.version,pkg.version); assert.equal(benchmark.host.electron,pkg.devDependencies.electron);
assert.equal(benchmark.productSourceCommit,productCommit);
assert.equal(owner.status,'VERIFIED_OWNER_STARTUP'); assert.equal(owner.host.version,pkg.version);
assert.equal(owner.host.fixture,null); assert.equal(owner.policy.allowPaidApi,false); assert.equal(owner.policy.allowPaidFallback,false);
assert.deepEqual(owner.stats,before.stats); assert.deepEqual(owner.tables,before.tables);
const productRoots=['src','electron','native','package.json','package-lock.json','vite.config.ts','tools/native-helper-artifacts.json','tools/prepare-native-helpers.mjs','tools/check-portable-electron.mjs'];
assert.equal(git('diff','--name-only',productCommit,'--',...productRoots),'','SOURCE_CHANGED_AFTER_PRODUCT_COMMIT');
assert.equal(git('ls-files','--others','--exclude-standard','--',...productRoots),'','UNTRACKED_PRODUCT_SOURCE');
const installed=externalPath('../App instalada'), archive=path.join(installed,'resources/app.asar');
const executableIdentity=read(path.join(installed,'portable-electron-proof.json'));
assert.equal(executableIdentity.status,'VERIFIED_UPSTREAM_EXECUTABLE_IDENTITY');
assert.equal(executableIdentity.fusesChanged,false);assert.equal(executableIdentity.windowsPolicyChanged,false);
const compiledMainSha256=createHash('sha256').update(fs.readFileSync('dist-electron/main.js')).digest('hex');
for(const observed of [benchmark.host,workflow.host,owner.host,concilius.host])assert.equal(observed.compiledMainSha256,compiledMainSha256,'EVIDENCE_FROM_ANOTHER_COMPILED_MAIN');
assert.equal(JSON.parse(asar.extractFile(archive,'package.json')).version,pkg.version);
function walk(dir){return fs.readdirSync(dir,{withFileTypes:true}).flatMap(entry=>entry.isDirectory()?walk(path.join(dir,entry.name)):[path.join(dir,entry.name)]);}
const compiled=[...walk('dist'),...walk('dist-electron')].filter(file=>!file.endsWith('.map'));
// @electron/asar resolves archive directories using the host path separator.
// On Windows a forced POSIX slash falsely reports an existing asset missing.
for(const file of compiled) assert.equal(asar.extractFile(archive,path.normalize(file)).compare(fs.readFileSync(file)),0,'PACKAGED_COMPILED_BYTES_MISMATCH '+file);
const nativeRelative='resources/app.asar.unpacked/node_modules/better-sqlite3/prebuilds/win32-x64.node';
assert.deepEqual(fs.readFileSync(path.join(installed,nativeRelative)),fs.readFileSync('node_modules/better-sqlite3/prebuilds/win32-x64.node'));
const digest=async file=>{const absolute=externalPath(file), hash=createHash('sha256');for await(const chunk of fs.createReadStream(absolute))hash.update(chunk);return {path:absolute,bytes:fs.statSync(absolute).size,sha256:hash.digest('hex')};};
const fingerprints=[];
for(const relative of ['JARVIS.exe','resources/app.asar',nativeRelative,'resources/native/jarvis-process-host.exe','resources/native/jarvis-automation-helper.exe'])fingerprints.push(await digest(path.join(installed,relative)));
assert.equal(fingerprints[0].sha256,executableIdentity.sha256);
assert.equal((await digest('node_modules/electron/dist/electron.exe')).sha256,executableIdentity.sha256);
const nativeArtifacts=read('tools/native-helper-artifacts.json');
for(const entry of nativeArtifacts.files)assert.equal(fingerprints.find(file=>file.path===path.join(installed,'resources/native',entry.name))?.sha256,entry.sha256);
const sources=[];for(const file of git('ls-files','--',...productRoots).split(/\r?\n/).filter(Boolean))sources.push(await digest(file));
const proofs=[];for(const file of ['entry.json','assurance-packaged/result.json','workflow-packaged/result.json','owner-before.json','owner-installed.json'])proofs.push(await digest(path.join(evidence,file)));
proofs.push(await digest(benchmarkFile));
proofs.push(await digest(conciliusFile));
const previousApp=externalPath(process.env.JARVIS_PREVIOUS_APP);assert.ok(fs.existsSync(path.join(previousApp,'JARVIS.exe')));
const manifest={status:'VERIFIED_PORTABLE_DELIVERY',at:new Date().toISOString(),version:pkg.version,electron:pkg.devDependencies.electron,
  sqlite:{package:pkg.dependencies['better-sqlite3'],binding:'NODE_API_PREBUILT',abi:owner.host.abi,schema:owner.stats.schema,actualPackagedStartup:true},
  repository:repo,branch:git('branch','--show-current'),productSourceCommit:productCommit,installed,ownerProfile:owner.host.profile,
  ownerStats:owner.stats,allOwnerHistoryHashesUnchanged:true,allNewFilesWithin:'E:\\CODEX',
  assurances:assurance.checks.length,workflowChecks:workflow.checks.length,
  concilius:{state:concilius.graph.state,checks:concilius.checks.length,models:concilius.realModels,result:conciliusFile,scope:'Explicit bounded local graph; critic advisory; not general autonomous coordination or external vendor verification'},
  codingBenchmark:{cases:benchmark.completedCases,verified:benchmark.verified,failedOrUnverified:benchmark.failedOrUnverified,result:benchmarkFile,
    scope:benchmark.scope,criteriaAuthor:benchmark.criteriaAuthor},
  localModel:owner.bootstrap,executableIdentity:{sha256:executableIdentity.sha256,fusesChanged:false,windowsPolicyChanged:false},nativeArtifacts:{kind:nativeArtifacts.kind,sourceCommit:nativeArtifacts.sourceCommit,nativeTree:nativeArtifacts.nativeTree},paidCalls:0,paidApiAllowed:false,paidFallbackAllowed:false,
  backups:{app:previousApp,database:before.backup},compiledFilesCompared:compiled.length,fingerprints,sources,proofs,
  limits:['Checks certify their frozen owned cases and bounded snapshots, not general coding autonomy',
    'FULL_NATIVE is not operating-system isolation for hostile code','External inference and general application workflows are not verified by this delivery','Concilius is verified only for the explicit bounded local graph; external specialists and general planning remain unverified']};
fs.writeFileSync(path.join(evidence,'delivery-manifest.json'),JSON.stringify(manifest,null,2));
fs.writeFileSync(path.join(base,'Verificacion-paquete.json'),JSON.stringify(manifest,null,2));
console.log('ELECTRON44_DELIVERY_MANIFEST_PASS '+sources.length+' sources, '+compiled.length+' packaged compiled files');
