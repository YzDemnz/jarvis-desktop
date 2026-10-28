// Generates verification artifacts. Never runs installer / install / remote actions.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';
const root = path.resolve(import.meta.dirname, '../..');
const evidence = path.join(root, 'docs/evidence/phase-a'); fs.mkdirSync(evidence, { recursive: true });
const results = [];
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'jarvis-convergence-validation-'));
const suite = process.argv.includes('--lab-only') ? ['typecheck', 'test:convergence'] : process.argv.includes('--prebuild') ? ['typecheck', 'test:all-portable', 'test:convergence', 'test:renderer', 'test:windows-helper', 'test:windows-input', 'test:windows-window']
  : process.argv.includes('--build-only') ? ['build:dir'] : ['test:windows-electron', 'test:windows-dev', 'test:windows-fabric'];
for (const script of suite) {
  const started = Date.now(); const output = [];
  const child = spawn(process.env.ComSpec ?? 'cmd.exe', ['/d', '/s', '/c', `npm.cmd run ${script}`], {
    cwd: root, windowsHide: true, env: { ...process.env, JARVIS_ALLOW_FIXTURES: '1', JARVIS_TEST_USER_DATA: path.join(profile, script.replaceAll(':', '-')) }, stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.on('data', x => output.push(x)); child.stderr.on('data', x => output.push(x));
  const code = await new Promise(resolve => { child.once('error', () => resolve(-1)); child.once('exit', resolve); });
  const log = Buffer.concat(output).toString('utf8');
  fs.writeFileSync(path.join(evidence, `${script.replaceAll(':', '-')}.txt`), log);
  results.push({ script, exitCode: code, status: code === 0 ? 'PASS' : 'FAIL', durationMs: Date.now() - started,
    summaries: log.split(/\r?\n/).filter(line => /\d+ ok|\d+ fallos|PASS |FAIL |error TS|Error:/.test(line)).slice(-30) });
  fs.writeFileSync(path.join(evidence, process.argv.includes('--lab-only') ? 'validation-lab.json' : process.argv.includes('--prebuild') ? 'validation-prebuild.json' : process.argv.includes('--build-only') ? 'validation-build.json' : 'validation-runtime.json'), JSON.stringify({ at: new Date().toISOString(), profile, installer: 'NOT_GENERATED', results }, null, 2));
  console.log(`${script}: ${code === 0 ? 'PASS' : 'FAIL'} (${Date.now() - started}ms)`);
}
process.exitCode = results.some(r => r.status === 'FAIL') ? 1 : 0;
