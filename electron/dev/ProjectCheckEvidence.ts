import {createHash, randomUUID} from 'node:crypto';
import type {FabricDatabase} from '../fabric/FabricDatabase';
import type {CommandResult, VerificationCheck} from '../../src/types';
import {safeContextText} from '../../src/fabric/ContinuityState';
import {checkInput} from '../../src/dev/checkInputs';
export {checkInput} from '../../src/dev/checkInputs';

export interface ProjectSnapshot { root: string; files: {path: string; hash: string}[] }
export interface CheckObservation {
  id: string; checkId: string; commandId: string | null; beforeHash: string; afterHash: string;
  exitCode: number | null; cancelled: boolean; timedOut: boolean; excerpt: string; at: number;
}
export interface ProjectCheckProof {
  kind: 'PROJECT_CHECKS'; version: 1; operationId: string; taskId: string; root: string;
  state: 'IMPLEMENTED' | 'TESTED' | 'VERIFIED' | 'FAILED' | 'REVIEW_REQUIRED' | 'INTERRUPTED';
  status: 'STARTED' | 'SUCCESS' | 'FAILED' | 'REVIEW_REQUIRED' | 'INTERRUPTED';
  criteriaHash: string; protectedFiles: ProjectSnapshot['files']; checks: VerificationCheck[];
  observations: CheckObservation[]; subjectHash: string | null; reason: string;
  scope: string; authorityEpoch: number; updatedAt: number;
}
const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
// These inputs determine checks; editing them cannot certify the original checks.
const protectedSet = (s: ProjectSnapshot) => s.files.filter(f => checkInput(f.path));
const scope = 'Configured commands exited successfully against unchanged check inputs and the same bounded indexed public-file snapshot. Not universal code correctness or OS isolation.';
const key = (id: string) => 'project-checks:' + id;

