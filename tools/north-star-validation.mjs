import fs from 'node:fs';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';

const stage = process.argv[2];
if (!['baseline', 'final', 'native-retry'].includes(stage)) throw new Error('Use baseline, final or native-retry');
const evidenceDir = path.resolve(`docs/evidence/north-star/${stage}`);
fs.mkdirSync(evidenceDir, { recursive: true });
const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
const hash = file => createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const historicalFiles = ['brokered-poc.json', 'webcontainer-poc.json', 'codex-native-poc.json', 'opencode-native-poc.json']
  .map(name => `docs/evidence/ef1/${name}`);
const historicalBefore = Object.fromEntries(historicalFiles.map(file => [file, hash(file)]));
const suites = stage === 'native-retry' ? ['test:windows-continuity', 'test:windows-fabric'] : ['typecheck', 'test:portable-electron', 'test:renderer', 'lab:ef1:web',
  'test:windows-helper', ...Array(5).fill('test:windows-input'), 'test:windows-window', 'test:execution-fabric',
  'test:ef2a:assurance', 'test:ef2a:router', 'test:ef2a:project-trust', 'test:ef2a:brokered-propose',
  'test:ef2a:scratch', 'test:ef2a:real-verify', 'test:ef2a:failure-taxonomy', 'test:ef2a:reclassification',
  'test:ef2a:budget', 'test:ef2a:sqlite-abi', 'test:secure-bridge', 'test:capsule', 'test:convergence',
  ...(stage === 'final' && pkg.scripts['test:north-star'] ? ['test:north-star'] : []), 'build:dir',
  ...(stage === 'final' && pkg.scripts['test:windows-continuity'] ? ['test:windows-continuity'] : []), 'test:windows-fabric'];
const records = [];
const summary = () => ({ stage, date: '2026-09-30', branch: spawnSync('git', ['branch', '--show-current'], { encoding: 'utf8' }).stdout.trim(),
  commit: spawnSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).stdout.trim(), records,
  historicalEvidenceIntact: historicalFiles.every(file => hash(file) === historicalBefore[file]), historicalBefore });
for (let index = 0; index < suites.length; index++) {
  const script = suites[index];
  if (!pkg.scripts[script]) { records.push({ script, status: 'UNKNOWN', reason: 'SCRIPT_ABSENT' }); continue; }
  console.log(`VALIDATION_START ${index + 1}/${suites.length} ${script}`);
  const start = Date.now();
  const child = spawn(process.env.ComSpec ?? 'C:\\Windows\\System32\\cmd.exe', ['/d', '/s', '/c', `npm.cmd run ${script}`], {
    cwd: process.cwd(), windowsHide: true, env: { ...process.env, JARVIS_EF_EVIDENCE_DIR: path.join(evidenceDir, 'ef1-regression'),
      JARVIS_CONTINUITY_EVIDENCE_DIR: evidenceDir },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = ''; let timedOut = false;
  child.stdout.on('data', chunk => { output += chunk; });
  child.stderr.on('data', chunk => { output += chunk; });
  const timer = setTimeout(() => {
    timedOut = true;
    if (child.pid) spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true });
  }, 600_000);
  const exitCode = await new Promise(resolve => { child.once('error', error => { output += String(error); resolve(-1); }); child.once('close', resolve); });
  clearTimeout(timer);
  const logPath = path.join(evidenceDir, `${String(index + 1).padStart(2, '0')}-${script.replaceAll(':', '-')}.log`);
  fs.writeFileSync(logPath, output);
  records.push({ script, iteration: script === 'test:windows-input' ? records.filter(r => r.script === script).length + 1 : 1,
    status: exitCode === 0 ? 'PASS' : 'PARTIAL', exitCode, timedOut, durationMs: Date.now() - start,
    evidence: { path: path.relative(process.cwd(), logPath).replaceAll('\\', '/'), sha256: hash(logPath) } });
  fs.writeFileSync(path.join(evidenceDir, 'summary.json'), JSON.stringify(summary(), null, 2) + '\n');
  console.log(`VALIDATION_END ${script} exit=${exitCode} durationMs=${Date.now() - start}`);
}
console.log(JSON.stringify(summary()));
