import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { AgentCapsule } from './AgentCapsule';
import { AgentCapsuleWorkspace } from './AgentCapsuleWorkspace';
import { AgentCapsuleDiffService } from './AgentCapsuleDiffService';
import { AgentCapsuleProcessManager } from './AgentCapsuleProcessManager';
import type { AgentCapsulePolicy } from './AgentCapsulePolicy';
import type { AgentCapsuleImportGate } from './AgentCapsuleImportGate';
import type { PathGuard } from '../../dev/PathGuard';

export class AgentCapsuleManager {
  constructor(private readonly guard: PathGuard) {}
  private capsules = new Map<string, AgentCapsule>();
  private ownedWorkspace = new Map<string, string>();
  private readonly workspace = new AgentCapsuleWorkspace();
  readonly diffs = new AgentCapsuleDiffService();
  readonly processes = new AgentCapsuleProcessManager();

  async create(input: { project: string; runId: string; conversationId: string; provider: string; agent: string; policy?: AgentCapsulePolicy }): Promise<AgentCapsule> {
    const checked = await this.guard.check(input.project, { write: false });
    if (checked.path.toLowerCase() !== fs.realpathSync(input.project).toLowerCase()) throw new Error('CAPSULE_PROJECT_NOT_AUTHORIZED');
    const manifest = this.workspace.create(input);
    const capsule: AgentCapsule = { manifest, status: 'CREATED', diff: null,
      audit: [{ at: Date.now(), event: 'CAPSULE_CREATED', detail: `${Object.keys(manifest.files).length} files` },
        ...manifest.excluded.filter(x => x.reason === 'CAPSULE_SECRET_EXCLUDED').map(x => ({ at: Date.now(), event: x.reason, detail: x.path }))] };
    this.capsules.set(manifest.capsuleId, capsule);
    this.ownedWorkspace.set(manifest.capsuleId, fs.realpathSync(manifest.workspace));
    return capsule;
  }
  get(id: string): AgentCapsule | null { return this.capsules.get(id) ?? null; }
  diff(id: string) {
    const capsule = this.required(id);
    if (capsule.status !== 'CREATED' && capsule.status !== 'DIFF_READY') throw new Error('CAPSULE_NOT_DIFFABLE');
    capsule.diff = this.diffs.diff(capsule.manifest); capsule.status = 'DIFF_READY';
    capsule.audit.push({ at: Date.now(), event: 'CAPSULE_DIFF_READY', detail: `${capsule.diff.changes.length} changes` });
    return capsule.diff;
  }
  async import(id: string, gate: AgentCapsuleImportGate, accepted: boolean): Promise<{ runId: string; applied: number }> {
    const capsule = this.required(id);
    if (capsule.status !== 'DIFF_READY' || !capsule.diff) throw new Error('CAPSULE_DIFF_REQUIRED');
    const result = await gate.apply(capsule.manifest, capsule.diff, accepted);
    capsule.status = 'IMPORTED';
    capsule.audit.push({ at: Date.now(), event: 'CAPSULE_IMPORTED', detail: `${result.applied} changes` });
    return result;
  }
  stop(id: string): void {
    const capsule = this.required(id); this.processes.stop(capsule.manifest); capsule.status = 'STOPPED';
    capsule.audit.push({ at: Date.now(), event: 'CAPSULE_STOPPED' });
  }
  recover(id: string): void {
    const capsule = this.required(id); this.processes.recover(capsule.manifest); capsule.status = 'ORPHANED_CAPSULE';
    capsule.audit.push({ at: Date.now(), event: 'ORPHANED_CAPSULE' });
  }
  cleanup(id: string, approved = false): void {
    const capsule = this.required(id);
    if (!approved && Date.now() - capsule.manifest.createdAt < capsule.manifest.policy.retentionMs) throw new Error('CAPSULE_RETENTION_ACTIVE');
    if (capsule.status === 'CREATED') throw new Error('CAPSULE_NOT_FINALIZED');
    const owned = this.ownedWorkspace.get(id);
    const tmp = fs.realpathSync(os.tmpdir()).toLowerCase();
    if (!owned || path.dirname(owned).toLowerCase() !== tmp || !path.basename(owned).startsWith('jarvis-capsule-')
      || fs.lstatSync(owned).isSymbolicLink() || fs.realpathSync(owned) !== owned) throw new Error('CAPSULE_CLEANUP_PATH_DENIED');
    fs.rmSync(owned, { recursive: true, force: true });
    this.ownedWorkspace.delete(id);
    capsule.audit.push({ at: Date.now(), event: 'CAPSULE_WORKSPACE_REMOVED' });
  }
  private required(id: string) { const capsule = this.get(id); if (!capsule) throw new Error('CAPSULE_NOT_FOUND'); return capsule; }
}
