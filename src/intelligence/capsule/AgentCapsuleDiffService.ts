import fs from 'node:fs';
import { hashBytes, containsSecret, capsulePath, safeRelative, type CapsuleManifest } from './AgentCapsuleWorkspace';
import { looksBinary } from '../../dev/classify';

export interface CapsuleChange { kind: 'added' | 'modified' | 'deleted' | 'renamed'; path: string; from?: string; beforeHash: string | null; afterHash: string | null; binary: boolean; bytes: number }
export interface CapsuleDiff { capsuleId: string; changes: CapsuleChange[]; generatedAt: number }

export class AgentCapsuleDiffService {
  diff(manifest: CapsuleManifest): CapsuleDiff {
    const after = new Map<string, { hash: string; binary: boolean; bytes: number }>();
    const walk = (dir: string, prefix = ''): void => {
      for (const item of fs.readdirSync(dir, { withFileTypes: true })) {
        const rel = prefix ? `${prefix}/${item.name}` : item.name;
        if (!safeRelative(rel) || item.isSymbolicLink()) throw new Error('CAPSULE_UNSAFE_OUTPUT');
        const name = capsulePath(manifest.workspace, rel);
        if (item.isDirectory()) { walk(name, rel); continue; }
        if (!item.isFile()) throw new Error('CAPSULE_SPECIAL_OUTPUT');
        const stat = fs.statSync(name);
        if (stat.size > manifest.policy.maxFileBytes || after.size >= manifest.policy.maxFiles) throw new Error('CAPSULE_OUTPUT_LIMIT');
        const bytes = fs.readFileSync(name);
        if (containsSecret(bytes)) throw new Error('CAPSULE_SECRET_OUTPUT');
        after.set(rel, { hash: hashBytes(bytes), binary: looksBinary(bytes), bytes: bytes.length });
      }
    };
    walk(manifest.workspace);
    const changes: CapsuleChange[] = [];
    for (const [rel, before] of Object.entries(manifest.files)) {
      const now = after.get(rel);
      if (!now) changes.push({ kind: 'deleted', path: rel, beforeHash: before.hash, afterHash: null, binary: before.binary, bytes: 0 });
      else if (now.hash !== before.hash) changes.push({ kind: 'modified', path: rel, beforeHash: before.hash, afterHash: now.hash, binary: now.binary, bytes: now.bytes });
      after.delete(rel);
    }
    for (const [rel, now] of after) changes.push({ kind: 'added', path: rel, beforeHash: null, afterHash: now.hash, binary: now.binary, bytes: now.bytes });
    for (const removed of changes.filter(c => c.kind === 'deleted')) {
      const added = changes.find(c => c.kind === 'added' && c.afterHash === removed.beforeHash);
      if (added) { added.kind = 'renamed'; added.from = removed.path; added.beforeHash = removed.beforeHash; changes.splice(changes.indexOf(removed), 1); }
    }
    return { capsuleId: manifest.capsuleId, changes: changes.sort((a, b) => a.path.localeCompare(b.path)), generatedAt: Date.now() };
  }
}
