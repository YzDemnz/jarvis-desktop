import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { NodeProcessPort } from '../../electron/dev/nodePorts';
import { TerminalService } from '../../src/dev/TerminalService';
import { withProcessScope, ownedProcessCount, cancelOwnedRun } from '../../electron/process/WindowsJobProcess';

// Expected limitations are NOT product PASS. Only synthetic values/own TEMP
// are used. This proves where FULL needs a separate OS security principal.
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'jarvis-s2-boundary-'));
const term = new TerminalService(new NodeProcessPort());
const observations: Array<Record<string, unknown>> = [];
let brokerPid: number | undefined;
const alive = (pid: number) => { try { process.kill(pid, 0); return true; } catch { return false; } };
const wait = async (fn: () => boolean) => { const end = Date.now() + 10000; while (!fn()) { if (Date.now() > end) throw Error('Own fixture timeout'); await new Promise(r => setTimeout(r, 25)); } };
const nonce = randomUUID();
try {
  const control = path.join(root, 'synthetic-control.json'), opaque = 'opaque-fixture-' + nonce;
  fs.writeFileSync(control, JSON.stringify({ accessMode: 'RESTRICTED', fixtureOnly: true }));
  fs.writeFileSync(path.join(root, 'synthetic-private.bin'), opaque);
  const r = await withProcessScope('same-principal', undefined, () => term.execute({ executable: process.execPath, cwd: root, args: ['-e',
    "const fs=require('fs');const p='synthetic-control.json';const v=JSON.parse(fs.readFileSync(p));v.accessMode='FULL';fs.writeFileSync(p,JSON.stringify(v));console.log(fs.readFileSync('synthetic-private.bin','utf8'));"] }));
  assert.equal(JSON.parse(fs.readFileSync(control, 'utf8')).accessMode, 'FULL'); assert.ok(r.stdout.includes(opaque));
  observations.push({ guarantee: 'same-user hostile Native cannot edit authority files or disclose an opaque secret', status: 'LIMITATION_DEMONSTRATED', changedOwnControlFile: true, opaqueSyntheticValueReachedOutput: true, valuePersistedHere: false, requires: 'different OS principal/capability broker/credential isolation; Job Objects and regex redaction do not provide it' });
  console.log('LIMITATION_DEMONSTRATED same Windows principal can edit its own control file and read an opaque fixture');
  const marker = path.join(root, 'broker-marker.json'), child = path.join(root, 'broker-child.cjs');
  fs.writeFileSync(child, "require('fs').writeFileSync(process.argv[2],JSON.stringify({pid:process.pid,nonce:process.argv[3]}));setInterval(()=>{},1000)");
  const command = [process.execPath, child, marker, nonce].map(s => '"' + s + '"').join(' ');
  const ps = "$cmd='" + command.replaceAll("'", "''") + "'; ([wmiclass]'Win32_Process').Create($cmd) | Select-Object ReturnValue,ProcessId | ConvertTo-Json -Compress";
  const broker = await withProcessScope('wmi', undefined, () => term.execute({ executable: 'powershell.exe', cwd: root, args: ['-NoProfile', '-NonInteractive', '-Command', ps], timeoutMs: 15000 }));
  let result: any; try { result = JSON.parse(broker.stdout); } catch { result = null; }
  if (broker.exitCode === 0 && result?.ReturnValue === 0 && result.ProcessId > 0) {
    brokerPid = result.ProcessId; await wait(() => fs.existsSync(marker));
    const marked = JSON.parse(fs.readFileSync(marker, 'utf8')); assert.equal(marked.pid, brokerPid); assert.equal(marked.nonce, nonce);
    assert.equal(ownedProcessCount('wmi'), 0); await cancelOwnedRun('wmi'); assert.ok(alive(brokerPid!));
    observations.push({ guarantee: 'universal STOP for broker-created processes', status: 'LIMITATION_DEMONSTRATED', mechanism: 'Win32_Process.Create runs through foreign WMI broker', ownFixtureStillAliveAfterJobFinishedAndStop: true, foreignBrokerKilled: false, requires: 'OS isolation/cooperative launch broker, not PID-by-name adoption' });
    console.log('LIMITATION_DEMONSTRATED WMI-created fixture escapes the normal CreateProcess job chain; foreign broker was not killed');
  } else {
    observations.push({ guarantee: 'WMI broker escape runtime probe', status: 'NOT_AVAILABLE', exitCode: broker.exitCode, returnValue: result?.ReturnValue ?? null });
    console.log('NOT_AVAILABLE WMI broker fixture; no runtime escape claim');
  }
} finally {
  if (brokerPid && alive(brokerPid)) {
    // Exact PID returned by our launch, independently confirmed by nonce in
    // own fixture. No process-name enumeration or foreign broker termination.
    const marker = JSON.parse(fs.readFileSync(path.join(root, 'broker-marker.json'), 'utf8'));
    assert.equal(marker.pid, brokerPid); assert.equal(marker.nonce, nonce); process.kill(brokerPid);
    await wait(() => !alive(brokerPid!));
  }
  const out = path.resolve(process.env.JARVIS_S2_EVIDENCE_DIR ?? 'docs/evidence/s2-closure/boundary'); fs.mkdirSync(out, { recursive: true });
  fs.writeFileSync(path.join(out, 'boundary-probes.json'), JSON.stringify({ at: new Date().toISOString(), productGuaranteesPassed: false, observations, cleanup: 'Only test-owned TEMP and nonce-confirmed broker fixture removed' }, null, 2));
  assert.ok(root.startsWith(path.resolve(os.tmpdir()) + path.sep) && path.basename(root).startsWith('jarvis-s2-boundary-'));
  fs.rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}
