import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'jarvis-sandbox-probe-'));
const capsule = path.join(root, 'capsule'); fs.mkdirSync(capsule);
const outside = path.join(root, 'outside-canary.txt'); fs.writeFileSync(outside, 'test-owned-canary');
fs.copyFileSync(path.join(import.meta.dirname, 'sandbox-probe.mjs'), path.join(capsule, 'probe.mjs'));
const strict = [
  '-c', 'permissions.capsule-probe.extends=":workspace"',
  '-c', 'permissions.capsule-probe.filesystem={":root"="deny",":minimal"="read",":tmpdir"="deny"}',
];
const results: unknown[] = [];
try {
  for (const [name, profile, extra] of [
    ['builtin-workspace', ':workspace', []],
    ['strict-elevated', 'capsule-probe', strict],
    ['strict-unelevated', 'capsule-probe', ['-c', 'windows.sandbox="unelevated"', ...strict]],
  ] as const) {
    try {
      const output = execFileSync('codex.exe', ['sandbox', '-P', profile, ...extra, '-C', capsule, '--', process.execPath, path.join(capsule, 'probe.mjs'), outside, capsule],
        { cwd: capsule, encoding: 'utf8', timeout: 20_000, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
      const result = { profile: name, result: JSON.parse(output.trim()) };
      results.push(result); console.log(JSON.stringify(result));
    } catch (error) {
      const e = error as { stderr?: string };
      const result = { profile: name, status: 'REFUSED', reason: e.stderr?.trim().slice(0, 200) ?? 'UNKNOWN' };
      results.push(result); console.log(JSON.stringify(result));
    }
  }
} finally {
  fs.rmSync(root, { recursive: true, force: true });
  const evidence = path.resolve('docs/evidence/phase-a6'); fs.mkdirSync(evidence, { recursive: true });
  fs.writeFileSync(path.join(evidence, 'windows-sandbox-probe.json'), JSON.stringify({ testOwnedCanary: true, results }, null, 2));
}
