import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { ACPProcessManager } from '../../src/intelligence/transports/acp/ACPProcessManager';
import { fakeProfile, repo, tempLab } from './lab-harness';

const modelDir = process.env.OLLAMA_MODELS;
if (!modelDir || !fs.existsSync(modelDir)) throw new Error('Set OLLAMA_MODELS to the existing model directory; no download will occur');
const exe = path.join(process.env.LOCALAPPDATA ?? '', 'Programs', 'Ollama', 'ollama.exe');
if (!fs.existsSync(exe)) throw new Error('Installed Ollama required; no download will occur');
let owned: ACPProcessManager | null = null;
const results: { script: string; exitCode: number }[] = [];
try {
  let online = false;
  try { online = (await fetch('http://127.0.0.1:11434/api/version', { signal: AbortSignal.timeout(1000) })).ok; } catch { /* offline */ }
  if (!online) {
    owned = new ACPProcessManager({ ...fakeProfile(), id: 'a5-native-ollama', command: exe, args: ['serve'],
      environment: { OLLAMA_HOST: '127.0.0.1:11434', OLLAMA_MODELS: modelDir, OLLAMA_NO_CLOUD: '1', OLLAMA_NOPRUNE: '1' } }, tempLab());
    await owned.start(); owned.child?.stdout?.resume();
    for (let i = 0; i < 30 && !online; i++) {
      try { online = (await fetch('http://127.0.0.1:11434/api/version', { signal: AbortSignal.timeout(1000) })).ok; }
      catch { await new Promise(r => setTimeout(r, 1000)); }
    }
  }
  if (!online) throw new Error('Ollama did not become healthy');
  const tags = await (await fetch('http://127.0.0.1:11434/api/tags')).json() as { models?: { name: string }[] };
  if (!tags.models?.some(m => m.name === 'qwen2.5:3b-instruct')) throw new Error('Required existing model not found; no pull attempted');
  for (const [script, file] of [
    ['windows-electron', 'tests/windows/electron-runtime.test.mjs'],
    ['windows-dev', 'tests/windows/developer-runtime.test.mjs'],
    ['windows-fabric', 'tests/windows/fabric-runtime.test.mjs'],
  ] as const) {
    const child = spawn(process.execPath, [path.join(repo, file)], { cwd: repo, windowsHide: true, stdio: 'inherit' });
    const exitCode = await new Promise<number>(resolve => { child.once('exit', code => resolve(code ?? 1)); child.once('error', () => resolve(1)); });
    results.push({ script, exitCode });
    if (exitCode !== 0) break;
  }
} finally {
  if (owned) { await owned.stop(); await owned.leases.dispose(); }
  const evidenceDir = path.join(repo, 'docs', 'evidence', 'phase-a5'); fs.mkdirSync(evidenceDir, { recursive: true });
  fs.writeFileSync(path.join(evidenceDir, 'native-runtime.json'), JSON.stringify({
    ollama: 'EXISTING_LOCAL_MODEL_ONLY', downloadedModels: false, ownedDaemonStopped: owned ? !owned.health() : null,
    results, passed: results.length === 3 && results.every(r => r.exitCode === 0),
  }, null, 2));
}
if (results.length !== 3 || results.some(r => r.exitCode !== 0)) process.exitCode = 1;
