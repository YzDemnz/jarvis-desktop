import { createHash } from 'node:crypto';
import { safeContextText } from '../../src/fabric/ContinuityState';
import type { ResultVerification, VerificationContract, VerificationState } from '../../src/fabric/Verification';
import { checkedContract, verificationCriteriaHash, verifierVersion } from './VerificationService';

export type ConciliusRole = 'producer' | 'critic' | 'repair';
export interface ConciliusNode {
  id: string; role: ConciliusRole; dependsOn: string[];
  providerId: 'ollama-local' | 'llama-cpp-local' | 'bootstrap-local'; model: string; prompt: string;
  verification?: VerificationContract;
  maxOutputTokens?:number;
}
export interface ConciliusPlan { version: 1; dataClass: 'LOCAL_ONLY'; nodes: ConciliusNode[] }
export type ConciliusNodeState = 'PENDING' | 'STARTED' | 'PRODUCED' | 'VERIFIED' | 'FAILED' | 'ADVISORY' | 'SKIPPED' | 'STOPPED' | 'INTERRUPTED';
export interface ConciliusNodeRecord {
  nodeId: string; operationId: string; role: ConciliusRole; state: ConciliusNodeState;
  subjectHash: string | null; verification: ResultVerification | null;
  startedAt: number | null; finishedAt: number | null; reason: string | null;
  contextUsage?:import('./DependencyContext').ContextUsage;
}
export interface ConciliusGraph {
  version: 1; graphId: string; taskId: string; planHash: string; plan: ConciliusPlan;
  state: 'STARTED' | 'VERIFIED' | 'PRODUCED' | 'FAILED' | 'INCONCLUSIVE' | 'REVIEW_REQUIRED' | 'STOPPED' | 'INTERRUPTED';
  nodes: ConciliusNodeRecord[]; createdAt: number; updatedAt: number; deadlineAt: number;
  resultOperationId: string | null; finalVerificationId: string | null; reason: string | null;
  limits: { maxInferenceNodes: 4; maxRepairRounds: 1; durationMs: number };
  organization?:{policy:string;classificationModelCalls:number;plannedInferenceCalls:number;reviewRequested:boolean;automaticPaidFallback:boolean;verificationScope:string};
}
export interface ConciliusGraphStore {
  graphRecord(graphId: string): unknown | null;
  writeGraphRecord(graphId: string, graph: unknown): void;
}
export interface ConciliusHost {
  execute(operationId: string, prompt: string, selection: { providerId: string; model: string; continuation?: { taskId: string; revision: number };dependencyOperations?:string[];maxOutputTokens?:number;followupFormat?:true }): Promise<{ ok: boolean; taskId: string; operationId: string; text?: string;contextUsage?:import('./DependencyContext').ContextUsage }>;
  checkpoint(taskId: string): { revision: number } | null;
  verify(sourceOperationId: string, contract: VerificationContract, gate: () => void): ResultVerification | Promise<ResultVerification>;
  /** A root-derived capability, never an invented renderer/user admission. */
  gate(): void;
  /** Revokes/aborts this root and every owned node operation. */
  stop(): void;
}
const hash = (text: string) => createHash('sha256').update(text).digest('hex');
const canonical = (value: unknown): string => JSON.stringify(value, (_key, item: unknown) => item && typeof item === 'object' && !Array.isArray(item)
  ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b))) : item);
const identifier = (value: unknown, max = 64): value is string => typeof value === 'string' && new RegExp(`^[a-zA-Z][a-zA-Z0-9_-]{0,${max - 1}}$`).test(value)
  && !['__proto__', 'constructor', 'prototype'].includes(value);
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const keys = (value: Record<string, unknown>, allowed: string[]) => Object.keys(value).every(key => allowed.includes(key));
const publicText = (value: unknown, max: number): value is string => typeof value === 'string' && value.length > 0 && value.length <= max && safeContextText(value) === value;

function validateContract(value: unknown): VerificationContract {
  // One trusted criteria validator, shared with ordinary Connected AI; not a
  // second verifier registry with broader limits or independently drifting rules.
  return structuredClone(checkedContract(value));
}

