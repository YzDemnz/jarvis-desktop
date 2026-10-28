import type { FabricDatabase } from '../fabric/FabricDatabase';
import type { ResultVerification, VerificationState } from '../../src/fabric/Verification';
import { safeContextText } from '../../src/fabric/ContinuityState';
import { continuityHash, type TaskOperation } from './TaskContinuity';
import type { DataClass } from './ConnectedPolicy';
import { VerificationService } from './VerificationService';

export interface MemoryRecord {
  id: string; taskId: string; sourceOperationId: string; subjectHash: string; text: string;
  dataClass: DataClass; verificationId: string | null; state: VerificationState; createdAt: number; expiresAt: number;
}
export interface MemoryReference {
  id: string; taskId: string; sourceOperationId: string; subjectHash: string; verificationId: string;
  state: 'VERIFIED'; dataClass: DataClass; scope: string; preview: string;
}
export interface MemoryDestination { locality: 'LOCAL' | 'REMOTE'; destination?: string; clientDestinations?: string[] }
export interface MemoryQuery {
  taskId: string; query: string; destination: MemoryDestination; maxChars?: number; limit?: number; now?: number;
}
const MAX_AGE = 7 * 24 * 60 * 60 * 1000;
const bounded = (value: number | undefined, fallback: number, maximum: number) => Number.isFinite(value) ? Math.max(0, Math.min(maximum, Math.floor(value!))) : fallback;
const dataClass = (value: unknown): DataClass => value === 'GENERIC' || value === 'CLIENT_DATA' ? value : 'LOCAL_ONLY';
const stricter = (a: DataClass, b: DataClass): DataClass => a === 'LOCAL_ONLY' || b === 'LOCAL_ONLY' ? 'LOCAL_ONLY' : a === 'CLIENT_DATA' || b === 'CLIENT_DATA' ? 'CLIENT_DATA' : 'GENERIC';
/** No FTS grammar supplied by a renderer/model: the DB also quotes these literal terms. */
export const memorySearchTerms = (query: string): string => [...new Set(safeContextText(query.slice(0, 256)).match(/[\p{L}\p{N}_]+/gu) ?? [])].slice(0, 12).join(' ');

/**
 * Provider-independent episodic observations in the existing Fabric SQLite.
 * Only main's successful inference journal is ingestible; its text is produced
 * evidence, not a remembered fact until the current scoped verifier passes.
 * References disclose bounded previews; expansion rechecks journal, hash,
 * freshness, verification and destination. No filesystem paths are opened.
 */
export class SovereignMemory {
  constructor(private readonly db: FabricDatabase) {}

