import fs from 'node:fs';
import path from 'node:path';
import type { ToolBroker } from '../../agent/ToolBroker';
import type { DevService } from '../../dev/DevService';
import { hashBytes, capsulePath, containsSecret, safeRelative, type CapsuleManifest } from './AgentCapsuleWorkspace';
import type { CapsuleDiff, CapsuleChange } from './AgentCapsuleDiffService';
import { AgentCapsuleDiffService } from './AgentCapsuleDiffService';

export interface ImportPreflight { ok: boolean; conflicts: string[]; rejected: string[] }

/** No capsule bytes enter the real tree until the complete proposal passes preflight. */
export class AgentCapsuleImportGate {
  constructor(private readonly broker: ToolBroker, private readonly dev: DevService) {
    if (!broker.authoritative) throw new Error('CAPSULE_IMPORT_REQUIRES_AUTHORITATIVE_BROKER');
  }

  async preflight(manifest: CapsuleManifest, diff: CapsuleDiff): Promise<ImportPreflight> {
    const conflicts: string[] = []; const rejected: string[] = [];
    if (diff.capsuleId !== manifest.capsuleId) return { ok: false, conflicts, rejected: ['CAPSULE_ID_MISMATCH'] };
    const fresh = new AgentCapsuleDiffService().diff(manifest);
    if (JSON.stringify(fresh.changes) !== JSON.stringify(diff.changes)) return { ok: false, conflicts, rejected: ['CAPSULE_DIFF_STALE_OR_INCOMPLETE'] };
    const seen = new Set<string>();
    for (const change of diff.changes) {
      const paths = change.from ? [change.from, change.path] : [change.path];
      for (const rel of paths) {
        if (!safeRelative(rel) || seen.has(rel.toLowerCase())) { rejected.push(`${rel}:PATH_OR_DUPLICATE`); continue; }
        seen.add(rel.toLowerCase());
        try { await this.dev.guard.check(path.join(manifest.sourceProject, rel), { write: true }); }
        catch { rejected.push(`${rel}:PATH_GUARD`); }
      }
      const sourceRel = change.from ?? change.path;
      const expected = manifest.files[sourceRel]?.hash ?? null;
      if (expected !== change.beforeHash) rejected.push(`${sourceRel}:SNAPSHOT_MISMATCH`);
      const actual = this.realHash(path.join(manifest.sourceProject, sourceRel));
      if (actual !== expected) conflicts.push(`${sourceRel}:REAL_FILE_CHANGED`);
      if (change.from && this.realHash(path.join(manifest.sourceProject, change.path)) !== null) conflicts.push(`${change.path}:DESTINATION_EXISTS`);
      if (change.kind !== 'deleted') {
        try {
          const bytes = fs.readFileSync(capsulePath(manifest.workspace, change.path));
          if (hashBytes(bytes) !== change.afterHash || containsSecret(bytes) || change.binary || bytes.length > 10 * 1024 * 1024) rejected.push(`${change.path}:UNSAFE_CONTENT`);
        } catch { rejected.push(`${change.path}:CAPSULE_FILE_MISSING`); }
      }
    }
    return { ok: !conflicts.length && !rejected.length, conflicts, rejected };
  }

  private realHash(file: string): string | null {
    try { return hashBytes(fs.readFileSync(file)); } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw error; }
  }

  async apply(manifest: CapsuleManifest, diff: CapsuleDiff, accepted: boolean): Promise<{ runId: string; applied: number }> {
    if (!accepted) throw new Error('CAPSULE_IMPORT_NOT_ACCEPTED');
    const checked = await this.preflight(manifest, diff);
    if (!checked.ok) throw new Error(`CAPSULE_IMPORT_REJECTED:${[...checked.conflicts, ...checked.rejected].join(',')}`);
    const runId = manifest.runId;
    await this.dev.projectFor(runId, manifest.sourceProject);
    let applied = 0;
    for (const change of diff.changes) {
      const current = this.realHash(path.join(manifest.sourceProject, change.from ?? change.path));
      if (current !== change.beforeHash) throw new Error(`CAPSULE_IMPORT_CONFLICT:${change.path}`);
      const request = (toolId: string, args: Record<string, unknown>) => this.broker.execute({ runId, toolId, args, stepId: `capsule:${manifest.capsuleId}` });
      const result = await this.applyOne(manifest, change, request);
      if (!result) throw new Error(`CAPSULE_IMPORT_TOOL_DENIED:${change.path}`);
      applied++;
    }
    return { runId, applied };
  }

  private async applyOne(manifest: CapsuleManifest, change: CapsuleChange,
    request: (toolId: string, args: Record<string, unknown>) => Promise<{ ok: boolean }>): Promise<boolean> {
    if (change.kind === 'renamed') return (await request('file.rename', { path: change.from, to: change.path, project: manifest.sourceProject, expectedHash: change.beforeHash })).ok;
    if (change.kind === 'deleted') return (await request('file.trash', { path: change.path, project: manifest.sourceProject, expectedHash: change.beforeHash })).ok;
    const bytes = fs.readFileSync(capsulePath(manifest.workspace, change.path));
    if (hashBytes(bytes) !== change.afterHash || containsSecret(bytes)) throw new Error('CAPSULE_CONTENT_CHANGED_DURING_IMPORT');
    const content = bytes.toString('utf8');
    const toolId = change.kind === 'added' ? 'file.create' : 'file.write';
    return (await request(toolId, { path: change.path, content, project: manifest.sourceProject,
      ...(change.beforeHash ? { expectedHash: change.beforeHash } : {}) })).ok;
  }
}
