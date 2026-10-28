import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { assuranceFingerprint, sha256File, type AssuranceFingerprintInput, type AttestationResult,
  evaluateCapability, type AssuranceResolver, type CapabilityRecord, type EffectiveCapability,
  type EvidenceRef, type SecurityCapability } from './CapabilityAssurance';

export interface ControlObservation {
  worked: boolean; evidencePaths: string[]; independent: boolean;
  attribution: { mechanism: string; code: string } | null;
}
export interface AttestationObservations { positive: ControlObservation; negatives: ControlObservation[] }
export interface AttestationSuite {
  version: string;
  requiredNegativeControls: number;
  run(): Promise<AttestationObservations>;
}
export interface AttestationRun {
  id: string; capability: SecurityCapability; backendId: string; fingerprint: string;
  suiteVersion: string; result: AttestationResult; at: number; reason: string;
  evidence: EvidenceRef[]; positiveWorked: boolean | null; negativeCount: number;
  independentlyObserved: boolean; cleanStreak: number; promotionThreshold: number;
}
export type AssuranceEvent = { kind: 'ATTESTATION'; run: AttestationRun } | { kind: 'CAPABILITY'; record: CapabilityRecord };
export interface AssuranceStore { append(event: AssuranceEvent): void; list(): AssuranceEvent[] }
export class MemoryAssuranceStore implements AssuranceStore {
  private events: AssuranceEvent[] = [];
  append(event: AssuranceEvent): void { this.events.push(structuredClone(event)); }
  list(): AssuranceEvent[] { return structuredClone(this.events); }
}
/** EF-2A PoC persistence only; no production database migration. */
export class JsonlAssuranceStore implements AssuranceStore {
  constructor(private readonly file: string) { fs.mkdirSync(path.dirname(file), { recursive: true }); }
  append(event: AssuranceEvent): void { fs.appendFileSync(this.file, `${JSON.stringify(event)}\n`, 'utf8'); }
  list(): AssuranceEvent[] { return fs.existsSync(this.file) ? fs.readFileSync(this.file, 'utf8').split('\n').filter(Boolean).map(line => JSON.parse(line) as AssuranceEvent) : []; }
}