/** Closed, ordered DAG. No generated role/provider/tools, loops or implicit repair. */
export function validateConciliusPlan(raw: unknown): ConciliusPlan {
  if (!object(raw) || !keys(raw, ['version', 'dataClass', 'nodes']) || raw.version !== 1 || raw.dataClass !== 'LOCAL_ONLY'
    || !Array.isArray(raw.nodes) || raw.nodes.length < 1 || raw.nodes.length > 4) throw Error('CONCILIUS_INVALID_PLAN');
  const nodes: ConciliusNode[] = [];
  for (const entry of raw.nodes) {
    if (!object(entry) || !keys(entry, ['id', 'role', 'dependsOn', 'providerId', 'model', 'prompt', 'verification','maxOutputTokens']) || !identifier(entry.id)
      || nodes.some(node => node.id === entry.id) || !['producer', 'critic', 'repair'].includes(String(entry.role))
      || !['ollama-local', 'llama-cpp-local','bootstrap-local'].includes(String(entry.providerId)) || !publicText(entry.model, 200)
      || !/^[a-zA-Z0-9._:/-]{1,200}$/.test(entry.model) || !publicText(entry.prompt, 16000) || !entry.prompt.trim()
      || !Array.isArray(entry.dependsOn) || entry.dependsOn.length > 3) throw Error('CONCILIUS_INVALID_NODE');
    const dependencies = entry.dependsOn.map(dependency => typeof dependency === 'number' && Number.isSafeInteger(dependency)
      ? nodes[dependency]?.id : dependency);
    if ((nodes.length > 0 && dependencies.length === 0) || dependencies.some(dependency => typeof dependency !== 'string' || !nodes.some(node => node.id === dependency))
      || new Set(dependencies).size !== dependencies.length) throw Error('CONCILIUS_INVALID_DEPENDENCY');
    const node: ConciliusNode = { id: entry.id, role: entry.role as ConciliusRole, dependsOn: dependencies as string[],
      providerId: entry.providerId as ConciliusNode['providerId'], model: entry.model, prompt: entry.prompt };
    if (entry.verification !== undefined) node.verification = validateContract(entry.verification);
    if(entry.maxOutputTokens!==undefined){if(!Number.isSafeInteger(entry.maxOutputTokens)||Number(entry.maxOutputTokens)<64||Number(entry.maxOutputTokens)>512)throw Error('CONCILIUS_OUTPUT_BUDGET_INVALID');node.maxOutputTokens=Number(entry.maxOutputTokens);}
    // Critic agreement stays advisory even if it is grammatical or exact text.
    if (node.role === 'critic' && node.verification && node.verification.kind !== 'MODEL_REVIEW') throw Error('CONCILIUS_CRITIC_IS_ADVISORY');
    if (node.role === 'repair') {
      const target = nodes.find(prior => prior.id === node.dependsOn[0]);
      if (nodes.some(prior => prior.role === 'repair') || node.dependsOn.length !== 1 || target?.role !== 'producer'
        || !target.verification || target.verification.kind === 'MODEL_REVIEW' || !node.verification
        || canonical(node.verification) !== canonical(target.verification)) throw Error('CONCILIUS_REPAIR_MUST_PRESERVE_CRITERIA');
    }
    nodes.push(node);
  }
  if (nodes[0]!.role !== 'producer' || nodes.every(node => node.role === 'critic')) throw Error('CONCILIUS_PRODUCER_REQUIRED');
  return { version: 1, dataClass: 'LOCAL_ONLY', nodes };
}

