import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import asarTools from '@electron/asar';
const entry = '83e4a80ff934b16fccc82401cd01c69bb5045471';
const root = path.resolve('docs/evidence/s41'), destination = path.join(root, 'delivery-manifest.json');
if (fs.existsSync(destination)) throw Error('Do not rewrite an existing delivery manifest');
const git = args => { const r = spawnSync('git', args, { encoding: 'utf8', maxBuffer: 30 * 1024 * 1024 }); if (r.status !== 0) throw Error('GIT_AUDIT_FAILED'); return r.stdout.trim(); };
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const hashFile = async file => { const h = createHash('sha256'); for await (const bytes of fs.createReadStream(file, { highWaterMark: 4 * 1024 * 1024 })) h.update(bytes); return h.digest('hex'); };
const stage = process.env.JARVIS_S41_PACKAGE_STAGE ?? 'observed-main';
const packaged = JSON.parse(fs.readFileSync(path.join(root, stage, 'summary.json')));
const core = JSON.parse(fs.readFileSync(path.join(root, 'final-admission', 'summary.json')));
const requirePass = (summary, scripts) => { if (scripts.some(script => !summary.records.some(r => r.script === script && r.status === 'PASS'))) throw Error('VALIDATION_INCOMPLETE_' + summary.stage); };
requirePass(packaged, ['test:windows-s41']);
requirePass(core, ['build:dir', 'test:windows-s4', 'test:windows-s3', 'test:windows-s2', 'test:windows-continuity', 'test:windows-ownership']);
requirePass(core, ['typecheck', 'test:s41', 'test:s4', 'test:s3', 'test:s2', 'test:north-star', 'test:renderer', 'test:portable-electron']);
// The final retry changed the observer and pure fixture grammar only; package
// and product source remain the exact version built/tested in final-admission.
const testOnlyChanges = git(['diff', '--name-only', core.headAtTest, packaged.headAtTest]).split('\n').filter(Boolean);
if (testOnlyChanges.length !== 2 || testOnlyChanges.some(f => !['tests/windows/s41-cross-surface-runtime.test.mjs', 'tests/windows/s41-invoice-verifier.mjs'].includes(f))) throw Error('PRODUCT_COMMIT_MISMATCH');
const runtime = JSON.parse(fs.readFileSync(path.join(root, stage, 's41-runtime.json')));
if (runtime.status !== 'PASS' || runtime.checks.length !== 11 || runtime.first.taskId !== runtime.next.taskId || runtime.first.operationId === runtime.next.operationId
  || runtime.first.providerId !== 'ollama-local' || runtime.next.providerId !== 'llama-cpp-local' || runtime.paidApiCalls !== 0
  || runtime.artifact.noReplayOSEvents !== 0 || JSON.stringify(runtime.workVerification.results) !== '[29,0,14]'
  || runtime.checkpoint.operations.find(o => o.operationId === runtime.next.operationId)?.provenance?.ownership !== 'WINDOWS_JOB') throw Error('VERTICAL_PROOF_INCOMPLETE');