/** One shared proof engine for Web, VM, Deno, cloud and experimental backends. */
export class AttestationService implements AssuranceResolver {
  private readonly evidenceRoot: string;
  constructor(private readonly store: AssuranceStore, evidenceRoot: string) { this.evidenceRoot = fs.realpathSync(evidenceRoot); }
  private refs(paths: string[]): EvidenceRef[] {
    if (!paths.length) throw new Error('ATTESTATION_EVIDENCE_MISSING');
    return paths.map(candidate => {
      const real = fs.realpathSync(candidate);
      const relative = path.relative(this.evidenceRoot, real);
      if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) throw new Error('ATTESTATION_EVIDENCE_OUTSIDE_ROOT');
      if (!fs.statSync(real).isFile()) throw new Error('ATTESTATION_EVIDENCE_NOT_FILE');
      return { path: real, sha256: sha256File(real) };
    });
  }
  private cleanStreak(capability: SecurityCapability, backendId: string, fingerprint: string): number {
    let streak = 0;
    const runs = this.store.list().filter((e): e is Extract<AssuranceEvent, { kind: 'ATTESTATION' }> => e.kind === 'ATTESTATION')
      .map(e => e.run).filter(r => r.capability === capability && r.backendId === backendId);
    for (let i = runs.length - 1; i >= 0; i--) {
      const run = runs[i]!;
      if (run.fingerprint !== fingerprint || run.result !== 'ATTESTED') break;
      streak++;
    }
    return streak;
  }
  latest(backendId: string, capability: SecurityCapability): CapabilityRecord | null {
    const records = this.store.list().filter((e): e is Extract<AssuranceEvent, { kind: 'CAPABILITY' }> =>
      e.kind === 'CAPABILITY' && e.record.backendId === backendId && e.record.capability === capability);
    return records.at(-1)?.record ?? null;
  }
  assess(backendId: string, capability: SecurityCapability, current: AssuranceFingerprintInput,
    mechanismConfigured: boolean, now = Date.now()): EffectiveCapability {
    const record = this.latest(backendId, capability);
    const effective = evaluateCapability(record, capability, current, mechanismConfigured, now);
    if (!effective.eligible) return effective;
    const runs = this.store.list().filter((e): e is Extract<AssuranceEvent, { kind: 'ATTESTATION' }> =>
      e.kind === 'ATTESTATION' && e.run.backendId === backendId && e.run.capability === capability).map(e => e.run);
    const last = runs.at(-1);
    let streak = 0;
    for (let i = runs.length - 1; i >= 0; i--) {
      if (runs[i]!.result !== 'ATTESTED' || runs[i]!.fingerprint !== effective.fingerprint) break;
      streak++;
    }
    const beforeStreak = runs[runs.length - streak - 1];
    const threshold = beforeStreak?.result === 'FAILED' && beforeStreak.fingerprint === effective.fingerprint ? 3 : 2;
    if (!last || last.id !== record?.attestationId || streak < threshold || last.cleanStreak !== streak) {
      return { ...effective, state: 'ENFORCED', eligible: false, reason: 'ATTESTATION_HISTORY_INVALID' };
    }
    return effective;
  }
  async attest(record: CapabilityRecord, input: AssuranceFingerprintInput, suite: AttestationSuite,
    inspection: { mechanismConfigured: boolean; evidencePaths: string[] }, ttlMs: number | null = null): Promise<{ run: AttestationRun; record: CapabilityRecord }> {
    const at = Date.now(); const fingerprint = assuranceFingerprint(input);
    let result: AttestationResult = 'INCONCLUSIVE'; let reason = 'SUITE_NOT_RUN';
    let evidence: EvidenceRef[] = []; let positiveWorked: boolean | null = null; let negativeCount = 0; let independentlyObserved = false;
    if (record.capability === undefined || record.backendId !== input.backendId) reason = 'CAPABILITY_RECORD_MISMATCH';
    else if (suite.version !== input.attestationSuiteVersion) reason = 'SUITE_VERSION_MISMATCH';
    else if (!inspection.mechanismConfigured) reason = 'MECHANISM_NOT_CONFIGURED';
    else if (!inspection.evidencePaths.length) reason = 'MECHANISM_INSPECTION_EVIDENCE_MISSING';
    else if (!Number.isSafeInteger(suite.requiredNegativeControls) || suite.requiredNegativeControls < 1) reason = 'SUITE_CONTROL_COUNT_INVALID';
    else try {
      const observations = await suite.run(); positiveWorked = observations.positive.worked;
      negativeCount = observations.negatives.length;
      const paths = [...inspection.evidencePaths, ...observations.positive.evidencePaths,
        ...observations.negatives.flatMap(control => control.evidencePaths)];
      evidence = this.refs(paths);
      independentlyObserved = [observations.positive, ...observations.negatives].some(control => control.independent);
      if (!observations.positive.worked) reason = 'POSITIVE_CONTROL_FAILED';
      else if (!observations.positive.evidencePaths.length) reason = 'POSITIVE_EVIDENCE_MISSING';
      else if (!observations.negatives.length) reason = 'NEGATIVE_CONTROL_MISSING';
      else if (observations.negatives.some(control => control.worked)) { result = 'FAILED'; reason = 'NEGATIVE_CONTROL_ALLOWED'; }
      else if (observations.negatives.some(control => !control.attribution?.mechanism || !control.attribution.code || !control.evidencePaths.length)) reason = 'DENIAL_UNATTRIBUTED';
      else if (observations.negatives.length < suite.requiredNegativeControls) { result = 'PARTIAL'; reason = 'NEGATIVE_CONTROL_COVERAGE_PARTIAL'; }
      else { result = 'ATTESTED'; reason = 'POSITIVE_AND_ATTRIBUTED_NEGATIVE_CONTROLS_PASSED'; }
    } catch (error) { reason = `SUITE_OR_EVIDENCE_ERROR:${String(error)}`; }
    const previousFailureSameFingerprint = record.state === 'FAILED' && record.fingerprint === fingerprint;
    const threshold = previousFailureSameFingerprint ? 3 : 2;
    const streak = result === 'ATTESTED' ? this.cleanStreak(record.capability, input.backendId, fingerprint) + 1 : 0;
    const run: AttestationRun = { id: randomUUID(), capability: record.capability, backendId: input.backendId,
      fingerprint, suiteVersion: suite.version, result, at, reason, evidence, positiveWorked, negativeCount,
      independentlyObserved, cleanStreak: streak, promotionThreshold: threshold };
    let next: CapabilityRecord;
    if (result === 'FAILED') next = { ...record, ...input, state: 'FAILED', fingerprint, testedAt: at,
      expiresAt: null, attestationId: run.id, evidence, failureReason: reason, invalidatedReason: null };
    else if (result === 'ATTESTED' && streak >= threshold) next = { ...record, ...input, state: 'ATTESTED', fingerprint,
      testedAt: at, expiresAt: ttlMs === null ? null : at + ttlMs, attestationId: run.id, evidence,
      failureReason: null, invalidatedReason: null };
    else if (record.state === 'FAILED') next = { ...record, testedAt: at, invalidatedReason: result === 'ATTESTED' ? 'RECOVERY_PENDING' : reason };
    else next = { ...record, ...input, state: inspection.mechanismConfigured ? 'ENFORCED' : 'DECLARED', fingerprint,
      testedAt: at, expiresAt: null, attestationId: run.id, evidence, failureReason: null,
      invalidatedReason: result === 'ATTESTED' ? 'SECOND_CLEAN_RUN_REQUIRED' : reason };
    this.store.append({ kind: 'ATTESTATION', run }); this.store.append({ kind: 'CAPABILITY', record: next });
    return { run, record: next };
  }
}
