import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import { tempLab, repo } from './lab-harness';
const root = tempLab();
const alive = (pid: number) => { try { process.kill(pid, 0); return true; } catch { return false; } };
async function trial() {
  const host = spawn(process.execPath, ['--import', 'tsx', path.join(repo, 'tests/intelligence-lab/orphan-host.ts'), root], {
    cwd: repo, windowsHide: true, stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
    env: { ...process.env, TSX_TSCONFIG_PATH: path.join(repo, 'tests/tsconfig.json') },
  });
  const owned = await new Promise<{ guardian: number; child: number }>((resolve, reject) => {
    const timer = setTimeout(() => { host.kill(); reject(new Error('Lab host timeout')); }, 12000);
    host.once('message', m => { clearTimeout(timer); resolve(m as never); });
    host.once('error', reject); host.once('exit', () => reject(new Error('Lab host died')));
  });
  assert.ok(alive(owned.child));
  // Only this test's host. Not installed JARVIS or any user process.
  host.kill('SIGKILL');
  const started = Date.now();
  while ((alive(owned.child) || alive(owned.guardian)) && Date.now() - started < 7000) await new Promise(r => setTimeout(r, 100));
  assert.equal(alive(owned.child), false, 'Persistent child orphan'); assert.equal(alive(owned.guardian), false, 'Persistent guardian orphan');
  return { cleanupMs: Date.now() - started, childGone: true, guardianGone: true };
}
const first = await trial(); const restarted = await trial();
fs.mkdirSync(path.join(repo, 'docs/evidence/phase-a'), { recursive: true });
fs.writeFileSync(path.join(repo, 'docs/evidence/phase-a/orphans.json'), JSON.stringify({ scope: 'CONTROLLED_LAB_HOST_ONLY_NOT_INSTALLED_JARVIS', first, restarted }, null, 2));
console.log('PASS forced lab host death and restart: owned subtrees gone');