const auditArtifactCopies = [];
for (const [effect, expected, name] of [[runtime.original.effect, runtime.artifact.oldHash, 'audit-normalized.json'], [runtime.finalArtifact.effect, runtime.finalArtifact.effect.sha256, 'audit-invoice.generated.js']]) {
  if (await hashFile(effect.file) !== expected) throw Error('VERIFIED_ARTIFACT_CHANGED');
  const copy = path.join(root, stage, name);
  // Audit copy outside the task profile; not a replay of its settled effect.
  if (!fs.existsSync(copy)) fs.copyFileSync(effect.file, copy, fs.constants.COPYFILE_EXCL);
  if (await hashFile(copy) !== expected) throw Error('AUDIT_ARTIFACT_COPY_CHANGED');
  auditArtifactCopies.push({ source: effect.file, file: copy, sha256: expected, taskEffectReexecuted: false });
}
const copiesFile = path.join(root, stage, 'audit-artifacts.json');
const copiesBytes = JSON.stringify({ scope: 'Audit copies outside task profile, not reexecuted product effects', copies: auditArtifactCopies }, null, 2) + '\n';
if (!fs.existsSync(copiesFile)) fs.writeFileSync(copiesFile, copiesBytes, { flag: 'wx' });
else if (fs.readFileSync(copiesFile, 'utf8') !== copiesBytes) throw Error('PRESERVE_EXISTING_AUDIT_COPIES');
const protectedRefs = { 'codex/execution-fabric-ef2': 'c9e19747be0b130e338f47d049b4b5da772474c3', 'codex/north-star-first-slice': 'c6f8086ad6d512f48339164a0f88dab9fa88e7e8', 'codex/s2-authority-realignment': '43f2239586677abf87a755ad65c14e5f60847b5f', 'codex/s3-connected-ai': '3a30093d40be8a7a4e97a1240467ace938aec2cd', 'codex/s4-task-continuity': entry };
for (const [ref, sha] of Object.entries(protectedRefs)) if (git(['rev-parse', ref]) !== sha) throw Error('PROTECTED_REF_CHANGED');
const historical = git(['ls-tree', '-r', entry, 'docs/evidence']).split('\n').filter(Boolean).map(line => { const [meta, file] = line.split('\t'); return { file, gitObject: meta.split(' ')[2] }; });
const objects = spawnSync('git', ['hash-object', '--stdin-paths'], { input: historical.map(r => JSON.stringify(r.file)).join('\n') + '\n', encoding: 'utf8', maxBuffer: 30 * 1024 * 1024 });
if (objects.status !== 0 || objects.stdout.trim().split('\n').some((object, i) => object !== historical[i]?.gitObject) || objects.stdout.trim().split('\n').length !== historical.length) throw Error('HISTORICAL_EVIDENCE_CHANGED');
const modelChecks = [];
const previous = JSON.parse(fs.readFileSync('docs/evidence/s3/delivery-manifest.json'));
for (const asset of previous.modelAssetChecks) { if (await hashFile(asset.file) !== asset.sha256) throw Error('EXISTING_MODEL_CHANGED'); modelChecks.push({ ...asset, unchangedFromS3: true }); }
const smol = JSON.parse(fs.readFileSync('docs/evidence/s4/provision-1-7b/result.json'));
for (const asset of smol.assets) {
  const file = path.join(smol.models, 'blobs', asset.digest.replace(':', '-')), sha256 = asset.digest.slice(7);
  if (await hashFile(file) !== sha256) throw Error('EXISTING_SMOL_MODEL_CHANGED');
  modelChecks.push({ file, sha256, unchangedFromS4: true });
}
const configFile = path.join(process.env.LOCALAPPDATA, 'JARVIS/runtimes/llama-cpp/b6500/qwen-runtime-cache.json'), config = JSON.parse(fs.readFileSync(configFile));
if (await hashFile(config.model.file) !== config.model.sha256) throw Error('CACHE_CHANGED');
const files = [], walk = dir => { for (const item of fs.readdirSync(dir, { withFileTypes: true })) { const file = path.join(dir, item.name); if (item.isDirectory()) walk(file); else files.push({ file: path.relative(process.cwd(), file).replaceAll('\\', '/'), sha256: hash(fs.readFileSync(file)) }); } }; walk(root);
const binary = path.resolve('release/win-unpacked/JARVIS.exe'), asar = path.resolve('release/win-unpacked/resources/app.asar');
const packagedMain = asarTools.extractFile(asar, 'dist-electron/main.js').toString();
if (!packagedMain.includes('qwen-runtime-cache.json') || !packagedMain.includes('jarvis.handoff.v2')
  || !packagedMain.includes('INPUT CONTEXT, not the requested answer') || !packagedMain.includes('JARVIS owns this new task.')) throw Error('STALE_PACKAGE_DENIED');
fs.writeFileSync(destination, JSON.stringify({ at: new Date().toISOString(), classification: 'S41_CROSS_SURFACE_VERIFIED_WITH_SCOPED_NO_REPLAY', entryCommit: entry, productCommit: packaged.headAtTest, branch: git(['branch', '--show-current']), coreChecks: core.records, packagedChecks: packaged.records, runtime: { taskId: runtime.taskId, checks: runtime.checks, firstOperationId: runtime.first.operationId, continuationOperationId: runtime.next.operationId, workVerification: runtime.workVerification, paidApiCalls: 0, artifact: runtime.artifact }, binary: { file: binary, sha256: await hashFile(binary), asar, asarSHA256: await hashFile(asar), installationReplaced: false }, protectedRefs, historicalPreservedCount: historical.length, historical, files, modelChecks, localRuntime: { configFile, release: config.release, model: config.model, assets: config.assets, auth: 'NOT_REQUIRED' }, limits: ['distinct HTTP daemon and CLI process lifecycle, not independent library/vendor', 'CLI inference only, not a native agent tool harness', 'semantic invoice verifier is test-owned, not universal product verification', 'no-replay covers typed artifact effects only', 'quota failure simulated; token and monetary accounting UNKNOWN for native runtime', 'same-user OS isolation, general run budgets, input/cursor and RunAsNode debt unchanged', 'no paid requests, no Concilius, no S5 implemented'] }, null, 2) + '\n');
console.log('S41_MANIFEST_PASS ' + historical.length + ' historical evidence files unchanged; ' + files.length + ' new evidence files hashed');
