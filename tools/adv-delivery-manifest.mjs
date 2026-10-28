import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import asarTools from '@electron/asar';

const entry = '756e5450b4494750d3868335cf9e04cb96017f55';
const root = path.resolve('docs/evidence/adv'), target = path.join(root, 'delivery-manifest.json');
if (fs.existsSync(target)) throw Error('PRESERVE_EXISTING_MANIFEST');
const git = args => { const r = spawnSync('git', args, { encoding: 'utf8', maxBuffer: 30 * 1024 * 1024 }); if (r.status !== 0) throw Error('GIT_AUDIT_FAILED'); return r.stdout.trim(); };
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const hashFile = async file => { const h = createHash('sha256'); for await (const b of fs.createReadStream(file)) h.update(b); return h.digest('hex'); };
const load = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const packaged = load(path.join(root, process.env.JARVIS_ADV_PACKAGE_STAGE ?? 'packaged-corrected', 'summary.json'));
const core = load(path.join(root, 'frozen-regression', 'summary.json'));
const requirePass = (s, scripts) => { for (const script of scripts) if (!s.records.some(r => r.script === script && r.status === 'PASS')) throw Error('MISSING_PASS_' + s.stage + '_' + script); };
requirePass(packaged, ['typecheck', 'test:adv', 'build:dir', 'test:windows-adv', 'test:windows-s41', 'test:windows-s4', 'test:windows-s3', 'test:windows-s2', 'test:windows-continuity', 'test:windows-ownership']);
requirePass(core, ['test:north-star', 'test:s2', 'test:s3', 'test:s4', 'test:s41', 'test:renderer', 'test:portable-electron']);
if (packaged.headAtTest !== core.headAtTest || git(['diff', '--name-only', packaged.headAtTest, '--', 'src', 'electron', 'native', 'package.json', 'package-lock.json'])) throw Error('SOURCE_CHANGED_AFTER_BUILD');
const runtime = load(path.join(root, packaged.stage, 'advancement-runtime.json'));
if (runtime.status !== 'PASS' || runtime.checks.length !== 9 || runtime.checks.some(c => c.status !== 'PASS') || runtime.paidApiCalls !== 0
  || runtime.graph.state !== 'VERIFIED' || JSON.stringify(runtime.graph.nodes.map(n => n.state)) !== '["VERIFIED","VERIFIED","ADVISORY"]'
  || runtime.graph.nodes[1].verification.verifierVersion !== 2 || runtime.graph.nodes[2].verification.state !== 'INCONCLUSIVE'
  || runtime.checkpoint.operations.length !== 3 || new Set(runtime.checkpoint.operations.map(o => o.operationId)).size !== 3
  || runtime.stoppedGraph.state !== 'STOPPED' || runtime.memory.references.length !== 1 || runtime.route.audit.selectedProviderId !== 'llama-cpp-local') throw Error('VERTICAL_PROOF_INCOMPLETE');
