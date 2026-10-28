import type { CapsuleManifest } from './AgentCapsuleWorkspace';
import type { CapsuleDiff } from './AgentCapsuleDiffService';

export interface AgentCapsule {
  manifest: CapsuleManifest;
  status: 'CREATED' | 'DIFF_READY' | 'IMPORTED' | 'STOPPED' | 'ORPHANED_CAPSULE';
  diff: CapsuleDiff | null;
  audit: Array<{ at: number; event: string; detail?: string }>;
}
