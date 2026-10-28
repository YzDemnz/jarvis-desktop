import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
const git = args => { const r = spawnSync('git', args, { encoding: 'utf8' }); if (r.status !== 0) throw Error('Git audit failed'); return r.stdout.trim(); };
const hash = b => createHash('sha256').update(b).digest('hex');
const root = path.resolve('docs/evidence/s3'), destination = path.join(root, 'delivery-manifest.json');
if (fs.existsSync(destination)) throw Error('Manifest exists; preserve it and choose another output for a new run');
const summary = JSON.parse(fs.readFileSync(path.join(root, 'final', 'summary.json')));
if (summary.records.length !== 10 || summary.records.some(r => r.status !== 'PASS')) throw Error('Final validation is not completely passed');
const runtime = JSON.parse(fs.readFileSync(path.join(root, 'final', 'connected-runtime.json')));
if (runtime.status !== 'PASS' || runtime.checks.length !== 19 || runtime.paidApiCalls !== 0) throw Error('Vertical S3 validation incomplete');
const visualSummary = JSON.parse(fs.readFileSync(path.join(root, 'visual-final', 'summary.json')));
const visualRuntime = JSON.parse(fs.readFileSync(path.join(root, 'visual-final', 'connected-runtime.json')));
if (visualSummary.records.length !== 4 || visualSummary.records.some(r => r.status !== 'PASS') || visualRuntime.checks.length !== 19 || visualRuntime.status !== 'PASS') throw Error('Visual final package validation incomplete');
const verifiedSummary = JSON.parse(fs.readFileSync(path.join(root, 'verified-final', 'summary.json')));
const verifiedRuntime = JSON.parse(fs.readFileSync(path.join(root, 'verified-final', 'connected-runtime.json')));
if (verifiedSummary.records.length !== 4 || verifiedSummary.records.some(r => r.status !== 'PASS') || verifiedRuntime.checks.length !== 19 || verifiedRuntime.status !== 'PASS' || verifiedRuntime.paidApiCalls !== 0) throw Error('Last metadata-truthfulness package validation incomplete');
const sealedSummary = JSON.parse(fs.readFileSync(path.join(root, 'selection-sealed', 'summary.json')));
const sealedRuntime = JSON.parse(fs.readFileSync(path.join(root, 'selection-sealed', 'connected-runtime.json')));
if (sealedSummary.records.length !== 8 || sealedSummary.records.some(r => r.status !== 'PASS') || sealedRuntime.checks.length !== 20 || sealedRuntime.status !== 'PASS' || sealedRuntime.paidApiCalls !== 0) throw Error('Sealed-selection final package validation incomplete');
const protectedRefs = { 'codex/execution-fabric-ef2': 'c9e19747be0b130e338f47d049b4b5da772474c3', 'codex/north-star-first-slice': 'c6f8086ad6d512f48339164a0f88dab9fa88e7e8', 'codex/s2-authority-realignment': '43f2239586677abf87a755ad65c14e5f60847b5f' };
for (const [ref, expected] of Object.entries(protectedRefs)) if (git(['rev-parse', ref]) !== expected) throw Error('Protected ref changed: ' + ref);
const historical = [];
for (const file of git(['ls-tree', '-r', '--name-only', '43f2239586677abf87a755ad65c14e5f60847b5f', 'docs/evidence']).split('\n').filter(Boolean)) {
  const before = spawnSync('git', ['show', '43f2239586677abf87a755ad65c14e5f60847b5f:' + file], { maxBuffer: 30 * 1024 * 1024 });
  // Git stores LF, while the verified Windows checkout uses CRLF for text.
  // Compare the filtered Git object, not raw checkout bytes to an LF blob.
  const gitObject = git(['rev-parse', '43f2239586677abf87a755ad65c14e5f60847b5f:' + file]);
  if (before.status !== 0 || git(['hash-object', '--path=' + file, file]) !== gitObject) throw Error('Historical evidence changed: ' + file);
  historical.push({ file, canonicalSha256: hash(before.stdout), workingCopySha256: hash(fs.readFileSync(file)), gitObject });
}
const files = [];
const walk = dir => { for (const item of fs.readdirSync(dir, { withFileTypes: true })) { const p = path.join(dir, item.name); if (item.isDirectory()) walk(p); else files.push({ file: path.relative(process.cwd(), p).replaceAll('\\', '/'), sha256: hash(fs.readFileSync(p)) }); } }; walk(root);
const modelDirectory = process.env.OLLAMA_MODELS;
const modelAssetChecks = [];
if (modelDirectory) {
  const manifestFile = path.join(modelDirectory, 'manifests/registry.ollama.ai/library/qwen2.5/3b-instruct');
  const m = JSON.parse(fs.readFileSync(manifestFile));
  for (const asset of [m.config, ...m.layers]) {
    const expected = asset.digest.replace('sha256:', ''), file = path.join(modelDirectory, 'blobs', 'sha256-' + expected), actual = hash(fs.readFileSync(file));
    if (expected !== actual) throw Error('Existing model asset modified'); modelAssetChecks.push({ file, sha256: actual, matchesExistingManifest: true });
  }
}
const binary = path.resolve('release/win-unpacked/JARVIS.exe');
fs.writeFileSync(destination, JSON.stringify({ at: new Date().toISOString(), entryCommit: '43f2239586677abf87a755ad65c14e5f60847b5f',
  ownershipCommit: 'd26f25b9de9eae21e566649fb93592eb5b99b49b', productCommit: git(['rev-parse', 'HEAD']), branch: git(['branch', '--show-current']),
  classification: { s2: 'FUNCTIONALLY_COMPLETE_WITH_KNOWN_LIMITATIONS', s3: 'OPERATIVE_FIRST_SLICE_PARTIAL_COVERAGE', openaiAccount: 'NOT_VERIFIED', codexNative: 'POLICY_BLOCKED_UNCHANGED', openCodeNative: 'UNKNOWN_UNCHANGED' },
  binary: { file: binary, sha256: hash(fs.readFileSync(binary)), installationReplaced: false }, protectedRefs,
  finalChecks: summary.records, visualPackageChecks: visualSummary.records, verifiedPackageChecks: verifiedSummary.records, sealedSelectionChecks: sealedSummary.records, runtime: { checks: sealedRuntime.checks.length, actualInference: sealedRuntime.actualInference, remoteInference: sealedRuntime.remoteInference, paidApiCalls: sealedRuntime.paidApiCalls },
  historicalPreservedCount: historical.length, historical, files, modelAssetChecks,
  limitations: ['same-principal isolation', 'broker escape', 'compromised renderer provenance', 'general EF-2A budgets', 'packaged RunAsNode fuse', 'uncooperative daemon GPU cancellation', 'GPU cold-start', 'S4 handoff not implemented'],
  inputEvidence: 'prior 15/15 strict preserved; helper/input unchanged this run; no universal desktop stability claim' }, null, 2) + '\n');
console.log('S3_MANIFEST_PASS ' + historical.length + ' historical files preserved; ' + files.length + ' evidence files hashed; ' + modelAssetChecks.length + ' model assets unchanged');
