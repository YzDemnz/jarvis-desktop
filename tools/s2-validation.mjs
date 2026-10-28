import fs from 'node:fs';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
const stage = process.argv[2];
if (!['baseline', 'final', 'closeout'].includes(stage)) throw new Error('Use baseline, final or closeout');
const root = path.resolve(`docs/evidence/s2/${stage}`);
fs.mkdirSync(root, { recursive: true });
const scripts = JSON.parse(fs.readFileSync('package.json', 'utf8')).scripts;
const hash = file => createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const history = ['brokered-poc', 'webcontainer-poc', 'codex-native-poc', 'opencode-native-poc'].map(n => `docs/evidence/ef1/${n}.json`);
const before = Object.fromEntries(history.map(f => [f, hash(f)]));
const suites = stage === 'closeout' ? ['typecheck', 'test:renderer', 'test:s2', 'test:windows-s2'] : ['typecheck', 'test:portable-electron', 'test:renderer', 'lab:ef1:web', 'test:windows-helper',
  ...Array(5).fill('test:windows-input'), 'test:windows-window', 'test:execution-fabric',
  ...['assurance', 'router', 'project-trust', 'brokered-propose', 'scratch', 'real-verify', 'failure-taxonomy', 'reclassification', 'budget', 'sqlite-abi'].map(n => `test:ef2a:${n}`),
  'test:secure-bridge', 'test:capsule', 'test:convergence', 'test:north-star',
  ...(stage === 'final' ? ['test:s2'] : []), 'build:dir', 'test:windows-continuity', 'test:windows-fabric',
  ...(stage === 'final' ? ['test:windows-s2'] : [])];
const records = [];
const summary = () => ({ stage, date: new Date().toISOString(), commit: spawnSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).stdout.trim(),
  records, historicalEF1Intact: history.every(f => hash(f) === before[f]), historicalBefore: before });
for (const [i, script] of suites.entries()) {
  if (!scripts[script]) throw new Error(`Missing script ${script}`);
  console.log(`START ${i + 1}/${suites.length} ${script}`);
  const start = Date.now();
  const child = spawn(process.env.ComSpec, ['/d', '/s', '/c', `npm.cmd run ${script}`], { windowsHide: true,
    env: { ...process.env, JARVIS_EF_EVIDENCE_DIR: path.join(root, 'ef1'), JARVIS_CONTINUITY_EVIDENCE_DIR: root, JARVIS_S2_EVIDENCE_DIR: root },
    stdio: ['ignore', 'pipe', 'pipe'] });
  let output = ''; let timedOut = false;
  child.stdout.on('data', b => { output += b; }); child.stderr.on('data', b => { output += b; });
  const timer = setTimeout(() => { timedOut = true; if (child.pid) spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true }); }, 600000);
  const exitCode = await new Promise(resolve => { child.once('error', e => { output += String(e); resolve(-1); }); child.once('close', resolve); });
  clearTimeout(timer);
  const file = path.join(root, `${String(i + 1).padStart(2, '0')}-${script.replaceAll(':', '-')}.log`);
  fs.writeFileSync(file, output);
  records.push({ script, status: exitCode === 0 ? 'PASS' : 'PARTIAL', exitCode, timedOut, durationMs: Date.now() - start,
    evidence: { path: path.relative(process.cwd(), file).replaceAll('\\', '/'), sha256: hash(file) } });
  fs.writeFileSync(path.join(root, 'summary.json'), JSON.stringify(summary(), null, 2));
  console.log(`END ${script} exit=${exitCode}`);
}
console.log(JSON.stringify(summary()));
