import type { CapsuleManifest } from './AgentCapsuleWorkspace';

export interface CapsuleProcessAudit {
  capsuleId: string; runId: string; owner: string; cwd: string; startedAt: number;
  pid: number | null; childPids: number[]; status: 'BLOCKED' | 'RUNNING' | 'STOPPED' | 'ORPHANED_CAPSULE';
  reason: string;
}

/** The default Windows host has no verified restricted-token/Job-Object launcher.
 * Do not pass an ACP/OpenCode process to spawn() merely because cwd is TEMP. */
export class AgentCapsuleProcessManager {
  readonly audit: CapsuleProcessAudit[] = [];
  private stopped = new Set<string>();
  launch(manifest: CapsuleManifest): never {
    const reason = this.stopped.has(manifest.capsuleId) ? 'CAPSULE_STOPPED' : 'ISOLATION_UNAVAILABLE';
    this.audit.push({ capsuleId: manifest.capsuleId, runId: manifest.runId, owner: 'JARVIS', cwd: manifest.workspace,
      startedAt: Date.now(), pid: null, childPids: [], status: 'BLOCKED', reason });
    throw new Error(reason);
  }
  stop(manifest: CapsuleManifest): void {
    this.stopped.add(manifest.capsuleId);
    this.audit.push({ capsuleId: manifest.capsuleId, runId: manifest.runId, owner: 'JARVIS', cwd: manifest.workspace,
      startedAt: Date.now(), pid: null, childPids: [], status: 'STOPPED', reason: 'STOP_REQUESTED' });
  }
  recover(manifest: CapsuleManifest): void {
    this.stopped.add(manifest.capsuleId);
    this.audit.push({ capsuleId: manifest.capsuleId, runId: manifest.runId, owner: 'JARVIS', cwd: manifest.workspace,
      startedAt: Date.now(), pid: null, childPids: [], status: 'ORPHANED_CAPSULE', reason: 'NO_PROCESS_WAS_LAUNCHED' });
  }
}
