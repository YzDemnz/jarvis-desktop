// Generated evidence only; this does not edit product, historic evidence or refs.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { extractFile } from '@electron/asar';
const entry = 'f534b38c3af5dc873372e075d2990c663ac6159d';
const root = 'docs/evidence/s2-closure';
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
function git(...args) {
  const result = spawnSync('git', args, { encoding: 'utf8' });
  if (result.status !== 0) throw Error(result.stderr);
  return result.stdout.trim();
}
const productCommit = git('rev-parse', 'HEAD');
const branch = git('branch', '--show-current');
if (branch !== 'codex/s2-authority-realignment' || productCommit === entry) throw Error('Commit product before manifest');
const protectedRefs = { 'codex/execution-fabric-ef2': 'c9e19747be0b130e338f47d049b4b5da772474c3', 'codex/north-star-first-slice': 'c6f8086ad6d512f48339164a0f88dab9fa88e7e8' };
for (const [ref, sha] of Object.entries(protectedRefs)) if (git('rev-parse', ref) !== sha) throw Error('Protected ref changed: ' + ref);
const fileHash = file => ({ file, bytes: fs.statSync(file).size, sha256: digest(fs.readFileSync(file)) });
const stages = fs.readdirSync(root, { withFileTypes: true }).filter(e => e.isDirectory() && fs.existsSync(path.join(root, e.name, 'summary.json'))).map(e => {
  const file = path.join(root, e.name, 'summary.json');
  const summary = JSON.parse(fs.readFileSync(file));
  for (const record of summary.records) if (digest(fs.readFileSync(record.log)) !== record.sha256) throw Error('Log hash mismatch: ' + record.log);
  return { stage: e.name, summary: file.replaceAll('\\', '/'), sha256: digest(fs.readFileSync(file)), results: summary.records.map(r => ({ script: r.script, status: r.status, log: r.log, sha256: r.sha256 })) };
});
const historical = git('ls-tree', '-r', '--name-only', entry, '--', 'docs/evidence').split('\n').filter(Boolean).map(file => {
  const before = git('rev-parse', entry + ':' + file);
  const now = git('hash-object', '--path=' + file, file);
  if (before !== now) throw Error('Historic evidence changed: ' + file);
  return { file, gitBlob: before, unchanged: true };
});
const changedSources = git('diff', '--name-only', entry, productCommit, '--', 'electron', 'src', 'native', 'tests', 'tools', 'package.json', '.gitignore').split('\n').filter(Boolean).map(file => ({ ...fileHash(file), gitBlob: git('rev-parse', productCommit + ':' + file) }));
const binaryFiles = ['release/win-unpacked/JARVIS.exe', 'release/win-unpacked/resources/app.asar', 'release/win-unpacked/resources/native/jarvis-process-host.exe', 'release/win-unpacked/resources/native/jarvis-automation-helper.exe'];
const binaries = binaryFiles.map(fileHash);
const host = 'native/process-host/bin/Release/net8.0-windows/win-x64/publish/jarvis-process-host.exe';
const helper = 'native/windows-helper/bin/Release/net8.0-windows/win-x64/publish/jarvis-automation-helper.exe';
if (digest(fs.readFileSync(host)) !== binaries[2].sha256 || digest(fs.readFileSync(helper)) !== binaries[3].sha256) throw Error('Packaged helpers do not match final published binaries');
const asar = binaryFiles[1];
for (const file of ['dist-electron/main.js', 'dist-electron/preload.cjs']) if (digest(extractFile(asar, file)) !== digest(fs.readFileSync(file))) throw Error('ASAR does not match final build: ' + file);
const packaged = JSON.parse(fs.readFileSync(root + '/delivery-closeout/native-s2.json'));
if (packaged.status !== 'PASS' || packaged.checks.length !== 25 || packaged.asarHash !== binaries[1].sha256) throw Error('Final packaged S2 evidence not matched to delivered ASAR');
const manifest = {
  at: new Date().toISOString(), entryCommit: entry, productCommit, branch, protectedRefs,
  status: 'PARTIAL_UNIVERSAL', guarantees: { ordinaryWindowsOwnershipStop: 'PASS_FIXTURE_SCOPE', authorityTransitionsInFlight: 'PASS_FIXTURE_SCOPE', input: '15/15_STRICT_THREE_BATCHES_NOT_UNIVERSAL_STABILITY', samePrincipalIsolation: 'LIMITATION_DEMONSTRATED', brokerEscape: 'LIMITATION_DEMONSTRATED', typedCredentialBoundary: 'NOT_IMPLEMENTED', compromisedRendererOriginalProvenance: 'NOT_CERTIFIED', s3Started: false },
  verificationProvenance: 'Tests ran against the modified worktree before the product commit. Final product sources were unchanged after delivery-closeout began; later edits were tests/reporting. All failed attempts remain; raw log hashes independently verified. Menu callbacks and dialog choices are host fixtures, not human secure-desktop certification.',
  finalChecks: { portableElectronSuites: 12, policyS2: 19, ownership: 14, helperTransport: 75, renderer: '367/367', finalInputBatch: '5/5', packagedS2: 25, packagedS1: 8 },
  limitationsEvidence: root + '/boundary/boundary-probes.json', stages, changedSources, binaries,
  historicalEvidence: historical,
  delivery: 'win-unpacked build tested with temporary profiles. Existing installed app/user profile untouched. No push/reset/rebase, no S3/providers/privileged OS changes.',
};
fs.writeFileSync(root + '/delivery-manifest.json', JSON.stringify(manifest, null, 2) + '\n');
console.log(JSON.stringify({ productCommit, stages: stages.length, logs: stages.reduce((n, s) => n + s.results.length, 0), historicalUnchanged: historical.length, binaries: binaries.map(b => ({ file: b.file, sha256: b.sha256 })) }));
