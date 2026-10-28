import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';

const project = path.resolve('tests/windows/fixture/JarvisNativeTestFixture.csproj');
const roots = Array.from({ length: 5 }, () => fs.mkdtempSync(path.join(os.tmpdir(), 'jarvis-dll-parallel-')));
async function publish(root) {
  const output = path.join(root, 'publish');
  const args = ['publish', project, '-c', 'Release', '-r', 'win-x64', '--self-contained', 'true',
    '--artifacts-path', path.join(root, 'artifacts'), '-o', output, '--nologo'];
  const child = spawn('dotnet', args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  let log = '';
  child.stdout.on('data', chunk => { log += chunk.toString(); });
  child.stderr.on('data', chunk => { log += chunk.toString(); });
  const code = await new Promise(resolve => child.once('close', resolve));
  assert.equal(code, 0, log.slice(-2000));
  const dll = path.join(output, 'JarvisNativeTestFixture.dll');
  assert.equal(fs.existsSync(dll), true);
  assert.equal(fs.statSync(dll).nlink, 1);
  return dll;
}
try {
  const dlls = await Promise.all(roots.map(publish));
  assert.equal(new Set(dlls.map(file => fs.realpathSync(file))).size, 5);
  console.log('PASS EF-2A DLL fixture: 5 simultaneous publish outputs, unique per process, no shared hardlinks');
} finally {
  for (const root of roots) {
    if (path.dirname(fs.realpathSync(root)).toLowerCase() !== fs.realpathSync(os.tmpdir()).toLowerCase()
      || !path.basename(root).startsWith('jarvis-dll-parallel-')) throw new Error('DLL_FIXTURE_CLEANUP_TARGET_UNVERIFIED');
    fs.rmSync(root, { recursive: true, force: true });
  }
}
