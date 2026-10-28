import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import type { BridgeAuditEntry } from './SecureAgentBridge';

/** Lab-only persistent-effect detector. It is not a filesystem/OS sandbox. */
export class BypassDetector {
  private baseline = new Map<string, string>();
  constructor(readonly root: string) { this.baseline = this.snapshot(); }
  private snapshot(): Map<string, string> {
    const files = new Map<string, string>();
    const visit = (dir: string) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (entry.name === '.git' || entry.name === 'node_modules') continue;
        const full = path.join(dir, entry.name);
        if (entry.isSymbolicLink()) continue;
        if (entry.isDirectory()) visit(full);
        else if (entry.isFile()) files.set(path.relative(this.root, full).replaceAll('\\', '/'), createHash('sha256').update(fs.readFileSync(full)).digest('hex'));
      }
    };
    visit(this.root);
    return files;
  }
  /** Call immediately after the external step; fail closed on any unaccounted persistent mutation. */
  verify(allowedChangedPaths: string[], audit: BridgeAuditEntry[]): { changes: string[]; bypass: string[] } {
    const now = this.snapshot();
    const changes = [...new Set([...this.baseline.keys(), ...now.keys()])].filter(p => this.baseline.get(p) !== now.get(p));
    const allowed = new Set(allowedChangedPaths.map(p => p.replaceAll('\\', '/')));
    const mediated = audit.some(e => e.mappedTool === 'file.patch' && e.result === 'OK' && e.brokerAuditId);
    const bypass = changes.filter(p => !mediated || !allowed.has(p));
    return { changes, bypass };
  }
}