/** Bounded inference coordinator; all providers, authority, verification and effects belong to the injected host. */
export class ConciliusCoordinator {
  private readonly active = new Map<string, { graph: ConciliusGraph; cancelled: boolean; cleanupFailed: boolean; reject: (error: Error) => void }>();
  private readonly durationMs: number;
  constructor(private readonly db: ConciliusGraphStore, private readonly host: ConciliusHost, options: { durationMs?: number } = {}) {
    this.durationMs = options.durationMs ?? 900000;
    if (!Number.isSafeInteger(this.durationMs) || this.durationMs < 1 || this.durationMs > 900000) throw Error('CONCILIUS_INVALID_DURATION');
  }
  private persist(graph: ConciliusGraph): void { graph.updatedAt = Date.now(); this.db.writeGraphRecord(graph.graphId, structuredClone(graph)); }
  graph(graphId: string): ConciliusGraph | null {
    const stored = this.db.graphRecord(graphId) as ConciliusGraph | null;
    if (!stored) return null;
    if (stored.state === 'STARTED' && !this.active.has(graphId)) {
      stored.state = 'INTERRUPTED'; stored.reason = 'Restart requires a new explicit graph; no inference or effect is replayed.';
      stored.nodes.forEach(node => { if (node.state === 'STARTED') { node.state = 'INTERRUPTED'; node.finishedAt = Date.now(); } });
      this.persist(stored);
    }
    return structuredClone(stored);
  }
  recover(graphId: string): ConciliusGraph | null { return this.graph(graphId); }
  stop(graphId: string): void {
    const active = this.active.get(graphId); if (!active || active.cancelled) return;
    active.cancelled = true;
    try { this.host.stop(); } catch { active.cleanupFailed = true; }
    finally { active.reject(Error('CONCILIUS_STOPPED')); }
  }
  async execute(rootOperationId: string, rawPlan: unknown): Promise<ConciliusGraph> {
    const plan = validateConciliusPlan(rawPlan);
    if (!/^[a-zA-Z0-9._:/-]{1,160}$/.test(rootOperationId) || safeContextText(rootOperationId) !== rootOperationId) throw Error('CONCILIUS_INVALID_ROOT');
    if (this.db.graphRecord(rootOperationId) || this.active.size) throw Error('CONCILIUS_GRAPH_ALREADY_USED_OR_BUSY');
    this.host.gate();
    const now = Date.now(), graph: ConciliusGraph = { version: 1, graphId: rootOperationId, taskId: rootOperationId, planHash: hash(canonical(plan)), plan,
      state: 'STARTED', createdAt: now, updatedAt: now, deadlineAt: now + this.durationMs, resultOperationId: null, finalVerificationId: null, reason: null,
      limits: { maxInferenceNodes: 4, maxRepairRounds: 1, durationMs: this.durationMs },
      nodes: plan.nodes.map((node, index) => ({ nodeId: node.id, operationId: index === 0 ? rootOperationId : rootOperationId + '-node-' + index, role: node.role,
        state: 'PENDING', subjectHash: null, verification: null, startedAt: null, finishedAt: null, reason: null })) };
    let reject!: (error: Error) => void;
    const cancelled = new Promise<never>((_resolve, fail) => { reject = fail; });
    const active = { graph, cancelled: false, cleanupFailed: false, reject }; this.active.set(rootOperationId, active);
    try { this.persist(graph); } catch (error) { this.active.delete(rootOperationId); throw error; }
    const gate = () => {
      if (active.cancelled || Date.now() >= graph.deadlineAt) throw Error('CONCILIUS_STOPPED_OR_TIMED_OUT');
      this.host.gate();
    };
    const timer = setTimeout(() => this.stop(rootOperationId), this.durationMs);
    const nodeById = (id: string) => graph.nodes.find(node => node.nodeId === id)!;
    const hasRepair = (id: string) => plan.nodes.some(node => node.role === 'repair' && node.dependsOn.includes(id));
    try {
      for (let index = 0; index < plan.nodes.length; index++) {
        gate();
        const node = plan.nodes[index]!, record = graph.nodes[index]!;
        const dependencies = node.dependsOn.map(nodeById);
        if (dependencies.some(dependency => ['FAILED', 'SKIPPED', 'STOPPED', 'INTERRUPTED'].includes(dependency.state)) && node.role !== 'repair') {
          record.state = 'SKIPPED'; record.reason = 'Required dependency failed; no downstream inference.'; record.finishedAt = Date.now(); this.persist(graph); continue;
        }
        if (node.role === 'repair' && (dependencies[0]?.state !== 'FAILED' || dependencies[0]?.verification?.state !== 'FAILED'
          || dependencies[0]?.verification?.strength !== 'DETERMINISTIC')) {
          record.state = 'SKIPPED'; record.reason = 'Repair is authorized only for an observed failed verification.'; record.finishedAt = Date.now(); this.persist(graph); continue;
        }
        const checkpoint = index === 0 ? null : this.host.checkpoint(graph.taskId);
        if (index > 0 && (!checkpoint || !Number.isSafeInteger(checkpoint.revision))) throw Error('CONCILIUS_CHECKPOINT_REQUIRED');
        record.state = 'STARTED'; record.startedAt = Date.now(); this.persist(graph);
        const result = await Promise.race([this.host.execute(record.operationId, node.prompt, { providerId: node.providerId, model: node.model,dependencyOperations:dependencies.map(item=>item.operationId),...(node.maxOutputTokens?{maxOutputTokens:node.maxOutputTokens}:{}),...(node.verification?.kind==='FOLLOWUP_BRIEF'?{followupFormat:true as const}:{}),
          ...(checkpoint ? { continuation: { taskId: graph.taskId, revision: checkpoint.revision } } : {}) }), cancelled]);
        gate();
        if(result.contextUsage)record.contextUsage=structuredClone(result.contextUsage);
        if (result.taskId !== graph.taskId || result.operationId !== record.operationId) throw Error('CONCILIUS_OPERATION_IDENTITY_MISMATCH');
        if (!result.ok || typeof result.text !== 'string' || !result.text.trim()) {
          record.state = 'FAILED'; record.reason = 'Provider operation did not produce a result.';
        } else {
          record.subjectHash = hash(result.text);
          record.state = node.role === 'critic' ? 'ADVISORY' : 'PRODUCED';
          if (node.verification) {
            const verification = await Promise.race([Promise.resolve(this.host.verify(record.operationId, node.verification, gate)), cancelled]);
            gate();
            if (verification.operationId !== record.operationId || verification.taskId !== graph.taskId || verification.subjectHash !== record.subjectHash)
              throw Error('CONCILIUS_VERIFICATION_IDENTITY_MISMATCH');
            if (verification.verifierVersion !== verifierVersion(verification.verifierId) || verification.verifierId !== 'builtin:' + node.verification.kind || verification.category !== node.verification.kind
              || verification.criteriaHash !== verificationCriteriaHash(node.verification)
              || (verification.state === 'VERIFIED' && (!verification.checks.length || verification.checks.some(check => check.passed !== true)))) throw Error('CONCILIUS_VERIFIER_UNSUPPORTED');
            record.verification = structuredClone(verification);
            if (node.role !== 'critic') record.state = verification.state === 'VERIFIED' && verification.strength === 'DETERMINISTIC' && verification.expiresAt > Date.now()
              ? 'VERIFIED' : verification.state === 'FAILED' ? 'FAILED' : 'PRODUCED';
          }
        }
        record.finishedAt = Date.now(); this.persist(graph);
        if (record.state === 'FAILED' && (!hasRepair(node.id) || record.verification?.state !== 'FAILED' || record.verification.strength !== 'DETERMINISTIC')) {
          graph.state = 'FAILED'; graph.reason = 'Required operation/verification failed; no implicit retry.'; break;
        }
      }
      gate();
      if (graph.state === 'STARTED') {
        const output = [...graph.nodes].reverse().find(node => node.role !== 'critic' && node.state !== 'SKIPPED');
        if (!output) { graph.state = 'INCONCLUSIVE'; graph.reason = 'No produced result.'; }
        else {
          graph.resultOperationId = output.operationId;
          const lineageVerified = (record: ConciliusNodeRecord): boolean => {
            const node = plan.nodes.find(item => item.id === record.nodeId)!;
            if (record.role !== 'critic' && (record.state !== 'VERIFIED' || record.verification?.state !== 'VERIFIED'
              || record.verification.strength !== 'DETERMINISTIC' || record.verification.subjectHash !== record.subjectHash
              || record.verification.expiresAt <= Date.now())) return false;
            return node.dependsOn.every(id => {
              const dependency = nodeById(id);
              if (node.role === 'repair' && dependency.state === 'FAILED') {
                const repaired = plan.nodes.find(item => item.id === id)!;
                return repaired.dependsOn.every(prior => lineageVerified(nodeById(prior)));
              }
              return lineageVerified(dependency);
            });
          };
          if (output.state === 'VERIFIED' && lineageVerified(output)) { graph.state = 'VERIFIED'; graph.finalVerificationId = output.verification!.id; }
          else {
            const verificationState: VerificationState = output.verification?.state ?? 'PRODUCED';
            graph.state = verificationState === 'FAILED' ? 'FAILED' : verificationState === 'REVIEW_REQUIRED' ? 'REVIEW_REQUIRED'
              : verificationState === 'INCONCLUSIVE' ? 'INCONCLUSIVE' : 'PRODUCED';
            graph.reason = 'No scoped deterministic proof for final result and its required production dependencies; critic agreement is advisory.';
          }
        }
      }
    } catch (error) {
      const stopped = active.cancelled || Date.now() >= graph.deadlineAt;
      graph.state = stopped && !active.cleanupFailed ? 'STOPPED' : 'REVIEW_REQUIRED';
      graph.reason = active.cleanupFailed ? 'Root cancelled, but host cleanup failed; process cancellation requires review.'
        : stopped ? 'Root cancelled or time limit reached; no replay or continuation admitted.' : 'Coordinator denied identity, authority, checkpoint or verifier admission.';
      graph.nodes.forEach(node => { if (node.state === 'STARTED') { node.state = stopped ? 'STOPPED' : 'INTERRUPTED'; node.finishedAt = Date.now(); } });
      if (!stopped) { try { this.host.stop(); } catch { /* Admission remains denied; cleanup belongs to the host. */ } }
      void error;
    } finally {
      clearTimeout(timer); this.active.delete(rootOperationId);
      graph.nodes.forEach(node => { if (node.state === 'PENDING') { node.state = 'SKIPPED'; node.finishedAt = Date.now(); node.reason = 'Graph ended before this operation.'; } });
      this.persist(graph);
    }
    return structuredClone(graph);
  }
}
