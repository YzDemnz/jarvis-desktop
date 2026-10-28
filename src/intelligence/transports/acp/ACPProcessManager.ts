import { spawn, type ChildProcess } from 'node:child_process';
import { resolve, relative } from 'node:path';
import { realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { filteredEnv } from '../../../../electron/dev/nodePorts';
import { LeaseManager } from '../../lab/LeaseManager';
import type { ACPAgentProfile } from './ACPAgentProfile';

export function assertTemporaryRoot(cwd: string): void {
  const temp = realpathSync(tmpdir()); const target = realpathSync(cwd);
  const rel = relative(temp, target);
  if (!rel || rel.startsWith('..') || /^[A-Za-z]:/.test(rel)) throw new Error('TEMP_ONLY: non-temporary project rejected');
}
export class ACPProcessManager {
  child: ChildProcess | null = null;
  ownedPid: number | null = null;
  state: 'STOPPED' | 'STARTING' | 'RUNNING' | 'CRASHED' = 'STOPPED';
  readonly leases: LeaseManager;
  private starting: Promise<void> | null = null;
  private startedAt: number | null = null;
  private logs: string[] = [];
  constructor(readonly profile: ACPAgentProfile, readonly cwd: string, readonly supervisor = resolve('tools/intelligence-lab/supervisor.mjs')) {
    assertTemporaryRoot(cwd);
    this.leases = new LeaseManager(() => this.start(), () => this.stop());
  }
  async start(): Promise<void> {
    if (this.state === 'RUNNING') return;
    if (this.starting) return this.starting;
    this.starting = this.launch();
    try { await this.starting; } finally { this.starting = null; }
  }
  private async launch(): Promise<void> {
    assertTemporaryRoot(this.cwd); this.state = 'STARTING';
    const env = { ...filteredEnv(), ...this.profile.environment };
    // Configuration comes from trusted lab profiles, never from model content.
    const child = spawn(process.execPath, [this.supervisor, this.profile.command, this.cwd, ...this.profile.args], {
      cwd: this.cwd, env, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe', 'ipc'],
    });
    this.child = child;
    child.stderr?.on('data', () => { this.logs.push('stderr received (content suppressed)'); this.logs = this.logs.slice(-100); });
    child.on('exit', () => { if (this.child === child) { this.child = null; this.ownedPid = null; this.startedAt = null; this.state = this.state === 'STOPPED' ? 'STOPPED' : 'CRASHED'; } });
    await new Promise<void>((resolveStart, reject) => {
      const timer = setTimeout(() => { reject(new Error('Process startup timeout')); void this.stop(); }, 15000);
      child.once('message', m => { clearTimeout(timer); this.ownedPid = (m as { pid: number }).pid; this.startedAt = Date.now(); this.state = 'RUNNING'; resolveStart(); });
      child.once('error', e => { clearTimeout(timer); reject(e); });
      child.once('exit', () => { clearTimeout(timer); reject(new Error('Process died during startup')); });
    });
  }
  async stop(): Promise<void> {
    const child = this.child; this.state = 'STOPPED'; this.startedAt = null;
    if (!child) return;
    await new Promise<void>((resolveStop, reject) => {
      const timer = setTimeout(() => {
        this.state = 'CRASHED';
        if (child.connected) child.disconnect();
        reject(new Error('Owned guardian shutdown timeout; ownership retained for cleanup'));
      }, 5000);
      child.once('exit', () => { clearTimeout(timer); resolveStop(); });
      if (child.connected) child.send('stop', () => {});
      else if (child.exitCode !== null) { clearTimeout(timer); resolveStop(); }
    });
  }
  async restart(): Promise<void> { await this.stop(); await this.start(); }
  health(): boolean { return this.state === 'RUNNING' && !!this.child && this.child.exitCode === null; }
  log(): string[] { return [...this.logs]; }
  ownership(runId: string | null = null, sessionId: string | null = null) {
    return { ownerComponent: this.profile.id, guardianPid: this.child?.pid ?? null,
      processPid: this.ownedPid, parentPid: this.child?.pid ?? null,
      runId, sessionId, startedAt: this.startedAt, leaseCount: this.leases.leases };
  }
}