/** Main-owned observations. Renderer fields and model verdicts cannot settle a check. */
export class ProjectCheckEvidence {
  private live = new Set<string>();
  private busy = new Set<string>();
  constructor(private readonly db: () => FabricDatabase, private readonly snapshot: (root: string) => Promise<ProjectSnapshot>) {}
  read(id: string): ProjectCheckProof | null { return this.db().operationRecord(key(id)) as ProjectCheckProof | null; }
  private save(p: ProjectCheckProof) { p.updatedAt = Date.now(); this.db().writeOperationRecord(p.operationId, p.taskId, p); return p; }
  async seal(id: string, root: string, checks: VerificationCheck[], epoch: number, gate: () => void) {
    gate(); const existing = this.read(id);
    if (existing) {
      if (!this.live.has(id) && existing.status === 'STARTED') { existing.state = 'INTERRUPTED'; existing.status = 'INTERRUPTED'; existing.reason = 'Restart does not replay commands'; this.save(existing); }
      if (existing.root !== root || !this.live.has(id)) throw Error('CHECK_PROOF_NEW_RUN_REQUIRED');
      return existing.checks;
    }
    const snapshot = await this.snapshot(root); gate();
    if (this.read(id)) throw Error('CHECK_SEAL_ALREADY_CREATED');
    checks = structuredClone(checks);
    this.live.add(id);
    this.save({kind: 'PROJECT_CHECKS', version: 1, operationId: key(id), taskId: id, root,
      state: 'IMPLEMENTED', status: 'STARTED', checks, protectedFiles: protectedSet(snapshot),
      criteriaHash: hash({checks, files: protectedSet(snapshot)}), observations: [], subjectHash: null,
      reason: checks.length ? 'Checks sealed; no command observed yet' : 'No configured checks', scope, authorityEpoch: epoch, updatedAt: Date.now()});
    return checks;
  }
  async observe(id: string, args: Record<string, unknown>, invoke: () => Promise<unknown>, gate: () => void) {
    const proof = this.read(id), check = proof?.checks.find(c => c.id === args.verification);
    if (!proof || !check) return invoke();
    gate();
    // A caller may still execute another FULL command, but it is not this check.
    if (args.executable !== check.request.executable || hash(args.args ?? []) !== hash(check.request.args ?? [])
      || (args.cwd !== undefined && args.cwd !== proof.root) || args.envSubset !== undefined || args.timeoutMs !== undefined) throw Error('CHECK_COMMAND_MISMATCH');
    if (!this.live.has(id) || proof.status === 'INTERRUPTED' || this.busy.has(id)) throw Error('CHECK_PROOF_NOT_ACTIVE');
    this.busy.add(id);
    try {
      const before = await this.snapshot(proof.root); gate();
      if (hash(protectedSet(before)) !== hash(proof.protectedFiles)) throw Error('CHECK_INPUTS_CHANGED');
      const result = await invoke() as CommandResult;
      gate(); const after = await this.snapshot(proof.root); gate();
      const observed: CheckObservation = {id: randomUUID(), checkId: check.id, commandId: result?.commandId ?? null,
        beforeHash: hash(before), afterHash: hash(after), exitCode: result?.exitCode ?? null,
        cancelled: result?.cancelled ?? false, timedOut: result?.timedOut ?? false,
        excerpt: safeContextText(((result?.stdout ?? '') + '\n' + (result?.stderr ?? '')).slice(-1200)), at: Date.now()};
      proof.observations.push(observed);
      if (proof.observations.length > 60) throw Error('CHECK_ATTEMPT_BUDGET');
      proof.state = observed.exitCode === 0 && !observed.cancelled && !observed.timedOut ? 'TESTED' : 'FAILED';
      proof.reason = 'Main observed a managed process result; final snapshot not yet certified';
      this.save(proof); return result;
    } catch (error) {
      if (this.read(id)?.status !== 'INTERRUPTED') { proof.state = 'REVIEW_REQUIRED'; proof.reason = 'Check interrupted, rejected or inputs changed'; this.save(proof); }
      throw error;
    } finally { this.busy.delete(id); }
  }
  async verify(id: string, gate: () => void): Promise<ProjectCheckProof | null> {
    gate(); const proof = this.read(id); if (!proof) return null;
    if (this.busy.has(id)) throw Error('CHECK_STILL_RUNNING');
    if (!this.live.has(id) && proof.status === 'STARTED') { proof.state = 'INTERRUPTED'; proof.status = 'INTERRUPTED'; proof.reason = 'Restart requires a new admitted run; no replay'; return this.save(proof); }
    if (proof.status === 'INTERRUPTED') return proof;
    const current = await this.snapshot(proof.root); gate();
    const observations = proof.checks.map(c => [...proof.observations].reverse().find(o => o.checkId === c.id));
    const stable = hash(protectedSet(current)) === hash(proof.protectedFiles);
    const complete = !!proof.checks.length && observations.every(o => o && o.commandId);
    const passed = complete && observations.every(o => o!.exitCode === 0 && !o!.cancelled && !o!.timedOut);
    const same = observations.every(o => o && o.beforeHash === hash(current) && o.afterHash === hash(current));
    proof.state = !stable ? 'REVIEW_REQUIRED' : !complete ? 'IMPLEMENTED' : !passed ? 'FAILED' : !same ? 'REVIEW_REQUIRED' : 'VERIFIED';
    proof.status = proof.state === 'VERIFIED' ? 'SUCCESS' : proof.state === 'FAILED' ? 'FAILED' : proof.state === 'REVIEW_REQUIRED' ? 'REVIEW_REQUIRED' : 'STARTED';
    proof.subjectHash = hash(current);
    proof.reason = proof.state === 'VERIFIED' ? 'All sealed checks passed on this snapshot' : 'Missing/failed observations or check/source inputs changed';
    return this.save(proof);
  }
  interrupt(id: string) { const proof = this.read(id); if (proof && proof.status === 'STARTED') { proof.state = 'INTERRUPTED'; proof.status = 'INTERRUPTED'; proof.reason = 'Authority stopped; no automatic replay'; this.save(proof); } this.live.delete(id); }
}
