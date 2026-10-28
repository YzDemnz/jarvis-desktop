// Independent guardian: owns only its spawned subtree. Parent IPC loss is STOP.
import { spawn, execFile } from 'node:child_process';
const [command, cwd, ...args] = process.argv.slice(2);
const child = spawn(command, args, { cwd, env: process.env, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
let stopping = false;
const stop = () => {
  if (stopping) return; stopping = true;
  if (child.exitCode !== null || !child.pid) return process.exit(0);
  if (process.platform === 'win32') execFile('taskkill.exe', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true }, () => process.exit(0));
  else { child.kill('SIGTERM'); setTimeout(() => { if (child.exitCode === null) child.kill('SIGKILL'); }, 500); }
};
process.on('disconnect', stop);
process.on('message', m => { if (m === 'stop') stop(); });
process.stdin.pipe(child.stdin); child.stdout.pipe(process.stdout); child.stderr.pipe(process.stderr);
child.on('spawn', () => process.send?.({ pid: child.pid }));
child.on('error', () => process.exit(1));
child.on('exit', code => process.exit(code ?? 1));
child.stdin.on('error', () => {});
