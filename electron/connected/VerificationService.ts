import { createHash, randomUUID } from 'node:crypto';
import type { FabricDatabase } from '../fabric/FabricDatabase';
import type { TaskOperation } from './TaskContinuity';
import { safeContextText } from '../../src/fabric/ContinuityState';
import type { ResultVerification, VerificationContract } from '../../src/fabric/Verification';
export const resultHash = (text: string) => createHash('sha256').update(text).digest('hex');
const canonical = (value: unknown): string => JSON.stringify(value, (_k, v) => v && typeof v === 'object' && !Array.isArray(v) ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => a.localeCompare(b))) : v);
export const verificationCriteriaHash = (input: unknown) => resultHash(canonical(input));
/** Reject receipts from superseded verifier semantics, without rewriting history. */
export const verifierVersion = (id: string): number | undefined => ['builtin:PURE_REDUCER','builtin:FOLLOWUP_BRIEF'].includes(id) ? 2
  : ['transport-only', 'builtin:TEXT_EXACT', 'builtin:JSON_SHAPE', 'builtin:JSON_STRING_LIST', 'builtin:MODEL_REVIEW'].includes(id) ? 1 : undefined;
const plain = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const identifier = (s: unknown): s is string => typeof s === 'string' && /^[A-Za-z][A-Za-z0-9_]{0,60}$/.test(s) && !['constructor', 'prototype', '__proto__'].includes(s);
const reserved = new Set('break case catch class const continue debugger default delete do else enum export extends false finally for function if implements import in instanceof interface let new null package private protected public return static super switch this throw true try typeof var void while with yield await async'.split(' '));
const binding = (s: unknown): s is string => identifier(s) && !reserved.has(s);
export function checkedContract(input: unknown): VerificationContract {
  const bytes = JSON.stringify(input);
  if (!bytes || bytes.length > 6000 || safeContextText(bytes) !== bytes || !plain(input)) throw Error('INVALID_VERIFICATION_CRITERIA');
  const keys = Object.keys(input).sort().join(',');
  if (input.kind === 'MODEL_REVIEW' && keys === 'kind') return input as VerificationContract;
  if (input.kind === 'FOLLOWUP_BRIEF' && keys === 'kind') return input as VerificationContract;
  if (input.kind === 'JSON_STRING_LIST' && keys === 'field,kind' && identifier(input.field)) return input as VerificationContract;
  if (input.kind === 'TEXT_EXACT' && keys === 'expected,kind' && typeof input.expected === 'string' && input.expected.length <= 4000) return input as VerificationContract;
  if (input.kind === 'JSON_SHAPE' && keys === 'fields,kind' && plain(input.fields) && Object.keys(input.fields).length > 0 && Object.keys(input.fields).length <= 30
    && Object.entries(input.fields).every(([k, v]) => identifier(k) && ['string', 'number', 'boolean', 'array'].includes(String(v)))) return input as VerificationContract;
  if (input.kind === 'PURE_REDUCER' && keys === 'cases,fields,functionName,kind' && binding(input.functionName)
    && Array.isArray(input.fields) && input.fields.length === 2 && input.fields.every(identifier)
    && Array.isArray(input.cases) && input.cases.length >= 1 && input.cases.length <= 20
    && input.cases.every(c => plain(c) && Object.keys(c).sort().join(',') === 'expected,items' && typeof c.expected === 'number' && Number.isFinite(c.expected)
      && Array.isArray(c.items) && c.items.length <= 100 && c.items.every(r => plain(r) && Object.values(r).every(n => typeof n === 'number' && Number.isFinite(n))))) return input as VerificationContract;
  throw Error('INVALID_VERIFICATION_CRITERIA');
}
/** No arbitrary eval, executable modules, network, user file paths or provider verdicts. */
export class VerificationService {
  constructor(private readonly db: FabricDatabase) {}
  produced(op: TaskOperation) {
    if (op.kind !== 'INFERENCE' || op.status !== 'SUCCESS' || op.text === null) return;
    this.db.writeVerificationRecord({ id: randomUUID(), taskId: op.taskId, operationId: op.operationId, subjectHash: resultHash(op.text),
      verifierId: 'transport-only', verifierVersion: 1, category: 'PRODUCED', criteriaHash: resultHash('NO_RESULT_CHECK'), state: 'PRODUCED', strength: 'OBSERVATION', scope: 'Inference returned public text; correctness unverified', checks: [], createdAt: Date.now(), expiresAt: Date.now() + 86400000, policyRevision: 0, authorityEpoch: 0 });
  }
  current(op: TaskOperation, now = Date.now()): ResultVerification | null {
    const record = this.db.verificationRecords(op.operationId)[0];
    if (!record) return null;
    if (record.verifierVersion !== verifierVersion(record.verifierId)
      || record.subjectHash !== resultHash(op.text ?? '') || record.expiresAt <= now || op.status !== 'SUCCESS') return { ...record, state: 'REVIEW_REQUIRED', scope: 'Prior verification is stale, expired or subject changed' };
    return record;
  }
  verify(operationId: string, input: unknown, policyRevision: number, authorityEpoch: number, gate: () => void): ResultVerification {
    gate(); const contract = checkedContract(input), op = this.db.operationRecord(operationId) as TaskOperation | null;
    if (!op || op.kind !== 'INFERENCE' || op.status !== 'SUCCESS' || op.text === null) throw Error('VERIFICATION_SUBJECT_NOT_PRODUCED');
    const subjectHash = resultHash(op.text), code = op.text.replace(/^```(?:json|javascript|js)?\s*|\s*```$/g, '').trim();
    const checks: ResultVerification['checks'] = [];
    let scope = '', strength: ResultVerification['strength'] = 'DETERMINISTIC';
    if (contract.kind === 'TEXT_EXACT') {
      scope = 'Exact public text versus admitted reference; not independent truth';
      checks.push({ name: 'exact-reference', passed: op.text.trim() === contract.expected.trim() });
    } else if (contract.kind === 'JSON_SHAPE') {
      scope = 'Top-level JSON field types only; not semantic truth';
      let json: unknown; try { json = JSON.parse(code); } catch { json = null; }
      checks.push({ name: 'json-object', passed: plain(json) });
      for (const [key, type] of Object.entries(contract.fields)) {
        const v = plain(json) ? json[key] : undefined;
        checks.push({ name: 'field:' + key, passed: type === 'array' ? Array.isArray(v) : typeof v === type && (type !== 'number' || Number.isFinite(v)) });
      }
    } else if (contract.kind === 'JSON_STRING_LIST') {
      scope = 'Bounded JSON array of nonempty strings only; not semantic truth';
      let json:unknown;try{json=JSON.parse(code);}catch{json=null;}
      const list=plain(json)?json[contract.field]:undefined;
      checks.push({name:'json-object',passed:plain(json)},{name:'bounded-string-list:'+contract.field,
        passed:Array.isArray(list)&&list.length<=100&&list.every(item=>typeof item==='string'&&item.trim().length>0&&item.length<=2000)});
    } else if (contract.kind === 'FOLLOWUP_BRIEF') {
      scope='Bounded summary, next actions and unknowns; no independent factual verification or executed-work claim';
      let json:unknown;try{json=JSON.parse(code);}catch{json=null;}
      checks.push({name:'followup-shape',passed:plain(json)&&Object.keys(json).sort().join(',')==='summary,tasks,unknowns'&&typeof json.summary==='string'&&json.summary.trim().length>0&&json.summary.length<=2500});
      for(const field of ['tasks','unknowns']){const list=plain(json)?json[field]:undefined;checks.push({name:'followup-'+field,passed:Array.isArray(list)&&(field!=='tasks'||list.length>=1)&&list.length<=16&&list.every(item=>typeof item==='string'&&item.trim().length>0&&item.length<=600)});}
    } else if (contract.kind === 'PURE_REDUCER') {
      scope = 'Closed pure reducer syntax and admitted finite test cases only';
      const [left, right] = contract.fields;
      const pattern = new RegExp('^function\\s+' + contract.functionName + '\\(items\\)\\s*\\{\\s*return[ \\t]+items\\.reduce\\(\\(([a-zA-Z]+),\\s*([a-zA-Z]+)\\)[ \\t]*=>\\s*\\1\\s*\\+\\s*(?:\\2\\.' + left + '\\s*\\*\\s*\\2\\.' + right + '|\\(\\s*\\2\\.' + left + '\\s*\\*\\s*\\2\\.' + right + '\\s*\\)),\\s*0\\);?\\s*\\}$');
      const match = pattern.exec(code), accepted = !!match && match[1] !== match[2] && binding(match[1]) && binding(match[2]);
      checks.push({ name: 'closed-pure-grammar', passed: accepted });
      contract.cases.forEach((c, i) => {
        const value = accepted ? c.items.reduce((n, row) => n + (row[left] ?? NaN) * (row[right] ?? NaN), 0) : NaN;
        checks.push({ name: 'case:' + i, passed: Number.isFinite(value) && value === c.expected });
      });
    } else {
      scope = 'Model review is advisory; cannot establish verified result'; strength = 'MODEL_REVIEW';
      checks.push({ name: 'independent-proof-required', passed: null });
    }
    gate();
    const current = this.db.operationRecord(operationId) as TaskOperation;
    if (current.status !== 'SUCCESS' || resultHash(current.text ?? '') !== subjectHash) throw Error('VERIFICATION_SUBJECT_CHANGED');
    const now = Date.now(), record: ResultVerification = { id: randomUUID(), taskId: op.taskId, operationId, subjectHash,
      verifierId: 'builtin:' + contract.kind, verifierVersion: verifierVersion('builtin:' + contract.kind)!, category: contract.kind, criteriaHash: verificationCriteriaHash(contract),
      state: checks.some(c => c.passed === false) ? 'FAILED' : checks.some(c => c.passed === null) ? 'INCONCLUSIVE' : 'VERIFIED', strength, scope,
      checks, createdAt: now, expiresAt: now + 86400000, policyRevision, authorityEpoch };
    this.db.writeVerificationRecord(record); return record;
  }
}
