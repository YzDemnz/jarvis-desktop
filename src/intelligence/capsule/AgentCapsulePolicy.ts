export type CapsuleProfile = 'READ_ONLY' | 'PROPOSAL' | 'WORKSPACE_WRITE' | 'NETWORKED_WORKSPACE';
export type CapsuleNetwork = 'OFF' | 'PACKAGE_REGISTRY_ONLY' | 'RESTRICTED' | 'OPEN';

export interface AgentCapsulePolicy {
  profile: CapsuleProfile;
  network: CapsuleNetwork;
  maxFiles: number;
  maxFileBytes: number;
  maxTotalBytes: number;
  retentionMs: number;
}

export function capsulePolicy(profile: CapsuleProfile = 'WORKSPACE_WRITE'): AgentCapsulePolicy {
  return {
    profile,
    network: profile === 'NETWORKED_WORKSPACE' ? 'PACKAGE_REGISTRY_ONLY' : 'OFF',
    maxFiles: 5_000,
    maxFileBytes: 2 * 1024 * 1024,
    maxTotalBytes: 50 * 1024 * 1024,
    retentionMs: 24 * 60 * 60 * 1000,
  };
}

export function validateCapsulePolicy(policy: AgentCapsulePolicy): void {
  if (policy.network === 'OPEN') throw new Error('CAPSULE_NETWORK_OPEN_REQUIRES_FUTURE_POLICY');
  if (policy.profile !== 'NETWORKED_WORKSPACE' && policy.network !== 'OFF') throw new Error('CAPSULE_NETWORK_PROFILE_MISMATCH');
  if (policy.maxFiles < 1 || policy.maxFileBytes < 1 || policy.maxTotalBytes < policy.maxFileBytes) throw new Error('CAPSULE_INVALID_LIMITS');
}
