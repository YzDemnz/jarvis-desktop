import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
const evidence = path.resolve('docs/evidence/recovery-20261007');
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'jarvis-fabric-native-probe-'));
const child = spawn(path.resolve('release/win-unpacked/JARVIS.exe'), ['--inspect=0', '--remote-debugging-port=0'], { env: { ...process.env, JARVIS_ALLOW_FIXTURES: '1', JARVIS_TEST_USER_DATA: profile }, windowsHide: true });
const report = { profile, pid: child.pid, stdout: '', stderr: '', messages: [] };
let socket, id = 0;
child.stdout.on('data', b => { report.stdout += b.toString(); });
child.stderr.on('data', b => {
  report.stderr += b.toString();
  const match = report.stderr.match(/Debugger listening on (ws:\/\/[^\s]+)/);
  if (match && !socket) {
    socket = new WebSocket(match[1]);
    socket.addEventListener('open', () => { socket.send(JSON.stringify({ id: ++id, method: 'Debugger.enable' })); });
    socket.addEventListener('message', e => { const m = JSON.parse(e.data); report.messages.push(m); if (m.method === 'Debugger.paused') socket.send(JSON.stringify({ id: ++id, method: 'Debugger.resume' })); });
  }
});
child.on('error', e => { report.error = String(e); });
child.on('exit', (code, signal) => { report.exit = { code, signal }; });
await new Promise(r => setTimeout(r, 15000));
if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ id: ++id, method: 'Debugger.pause' }));
await new Promise(r => setTimeout(r, 5000));
if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ id: ++id, method: 'Runtime.evaluate', params: { expression: '({pid:process.pid,versions:process.versions})', returnByValue: true } }));
await new Promise(r => setTimeout(r, 5000));
socket?.close(); child.kill();
fs.writeFileSync(path.join(evidence, 'startup-probe.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify({ pid: report.pid, profile, stderr: report.stderr, frames: report.messages.filter(m => m.method === 'Debugger.paused').map(m => m.params.callFrames), result: report.messages.filter(m => m.id && m.id > 1 && m.result) }));
