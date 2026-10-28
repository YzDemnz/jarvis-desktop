import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import asar from '@electron/asar';
import {externalPath} from './electron44-profile-metadata.mjs';
const evidence=externalPath('docs/evidence/intelligence-bridge-20261022'),read=file=>JSON.parse(fs.readFileSync(file,'utf8'));
const pkg=read('package.json'),native=read(path.join(evidence,'native-final/result.json')),assurance=read(path.join(evidence,'assurance-installed/result.json')),owner=read(path.join(evidence,'owner-installed.json')),before=read(path.join(evidence,'owner-current/owner-before.json'));
const git=(...args)=>{const r=spawnSync('git',args,{encoding:'utf8',windowsHide:true});assert.equal(r.status,0,r.stderr);return r.stdout.trim();};
const productCommit=process.env.JARVIS_PRODUCT_COMMIT;assert.match(productCommit??'',/^[a-f0-9]{40}$/);
for(const record of [native,assurance])assert.equal(record.status,'PASS');assert.equal(native.checks.length,8);assert.equal(assurance.checks.length,13);assert.equal(native.matrix.length,8);
assert.equal(native.localHost.last.state,'PRODUCED');assert.equal(native.localHost.last.intelligence,'qwen3.5:2b');assert.equal(native.codex.protocolVerified,true);
const ownerIntelligence=read(path.join(evidence,'owner-intelligence.json'));assert.equal(ownerIntelligence.status,'VERIFIED_OWNER_CONFIGURATION');assert.equal(ownerIntelligence.dailyModel,'qwen2.5:3b-instruct');assert.equal(ownerIntelligence.mcpModel,'qwen3.5:2b');assert.equal(owner.status,'VERIFIED_OWNER_STARTUP');assert.deepEqual(owner.tables,before.tables);assert.deepEqual(owner.stats,before.stats);assert.equal(owner.host.fixture,null);
assert.equal(owner.policy.allowPaidApi,false);assert.equal(owner.policy.allowPaidFallback,false);
const installed=externalPath('../App instalada'),archive=path.join(installed,'resources/app.asar'),identity=read(path.join(installed,'portable-electron-proof.json'));
const hash=bytes=>createHash('sha256').update(bytes).digest('hex'),compiledMainSha256=hash(fs.readFileSync('dist-electron/main.js'));
for(const host of [native.host,assurance.host,owner.host]){assert.equal(host.version,pkg.version);assert.equal(host.packaged,true);assert.equal(host.electron,pkg.devDependencies.electron);assert.equal(host.compiledMainSha256,compiledMainSha256);}
assert.equal(identity.status,'VERIFIED_UPSTREAM_EXECUTABLE_IDENTITY');assert.equal(identity.fusesChanged,false);assert.equal(identity.windowsPolicyChanged,false);
assert.equal(JSON.parse(asar.extractFile(archive,'package.json')).version,pkg.version);
const walk=directory=>fs.readdirSync(directory,{withFileTypes:true}).flatMap(entry=>entry.isDirectory()?walk(path.join(directory,entry.name)):[path.join(directory,entry.name)]);
const compiled=[...walk('dist'),...walk('dist-electron')].filter(f=>!f.endsWith('.map'));
for(const file of compiled)assert.deepEqual(asar.extractFile(archive,path.normalize(file)),fs.readFileSync(file));
assert.deepEqual(fs.readFileSync(path.join(installed,'resources/bridge/jarvis-mcp.cjs')),fs.readFileSync('dist-bridge/jarvis-mcp.cjs'));
const roots=['src','electron','native','package.json','package-lock.json','vite.config.ts','tools/native-helper-artifacts.json','tools/prepare-native-helpers.mjs','tools/check-portable-electron.mjs','tools/build-bridge.mjs'];
assert.equal(git('diff','--name-only',productCommit,'--',...roots),'','SOURCE_CHANGED_AFTER_COMMIT');assert.equal(git('ls-files','--others','--exclude-standard','--',...roots),'','UNTRACKED_PRODUCT_SOURCE');
const digest=async file=>{const absolute=externalPath(file),h=createHash('sha256');for await(const chunk of fs.createReadStream(absolute))h.update(chunk);return {path:absolute,bytes:fs.statSync(absolute).size,sha256:h.digest('hex')};};
const fingerprints=[];for(const file of ['JARVIS.exe','resources/app.asar','resources/bridge/jarvis-mcp.cjs','resources/app.asar.unpacked/node_modules/better-sqlite3/prebuilds/win32-x64.node','resources/native/jarvis-process-host.exe','resources/native/jarvis-automation-helper.exe'])fingerprints.push(await digest(path.join(installed,file)));
assert.deepEqual(fs.readFileSync(path.join(installed,'resources/app.asar.unpacked/node_modules/better-sqlite3/prebuilds/win32-x64.node')),fs.readFileSync('node_modules/better-sqlite3/prebuilds/win32-x64.node'));assert.equal(fingerprints[0].sha256,identity.sha256);assert.equal((await digest('node_modules/electron/dist/electron.exe')).sha256,identity.sha256);
const artifacts=read('tools/native-helper-artifacts.json');for(const entry of artifacts.files)assert.equal(fingerprints.find(f=>path.basename(f.path)===entry.name).sha256,entry.sha256);
const cli=await digest('../Dependencias/Herramientas/Claude/claude.exe');assert.equal(cli.sha256,'0e4195524b73eb77efbdf3e2b36de5322a29f0ca575dfd2d9b4f946b1d425469');fingerprints.push(cli);
const provision=read(path.join(evidence,'provision-combined.json'));assert.equal(provision.records.length,4);assert.ok(provision.records.every(r=>r.receipt.state==='VERIFIED'));externalPath(provision.store);
const sources=[];for(const file of git('ls-files','--',...roots).split(/\r?\n/).filter(Boolean))sources.push(await digest(file));
const proofPaths=['native-final/frozen.json','native-final/result.json','assurance-installed/result.json','provision-combined.json','model-manifests-frozen.json','sdk-bundle-analysis.json','owner-before.json','owner-current/owner-before.json','owner-delta-before-delivery.json','owner-installed.json','owner-intelligence.json','audit-production.json','audit-all.json','contracts-supported-schema.log','regression-final.log','qwen-stable-manifest.json','native-schema/frozen-schema-first.json','native-schema/matrix-schema-first.json'];
const proofs=[];for(const file of proofPaths)proofs.push(await digest(path.join(evidence,file)));
const quality=Object.fromEntries(provision.records.map(r=>{const runs=native.matrix.filter(m=>m.model===r.model);return [r.model,{arithmetic:'VERIFIED',followupCases:runs.length,passed:runs.filter(m=>m.qualityCase==='PASS').length,structurallyVerified:runs.filter(m=>m.graph.state==='VERIFIED').length,scope:'Finite frozen cases; not general factual or coding quality'}];}));
assert.equal(quality['qwen2.5:3b-instruct'].passed,2);
const manifest={status:'VERIFIED_PORTABLE_DELIVERY',version:pkg.version,at:new Date().toISOString(),repository:process.cwd(),branch:git('branch','--show-current'),productSourceCommit:productCommit,compiledMainSha256,installed,allNewFilesWithin:'E:\\CODEX',ownerProfile:owner.host.profile,ownerStats:owner.stats,allOwnerRowsUnchangedDuringVerification:true,baselineFile:path.join(evidence,'owner-current/owner-before.json'),initialSnapshotDelta:read(path.join(evidence,'owner-delta-before-delivery.json')),
  architecture:'JARVIS-owned bootstrap/authority/journal/effects; official App Server specialist and task-scoped MCP context/proposals',
  localModels:quality,modelStore:provision.store,dailyModel:'qwen2.5:3b-instruct',mcpModel:'qwen3.5:2b',localHost:{status:'OPERATIVE_FOR_OBSERVED_TASK',runtime:'Claude Code 2.1.280',intelligence:'qwen3.5:2b',anthropicClaudeInference:'NOT_TESTED',verification:'UNVERIFIED_PROPOSALS',elapsedMs:native.localHost.last.elapsedMs},
  codex:{status:native.codex.status,protocol:'TESTED',inference:native.codex.status==='AUTH_REQUIRED'?'BLOCKED_AUTH_REQUIRED':'UNKNOWN',catalogIsEntitlement:false},
  evidence:{nativeChecks:native.checks.length,platformChecks:assurance.checks.length,comparisonRuns:native.matrix.length,ownerTestTasks:0,paidApiCalls:0,compiledFilesCompared:compiled.length,sidecarCompared:true},
  sqlite:{version:pkg.dependencies['better-sqlite3'],binding:'NODE_API_PREBUILT',abi:owner.host.abi,schema:owner.stats.schema},executableIdentity:identity,nativeArtifacts:artifacts,
  audit:{production:read(path.join(evidence,'audit-production.json')).metadata.vulnerabilities,allDependencies:read(path.join(evidence,'audit-all.json')).metadata.vulnerabilities,selectedSdkBundle:read(path.join(evidence,'sdk-bundle-analysis.json'))},
  codingQuality:{status:'NOT_RETESTED',historicalVerified:0,historicalCases:3,reason:'No general coding competence is inferred from followup or MCP transport checks'},
  backups:{database:before.backup,application:externalPath('E:/CODEX/Historial/IntelligenceBridge-JARVIS-20261022/App-0.4.3-antes-de-conexiones')},
  limits:['Followup structure is verified separately from finite semantic case checks','Model proposals can hallucinate and do not authorize effects','Claude Code harness with local Qwen is not Claude cloud intelligence','External apps must support MCP; MCP does not universally expose their model','Cold starts can approach 90 seconds; an initial native host timeout remains unexplained','No paid API inference or unsupported session reuse','No general autonomous programming or full-device index is demonstrated'],fingerprints,sources,proofs};
assert.ok(fs.existsSync(path.join(manifest.backups.application,'JARVIS.exe')));fs.writeFileSync(path.join(evidence,'delivery-manifest.json'),JSON.stringify(manifest,null,2));fs.writeFileSync(externalPath('../Verificacion-paquete.json'),JSON.stringify(manifest,null,2));
console.log('INTELLIGENCE_DELIVERY_MANIFEST_PASS '+sources.length+' sources '+compiled.length+' compiled files');
