import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import asar from '@electron/asar';

// Delivery evidence only: this tool never starts a model or modifies an owner database.
const repo = process.cwd();
const base = path.resolve(repo, '..');
const codexRoot = 'E:\\CODEX';
const installed = path.join(base, 'App instalada');
const evidence = path.join(repo, 'docs/evidence/bootstrap-20261007');
const productCommit = 'ac1f8e5e71282aa28ad5e1f3ac19278e1cf7a77e';
function contained(file) {
  const resolved = path.resolve(file);
  assert.ok(resolved.toLowerCase().startsWith(codexRoot.toLowerCase() + path.sep), resolved);
  return resolved;
}
function readJson(file) { return JSON.parse(fs.readFileSync(contained(file), 'utf8')); }
function git(...args) {
  const result = spawnSync('git', args, {cwd: repo, encoding: 'utf8', windowsHide: true});
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
}
async function fingerprint(file) {
  const resolved = contained(file), hash = createHash('sha256');
  for await (const chunk of fs.createReadStream(resolved, {highWaterMark: 4 * 1024 * 1024})) hash.update(chunk);
  return {path: resolved, bytes: fs.statSync(resolved).size, sha256: hash.digest('hex')};
}
const native = readJson(path.join(evidence, 'native-verified/result.json'));
const smoke = readJson(path.join(evidence, 'package-smoke.json'));
const owner = readJson(path.join(evidence, 'owner-activated.json'));
const before = readJson(path.join(evidence, 'owner-profile-before.json'));
const catalog = readJson(path.join(repo, 'electron/bootstrap/trusted-catalog.json'));
assert.equal(native.status, 'PASS'); assert.equal(native.checks.length, 8);
assert.equal(smoke.status, 'PASS'); assert.equal(smoke.checks.length, 5);
assert.equal(smoke.realProfileTouched, false); assert.equal(native.realProfileTouched, false);
assert.equal(owner.status, 'ACTIVATED'); assert.equal(owner.test, false);
assert.equal(owner.host.fixture, null); assert.equal(owner.host.version, '0.4.0-dev');
assert.deepEqual(owner.phase, before.stats);
assert.equal(owner.phase.integrity, 'ok'); assert.equal(owner.bootstrap.localHealth, 'OPERATIVE');
assert.equal(owner.bootstrap.candidateId, 'qwen3-4b-gguf');
assert.equal(owner.bootstrap.receipts.length, 4); assert.equal(owner.paidApiCalls, 0);
assert.equal(owner.policy.allowPaidApi, false); assert.equal(owner.policy.allowPaidFallback, false);
assert.equal(git('diff', '--name-only', productCommit, '--', 'electron', 'src', 'native', 'package.json', 'package-lock.json', 'vite.config.ts'), '');
const archive = contained(path.join(installed, 'resources/app.asar'));
const packaged = JSON.parse(asar.extractFile(archive, 'package.json').toString());
assert.equal(packaged.version, '0.4.0-dev');
assert.equal(asar.extractFile(archive, 'dist-electron/main.js').compare(fs.readFileSync(path.join(repo, 'dist-electron/main.js'))), 0);
assert.equal(asar.extractFile(archive, 'dist/index.html').compare(fs.readFileSync(path.join(repo, 'dist/index.html'))), 0);
for (const marker of ['JARVIS_BOOTSTRAP_ROOT', 'BOOTSTRAP_INTELLIGENCE', 'BOOTSTRAP_OWNER_GESTURE_REQUIRED', 'memory_fts', 'task_graphs']) {
  assert.ok(asar.extractFile(archive, 'dist-electron/main.js').toString().includes(marker), marker);
}
const dependencies = {};
for (const dependency of ['typescript', 'ws', 'better-sqlite3']) {
  dependencies[dependency] = JSON.parse(asar.extractFile(archive, path.join('node_modules', dependency, 'package.json')).toString()).version;
}
const fingerprints = [];
for (const relative of [
  'App instalada/JARVIS.exe', 'App instalada/resources/app.asar',
  'App instalada/resources/native/jarvis-process-host.exe',
  'App instalada/resources/native/jarvis-automation-helper.exe',
  'App instalada/resources/app.asar.unpacked/node_modules/better-sqlite3/build/Release/better_sqlite3.node',
  'Dependencias/Herramientas/Codex/codex.exe', 'Dependencias/Entorno-JARVIS.ps1',
  'Abrir-JARVIS.cmd', 'Abrir-JARVIS.ps1', 'Desarrollar-JARVIS.cmd', 'Dependencias/Iniciar-Ollama.ps1'
]) fingerprints.push(await fingerprint(path.join(base, relative)));
const evidenceFingerprints = [];
for (const relative of ['native-verified/result.json', 'package-smoke.json', 'owner-profile-before.json', 'owner-activated.json', 'model-download.json', 'codex-job-probe.json']) {
  evidenceFingerprints.push(await fingerprint(path.join(evidence, relative)));
}
const sourceFingerprints = [];
for (const relative of git('ls-files', '--', 'electron', 'src', 'native', 'package.json', 'package-lock.json', 'vite.config.ts').split(/\r?\n/).filter(Boolean)) {
  sourceFingerprints.push(await fingerprint(path.join(repo, relative)));
}
const candidate = catalog.models.find(model => model.id === owner.bootstrap.candidateId);
assert.ok(candidate);
assert.ok(owner.bootstrap.receipts.some(receipt => receipt.kind === 'model' && receipt.sha256 === candidate.artifact.sha256));
const manifest = {
  status: 'VERIFIED_PORTABLE_DELIVERY', at: new Date().toISOString(), version: packaged.version,
  repository: repo, branch: git('branch', '--show-current'), productSourceCommit: productCommit,
  commits: ['7d5534e', '834e031', '4fcc443', 'd9b4eb1', 'ac1f8e5'].map(commit => ({commit: git('rev-parse', commit), subject: git('log', '-1', '--format=%s', commit)})),
  installed, ownerProfile: owner.host.profile, externalTemporaryRoot: owner.host.temp,
  allNewInstallationsWithin: codexRoot, packageDependencies: dependencies,
  sqliteAbi: {moduleVersion: 130, verifiedByActualPackagedStartup: true},
  backups: {
    previousApp: 'E:\\CODEX\\Historial\\Bootstrap-JARVIS-20261007\\App-0.3-antes-del-bootstrap',
    previousDeliveryManifest: 'E:\\CODEX\\Historial\\Bootstrap-JARVIS-20261007\\Verificacion-paquete-0.3.json',
    ownerDatabase: before.backup
  },
  ownerInstallation: {
    kind: owner.kind, test: false, before: before.stats, after: owner.phase,
    health: owner.bootstrap.localHealth, controller: 'JARVIS', routing: owner.bootstrap.routing,
    installRoot: owner.bootstrap.installRoot, benchmark: owner.bootstrap.benchmark,
    runtime: catalog.runtime.id, model: candidate.id,
    modelIntegrity: {...candidate.artifact, verification: 'Full SHA-256 checked by installer/controller before real inference; recorded effect receipt. Manifest does not claim a new model rehash.'},
    runtimeAssetCount: catalog.runtime.assets.length, receipts: owner.bootstrap.receipts,
    paidApiCalls: owner.paidApiCalls, paidApiAllowed: owner.policy.allowPaidApi,
    paidFallbackAllowed: owner.policy.allowPaidFallback
  },
  evidence: {
    native: {status: native.status, checks: native.checks, ownerProfileTouched: false},
    productionPackage: {status: smoke.status, checks: smoke.checks, ownerProfileTouched: false},
    codex: 'Official AppServer protocol observed; AUTH_REQUIRED. No external login/inference claimed.',
    remoteApis: 'Claude/Gemini/Grok contracts simulated; real inference not verified.',
    resultVerification: 'Normal chat is PRODUCED; correctness requires its own verifier.'
  },
  fingerprints, evidenceFingerprints, sourceFingerprints
};
const text = JSON.stringify(manifest, null, 2) + '\n';
fs.writeFileSync(contained(path.join(evidence, 'delivery-manifest.json')), text);
fs.writeFileSync(contained(path.join(base, 'Verificacion-paquete.json')), text);
console.log(JSON.stringify({status: manifest.status, installed, productSourceCommit: productCommit, sourceFiles: sourceFingerprints.length, files: fingerprints.length, ownerProfilePreserved: true}));