const effect = runtime.artifact.effect, copy = path.join(root, packaged.stage, 'audit-invoice.generated.js');
if (await hashFile(effect.file) !== effect.sha256) throw Error('PRODUCT_ARTIFACT_CHANGED');
if (!fs.existsSync(copy)) fs.copyFileSync(effect.file, copy, fs.constants.COPYFILE_EXCL);
if (await hashFile(copy) !== effect.sha256) throw Error('AUDIT_COPY_CHANGED');
const protectedRefs = {
  'codex/execution-fabric-ef2': 'c9e19747be0b130e338f47d049b4b5da772474c3',
  'codex/north-star-first-slice': 'c6f8086ad6d512f48339164a0f88dab9fa88e7e8',
  'codex/s2-authority-realignment': '43f2239586677abf87a755ad65c14e5f60847b5f',
  'codex/s3-connected-ai': '3a30093d40be8a7a4e97a1240467ace938aec2cd',
  'codex/s4-task-continuity': '83e4a80ff934b16fccc82401cd01c69bb5045471',
  'codex/s4-1-cross-surface': entry,
};
for (const [ref, expected] of Object.entries(protectedRefs)) if (git(['rev-parse', ref]) !== expected) throw Error('PROTECTED_REF_CHANGED_' + ref);
const historical = git(['ls-tree', '-r', entry, 'docs/evidence']).split('\n').filter(Boolean).map(line => { const [meta, file] = line.split('\t'); return { file, gitObject: meta.split(' ')[2] }; });
const objects = spawnSync('git', ['hash-object', '--stdin-paths'], { input: historical.map(r => JSON.stringify(r.file)).join('\n') + '\n', encoding: 'utf8', maxBuffer: 30 * 1024 * 1024 });
if (objects.status !== 0 || objects.stdout.trim().split('\n').length !== historical.length || objects.stdout.trim().split('\n').some((h, i) => h !== historical[i].gitObject)) throw Error('HISTORICAL_EVIDENCE_CHANGED');
const previous = load('docs/evidence/s41/delivery-manifest.json'), modelChecks = [];
for (const asset of previous.modelChecks) { if (await hashFile(asset.file) !== asset.sha256) throw Error('EXISTING_MODEL_CHANGED'); modelChecks.push({ file: asset.file, sha256: asset.sha256, unchangedFromS41: true }); }
const config = load(previous.localRuntime.configFile);
if (await hashFile(config.model.file) !== config.model.sha256 || config.model.sha256 !== previous.localRuntime.model.sha256) throw Error('CLI_MODEL_CHANGED');
const assets = [];
for (const asset of previous.localRuntime.assets) { const file = path.join(path.dirname(previous.localRuntime.configFile), asset.file); if (await hashFile(file) !== asset.sha256) throw Error('CLI_ASSET_CHANGED'); assets.push({ file, sha256: asset.sha256 }); }
const binary = path.resolve('release/win-unpacked/JARVIS.exe'), asar = path.resolve('release/win-unpacked/resources/app.asar');
const main = asarTools.extractFile(asar, 'dist-electron/main.js').toString();
for (const marker of ['Closed pure reducer syntax', 'memory_fts', 'task_graphs', 'INVALID_VERIFICATION_CRITERIA', 'TYPESCRIPT_SYMBOL', 'api.groq.com', 'openrouter.ai']) if (!main.includes(marker)) throw Error('STALE_PACKAGE_' + marker);
const files = [], walk = dir => { for (const item of fs.readdirSync(dir, { withFileTypes: true })) { const f = path.join(dir, item.name); if (item.isDirectory()) walk(f); else files.push({ file: path.relative(process.cwd(), f).replaceAll('\\', '/'), sha256: hash(fs.readFileSync(f)) }); } }; walk(root);
const manifest = { at: new Date().toISOString(), classification: 'BOUNDED_CONCILIUS_VERIFIED_WITH_SCOPED_RESULTS', entryCommit: entry, productCommit: packaged.headAtTest, branch: git(['branch', '--show-current']),
  coreChecks: core.records, packagedChecks: packaged.records, runtime: { checks: runtime.checks, taskId: runtime.graph.taskId, nodes: runtime.graph.nodes, stoppedGraph: runtime.stoppedGraph.graphId, paidApiCalls: 0 },
  artifact: { source: effect.file, auditCopy: copy, sha256: effect.sha256, taskEffectReexecuted: false }, binary: { file: binary, sha256: await hashFile(binary), asar, asarSHA256: await hashFile(asar), installationReplaced: false },
  protectedRefs, historicalPreservedCount: historical.length, historical, files, modelChecks, localRuntime: { release: config.release, model: config.model, assets },
  limits: ['Scoped deterministic checks, not universal task truth', 'Explicit bounded sequential local-only plans, not general autonomous planning', 'FTS lexical task-scoped memory, not semantic vector search', 'Bounded TS symbols, not complete LSP', 'Groq/OpenRouter synthetic contract only, real auth and inference unverified', 'Codex official read-only protocol/auth observation, native execution remains POLICY_BLOCKED', 'No general exactly-once effects or universal same-user OS isolation', 'Historical general budgets, RunAsNode, shared-desktop stability and TTY debt remain'] };
fs.writeFileSync(target, JSON.stringify(manifest, null, 2) + '\n', { flag: 'wx' });
console.log('ADV_MANIFEST_PASS historical=' + historical.length + ' evidence=' + files.length + ' paidApiCalls=0');
