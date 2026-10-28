import fs from 'node:fs';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
const [stage, ...requested] = process.argv.slice(2);
if (!/^[a-z0-9-]+$/.test(stage ?? '') || !requested.length) throw Error('stage and package script names required');
const root = path.resolve(process.env.JARVIS_VALIDATION_ROOT ?? 'docs/evidence/s2-closure', stage);
if (fs.existsSync(path.join(root, 'summary.json'))) throw Error('Evidence stage already exists; choose a new stage');
fs.mkdirSync(root, { recursive: true });
const scripts = JSON.parse(fs.readFileSync('package.json')).scripts;
const hash = b => createHash('sha256').update(b).digest('hex');
const git = args => spawnSync('git', args, { encoding: 'utf8' }).stdout.trim();
const historical = new Map(git(['ls-files', 'docs/evidence']).split('\n').filter(Boolean).map(p => [p, fs.readFileSync(p)]));
const records = [];
const summary = () => ({ stage, at: new Date().toISOString(), headAtTest: git(['rev-parse', 'HEAD']), dirtyAtTest: git(['status', '--porcelain']), records });
for (const [i, script] of requested.entries()) {
  if (!scripts[script]) throw Error('Missing package script: ' + script);
  console.log('START ' + script);
  const start = Date.now(); let output = '', timedOut = false;
  const child = spawn(process.env.ComSpec, ['/d', '/s', '/c', 'npm.cmd run ' + script], { windowsHide: true,
    env: { ...process.env, JARVIS_EF_EVIDENCE_DIR: path.join(root, 'ef1'), JARVIS_S2_EVIDENCE_DIR: root, JARVIS_CONTINUITY_EVIDENCE_DIR: root }, stdio: ['ignore', 'pipe', 'pipe'] });
  child.stdout.on('data', b => { output += b; }); child.stderr.on('data', b => { output += b; });
  const timer = setTimeout(() => { timedOut = true; if (child.pid) spawnSync('taskkill.exe', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true }); }, 600000);
  const exitCode = await new Promise(resolve => { child.once('error', e => { output += String(e); resolve(-1); }); child.once('close', resolve); });
  clearTimeout(timer);
  const file = path.join(root, String(i + 1).padStart(2, '0') + '-' + script.replaceAll(':', '-') + '.log');
  fs.writeFileSync(file, output);
  records.push({ script, status: exitCode === 0 ? 'PASS' : 'FAIL', exitCode, timedOut, durationMs: Date.now() - start, log: path.relative(process.cwd(), file).replaceAll('\\', '/'), sha256: hash(Buffer.from(output)) });
  for (const [p, bytes] of historical) if (!fs.readFileSync(p).equals(bytes)) {
    const copy = path.join(root, 'regenerated-history', p); fs.mkdirSync(path.dirname(copy), { recursive: true }); fs.copyFileSync(p, copy); fs.writeFileSync(p, bytes);
  }
  fs.writeFileSync(path.join(root, 'summary.json'), JSON.stringify(summary(), null, 2) + '\n');
  console.log('END ' + script + ' exit=' + exitCode);
}
console.log(JSON.stringify(summary()));
