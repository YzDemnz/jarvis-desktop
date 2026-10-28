import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { ACPProcessManager } from '../../src/intelligence/transports/acp/ACPProcessManager';
import { fakeProfile, repo, tempLab } from './lab-harness';
let daemon: ACPProcessManager | undefined;
try {
  try { await fetch('http://127.0.0.1:11434/api/version', { signal: AbortSignal.timeout(1000) }); }
  catch {
    const exe = path.join(process.env.LOCALAPPDATA!, 'Programs/Ollama/ollama.exe');
    if (!fs.existsSync(exe)) throw new Error('Native suites require installed Ollama; no downloads allowed');
    daemon = new ACPProcessManager({ ...fakeProfile(), id: 'native-test-runtime', command: exe, args: ['serve'], environment: {
      OLLAMA_HOST: '127.0.0.1:11434', OLLAMA_NO_CLOUD: '1', OLLAMA_NOPRUNE: '1', ...(process.env.OLLAMA_MODELS ? { OLLAMA_MODELS: process.env.OLLAMA_MODELS } : {}),
    } }, tempLab());
    await daemon.start(); daemon.child?.stdout?.resume();
    for (let i = 0; i < 30; i++) { try { await fetch('http://127.0.0.1:11434/api/version', { signal: AbortSignal.timeout(1000) }); break; } catch { await new Promise(r => setTimeout(r, 1000)); } }
  }
  const validator = spawn(process.execPath, [path.join(repo, 'tools/intelligence-lab/validate.mjs')], { cwd: repo, windowsHide: true, stdio: 'inherit' });
  process.exitCode = await new Promise<number>(r => { validator.once('exit', code => r(code ?? 1)); validator.once('error', () => r(1)); });
} finally { await daemon?.stop(); await daemon?.leases.dispose(); }
