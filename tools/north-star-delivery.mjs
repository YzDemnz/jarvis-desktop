import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';

const root = 'docs/evidence/north-star';
const read = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const sha256 = file => createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const stages = ['baseline', 'final', 'native-retry'];
const summaries = Object.fromEntries(stages.map(stage => [stage, read(`${root}/${stage}/summary.json`)]));
const logIntegrity = stages.every(stage => summaries[stage].records.every(record =>
  !record.evidence || sha256(record.evidence.path) === record.evidence.sha256));
if (!logIntegrity) throw new Error('Validation log integrity mismatch');
if (process.argv.includes('--git-index')) {
  const indexIntegrity = stages.every(stage => summaries[stage].records.every(record => !record.evidence ||
    createHash('sha256').update(execFileSync('git', ['show', `:${record.evidence.path}`])).digest('hex') === record.evidence.sha256));
  if (!indexIntegrity) throw new Error('Git index changed captured log bytes');
  console.log('GIT_INDEX_LOG_INTEGRITY_PASS');
}
const native = read(`${root}/native-retry/native-continuity.json`);
const input = stage => {
  const records = summaries[stage].records.filter(r => r.script === 'test:windows-input');
  return { passed: records.filter(r => r.status === 'PASS').length, repetitions: records.length };
};
const sourceFiles = execFileSync('git', ['diff', '--name-only', 'c9e19747be0b130e338f47d049b4b5da772474c3', '--', 'src', 'electron', 'package.json'], { encoding: 'utf8' })
  .trim().split(/\r?\n/).filter(Boolean);
const artifacts = ['release/win-unpacked/JARVIS.exe', 'release/win-unpacked/resources/app.asar',
  `${root}/native-retry/continuity-history.png`, ...stages.map(stage => `${root}/${stage}/summary.json`),
  ...sourceFiles].map(file => ({ path: file, sha256: sha256(file), bytes: fs.statSync(file).size }));
const result = {
  verifiedDate: '2026-09-30', branch: execFileSync('git', ['branch', '--show-current'], { encoding: 'utf8' }).trim(),
  baseCommit: 'c9e19747be0b130e338f47d049b4b5da772474c3',
  testedProductCommit: '419989e6df26621e1904ba0e24dda7c7525f4632',
  investigation: 'PASS', northStar: 'PASS', firstSlice: native.status, globalProduct: 'PARTIAL',
  validationLogIntegrity: logIntegrity,
  historicalEF1EvidenceIntact: stages.every(stage => summaries[stage].historicalEvidenceIntact),
  input: { baseline: input('baseline'), final: input('final'), interpretation: 'PRE_EXISTING_FLAKINESS_NOT_FIXED' },
  nativeInitialAttempt: { status: 'PARTIAL', reason: 'TEST_SELECTOR_AMBIGUOUS_TWO_ENVIAR_BUTTONS', evidence: `${root}/final/native-continuity.json` },
  nativeAfterSelectorCorrection: { status: native.status, checks: native.checks.length, rendererOutcome: native.rendererOutcome,
    evidence: `${root}/native-retry/native-continuity.json` },
  providers: { codexNative: 'POLICY_BLOCKED', openCode: 'UNKNOWN' },
  limitations: ['General run budgets NOT_ENFORCEABLE', 'Packaged RunAsNode fuse NOT_VERIFIED',
    'Native input remains flaky', 'No automatic provider handoff', 'AccessMode realignment not implemented',
    'No global secret vault or historical data purge', 'No paid API calls', 'No production installation replaced'],
  artifacts,
};
fs.writeFileSync(path.join(root, 'delivery-manifest.json'), JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify({ firstSlice: result.firstSlice, nativeChecks: native.checks.length, logIntegrity, input: result.input, artifacts: artifacts.length }));