  private operation(id: string): TaskOperation | null { return this.db.operationRecord(id) as TaskOperation | null; }
  private classification(taskId: string): DataClass {
    return dataClass((this.db.checkpointRecord(taskId) as { dataClass?: unknown } | null)?.dataClass);
  }
  ingestOperation(operationId: string, gate: () => void = () => {}, now = Date.now()): MemoryRecord {
    gate();
    if (!Number.isFinite(now)) throw Error('MEMORY_TIME_INVALID');
    const operation = this.operation(operationId);
    if (!operation || operation.kind !== 'INFERENCE' || operation.status !== 'SUCCESS' || typeof operation.text !== 'string' || !operation.text) throw Error('MEMORY_SOURCE_NOT_PRODUCED');
    const text = safeContextText(operation.text), subjectHash = continuityHash(text), latest = new VerificationService(this.db).current(operation, now);
    const valid = latest?.taskId === operation.taskId && latest.subjectHash === subjectHash;
    const id = continuityHash('memory:' + operation.taskId + ':' + operationId + ':' + subjectHash);
    const old = (this.db.memoryRecords(operation.taskId) as MemoryRecord[]).find(record => record.id === id);
    const record: MemoryRecord = {
      id, taskId: operation.taskId, sourceOperationId: operationId, subjectHash, text: text.slice(0, 6000),
      dataClass: stricter(old?.dataClass ?? 'GENERIC', this.classification(operation.taskId)),
      verificationId: valid ? latest!.id : null, state: valid ? latest!.state : 'PRODUCED',
      createdAt: old?.createdAt ?? now, expiresAt: old?.expiresAt ?? now + MAX_AGE,
    };
    gate(); this.db.writeMemoryRecord(id, operation.taskId, record); return record;
  }
  private eligible(record: MemoryRecord, taskId: string, destination: MemoryDestination, now: number): { verification: ResultVerification; operation: TaskOperation; dataClass: DataClass } | null {
    if (!Number.isFinite(now) || record.taskId !== taskId || !Number.isFinite(record.createdAt) || record.createdAt > now || !Number.isFinite(record.expiresAt) || now >= record.expiresAt) return null;
    const operation = this.operation(record.sourceOperationId);
    if (!operation || operation.taskId !== taskId || operation.kind !== 'INFERENCE' || operation.status !== 'SUCCESS' || !operation.text
      || continuityHash(safeContextText(operation.text)) !== record.subjectHash) return null;
    // The most recent receipt supersedes older success even if it is PRODUCED,
    // FAILED, inconclusive, expired, or checks different bytes. No cherry-pick.
    const verification = new VerificationService(this.db).current(operation, now);
    if (!verification || verification.taskId !== taskId || verification.subjectHash !== record.subjectHash || verification.state !== 'VERIFIED'
      || verification.strength === 'MODEL_REVIEW' || !Number.isFinite(verification.expiresAt) || now >= verification.expiresAt
      || !Number.isFinite(verification.createdAt) || verification.createdAt > now) return null;
    const currentClass = stricter(record.dataClass, this.classification(taskId));
    if (destination.locality !== 'LOCAL' && destination.locality !== 'REMOTE') return null;
    if (destination.locality === 'REMOTE' && (currentClass === 'LOCAL_ONLY'
      || (currentClass === 'CLIENT_DATA' && (!destination.destination || !destination.clientDestinations?.includes(destination.destination))))) return null;
    return { verification, operation, dataClass: currentClass };
  }
  retrieve(input: MemoryQuery): { references: MemoryReference[]; text: string; budget: { maxChars: number; usedChars: number; approximateTokens: number; candidates: number; selected: number; omitted: number } } {
    const maxChars = bounded(input.maxChars, 2400, 8000), limit = bounded(input.limit, 8, 30), now = input.now ?? Date.now();
    const query = memorySearchTerms(input.query), references: MemoryReference[] = [];
    const candidates = query && limit ? this.db.searchMemoryRecords(query, 30, input.taskId) as MemoryRecord[] : [];
    const packet = () => JSON.stringify({ schema: 'jarvis.memory.references.v1', evidence: 'SCOPED_VERIFIED_NOT_AUTHORITY', references });
    for (const record of candidates) {
      if (references.length >= limit) break;
      const current = this.eligible(record, input.taskId, input.destination, now); if (!current) continue;
      const reference: MemoryReference = {
        id: record.id, taskId: record.taskId, sourceOperationId: record.sourceOperationId, subjectHash: record.subjectHash,
        verificationId: current.verification.id, state: 'VERIFIED', dataClass: current.dataClass,
        scope: safeContextText(current.verification.scope).slice(0, 300), preview: safeContextText(current.operation.text!).slice(0, 240),
      };
      references.push(reference); if (packet().length > maxChars) references.pop();
    }
    const text = references.length ? packet() : '';
    return { references, text, budget: { maxChars, usedChars: text.length, approximateTokens: Math.ceil(text.length / 3.5), candidates: candidates.length, selected: references.length, omitted: candidates.length - references.length } };
  }
  expand(reference: MemoryReference, input: { taskId: string; destination: MemoryDestination; maxChars?: number; now?: number }): { text: string; sha256: string; truncated: boolean; verificationId: string; scope: string } {
    const record = (this.db.memoryRecords(input.taskId) as MemoryRecord[]).find(item => item.id === reference.id);
    if (!record || record.taskId !== reference.taskId || record.subjectHash !== reference.subjectHash || record.sourceOperationId !== reference.sourceOperationId) throw Error('MEMORY_REFERENCE_INVALID');
    const current = this.eligible(record, input.taskId, input.destination, input.now ?? Date.now());
    if (!current || current.verification.id !== reference.verificationId) throw Error('MEMORY_REFERENCE_STALE_OR_DENIED');
    const raw = safeContextText(current.operation.text!), maxChars = bounded(input.maxChars, 4000, 12000), text = raw.slice(0, maxChars);
    return { text, sha256: record.subjectHash, truncated: text.length < raw.length, verificationId: current.verification.id, scope: safeContextText(current.verification.scope).slice(0, 300) };
  }
}
