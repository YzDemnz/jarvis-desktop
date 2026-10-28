import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'jarvis-adv-bundle-probe-'));
await build({ entryPoints: ['electron/process/WindowsJobProcess.ts'], outfile: path.join(root, 'job.mjs'), bundle: true, platform: 'node', format: 'esm' });
const { spawnWindowsJob, ownedProcessCount } = await import(pathToFileURL(path.join(root, 'job.mjs')));
const require = createRequire(import.meta.url), main = path.resolve('dist-electron/main.js');
let log = '';
const env = { ...process.env, JARVIS_ALLOW_FIXTURES: '1', JARVIS_TEST_USER_DATA: path.join(root, 'jarvis-fabric-native-bundle-probe') };
delete env.ELECTRON_RUN_AS_NODE;
const child = spawnWindowsJob({ file: require('electron'), args: [main, '--no-error-dialogs'], cwd: process.cwd(), env });
child.onStdout(b => { log = (log + b.toString()).slice(-16000); });
child.onStderr(b => { log = (log + b.toString()).slice(-16000); });
try {
  await child.ready;
  const deadline = Date.now() + 30000;
  while (!log.includes('__filename is not defined') && Date.now() < deadline) await new Promise(r => setTimeout(r, 100));
} finally { await child.killTree(); }
const report = { at: new Date().toISOString(), mode: 'BUILT_ESM_MAIN_ON_REAL_DEV_ELECTRON',
  status: log.includes('__filename is not defined') ? 'FAILURE_DEMONSTRATED' : 'INCONCLUSIVE',
  subject: main, subjectSHA256: createHash('sha256').update(fs.readFileSync(main)).digest('hex'),
  expectedBoundary: 'CommonJS compiler bundled into ESM main', log, pid: child.pid, ownedProcessesAfterCleanup: ownedProcessCount(),
  paidApiCalls: 0, userProfileReused: false, finalPackagedBuildClaimed: false };
const evidence = path.resolve('docs/evidence/adv/native/bundled-compiler-probe.json');
fs.writeFileSync(evidence, JSON.stringify(report, null, 2), { flag: 'wx' });
console.log(JSON.stringify(report));
