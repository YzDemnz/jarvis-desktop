import fs from 'node:fs';
import { createHash } from 'node:crypto';

export const SECURITY_CAPABILITIES = [
  'STRONG_ISOLATION', 'FILESYSTEM_ISOLATION', 'FILESYSTEM_SCOPED',
  'NETWORK_DENY', 'NETWORK_ALLOWLIST', 'CREDENTIAL_ISOLATION',
  'PROCESS_ISOLATION', 'WEB_PREVIEW',
] as const;
export type SecurityCapability = typeof SECURITY_CAPABILITIES[number];
export type CapabilityState = 'DECLARED' | 'ENFORCED' | 'ATTESTED' | 'FAILED' | 'UNKNOWN' | 'NOT_APPLICABLE';
export type AttestationResult = 'ATTESTED' | 'PARTIAL' | 'FAILED' | 'INCONCLUSIVE';
export interface EvidenceRef { path: string; sha256: string }
export interface AssuranceFingerprintInput {
  backendId: string; backendVersion: string; osBuild: string; policyHash: string;
  implementationVersion: string; attestationSuiteVersion: string;
}
export interface CapabilityRecord extends AssuranceFingerprintInput {
  capability: SecurityCapability; state: CapabilityState; fingerprint: string;
  testedAt: number | null; expiresAt: number | null; attestationId: string | null;
  evidence: EvidenceRef[]; failureReason: string | null; invalidatedReason: string | null;
}
export interface EffectiveCapability {
  capability: SecurityCapability; state: CapabilityState; fingerprint: string;
  eligible: boolean; reason: string; record: CapabilityRecord | null;
}
export interface AssuranceResolver {
  assess(backendId: string, capability: SecurityCapability, current: AssuranceFingerprintInput,
    mechanismConfigured: boolean, now?: number): EffectiveCapability;
}

/** Ordered JSON avoids ambiguous concatenation and stays stable across processes. */
export function assuranceFingerprint(input: AssuranceFingerprintInput): string {
  const fields = [input.backendId, input.backendVersion, input.osBuild, input.policyHash,
    input.implementationVersion, input.attestationSuiteVersion];
  if (fields.some(value => !value)) throw new Error('ASSURANCE_FINGERPRINT_FIELD_MISSING');
  return createHash('sha256').update(JSON.stringify(fields)).digest('hex');
}

export function sha256File(file: string): string {
  return createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

export function declaredCapability(capability: SecurityCapability, input: AssuranceFingerprintInput): CapabilityRecord {
  return { ...input, capability, state: 'DECLARED', fingerprint: assuranceFingerprint(input),
    testedAt: null, expiresAt: null, attestationId: null, evidence: [], failureReason: null, invalidatedReason: null };
}

/** Called at every security routing decision; never trusts a stored state by itself. */
export function evaluateCapability(record: CapabilityRecord | null, capability: SecurityCapability,
  current: AssuranceFingerprintInput, mechanismConfigured: boolean, now = Date.now()): EffectiveCapability {
  const fingerprint = assuranceFingerprint(current);
  if (!record) return { capability, state: 'UNKNOWN', fingerprint, eligible: false, reason: 'NO_ASSURANCE_RECORD', record: null };
  if (record.capability !== capability || record.backendId !== current.backendId) {
    return { capability, state: 'UNKNOWN', fingerprint, eligible: false, reason: 'ASSURANCE_RECORD_MISMATCH', record };
  }
  if (record.state === 'FAILED') return { capability, state: 'FAILED', fingerprint, eligible: false,
    reason: record.failureReason ?? 'PREVIOUS_ATTESTATION_FAILED', record };
  if (record.state === 'NOT_APPLICABLE' || record.state === 'UNKNOWN') return { capability, state: record.state,
    fingerprint, eligible: false, reason: record.state, record };
  const degraded = mechanismConfigured ? 'ENFORCED' : 'DECLARED';
  if (record.fingerprint !== fingerprint) return { capability, state: degraded, fingerprint, eligible: false,
    reason: 'FINGERPRINT_CHANGED', record: { ...record, state: degraded, invalidatedReason: 'FINGERPRINT_CHANGED' } };
  if (record.expiresAt !== null && now >= record.expiresAt) return { capability, state: degraded, fingerprint, eligible: false,
    reason: 'ATTESTATION_EXPIRED', record: { ...record, state: degraded, invalidatedReason: 'ATTESTATION_EXPIRED' } };
  if (record.state !== 'ATTESTED') return { capability, state: record.state === 'ENFORCED' && !mechanismConfigured ? 'DECLARED' : record.state,
    fingerprint, eligible: false, reason: 'CAPABILITY_NOT_ATTESTED', record };
  if (!mechanismConfigured) return { capability, state: 'DECLARED', fingerprint, eligible: false,
    reason: 'MECHANISM_NOT_CONFIGURED', record: { ...record, state: 'DECLARED', invalidatedReason: 'MECHANISM_NOT_CONFIGURED' } };
  if (!record.attestationId || !record.testedAt || record.evidence.length === 0 || record.evidence.some(item => {
    try { return sha256File(item.path) !== item.sha256; } catch { return true; }
  })) return { capability, state: 'ENFORCED', fingerprint, eligible: false,
    reason: 'ATTESTATION_EVIDENCE_INVALID', record: { ...record, state: 'ENFORCED', invalidatedReason: 'ATTESTATION_EVIDENCE_INVALID' } };
  return { capability, state: 'ATTESTED', fingerprint, eligible: true, reason: 'CURRENT_ATTESTATION', record };
}
