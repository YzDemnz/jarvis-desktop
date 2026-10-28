import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import type { WindowsHelperBridge } from '../../electron/desktop/WindowsHelperBridge';

const project = path.resolve('tests/windows/fixture/JarvisNativeTestFixture.csproj');
export const FIXTURE_TITLE = 'JARVIS Native Test Fixture';

export function launchNativeFixture(): ChildProcess {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'jarvis-native-fixture-'));
  const publish = path.join(root, 'publish');
  const build = spawnSync('dotnet', ['publish', project, '-c', 'Release', '-r', 'win-x64', '--self-contained', 'true',
    '--artifacts-path', path.join(root, 'artifacts'), '-o', publish, '--nologo'],
  { encoding: 'utf8', timeout: 120000, windowsHide: true });
  if (build.status !== 0) { fs.rmSync(root, { recursive: true, force: true });
    throw new Error(`Native fixture build failed: ${build.stderr || build.stdout}`); }
  const executable = path.join(publish, 'JarvisNativeTestFixture.exe');
  if (!fs.existsSync(executable)) { fs.rmSync(root, { recursive: true, force: true }); throw new Error('Native fixture executable missing'); }
  const child = spawn(executable, [], { windowsHide: false, shell: false, stdio: 'ignore' });
  child.once('close', () => fs.rmSync(root, { recursive: true, force: true }));
  return child;
}

export async function fixtureWindow(bridge: WindowsHelperBridge) {
  for (let attempt = 0; attempt < 50; attempt++) {
    const window = (await bridge.listWindows()).find((item) => item.title === FIXTURE_TITLE);
    if (window) return window;
    await delay(100);
  }
  throw new Error('The isolated native fixture window did not appear');
}
