import type { FabricDatabase } from '../fabric/FabricDatabase';
import type { TaskOperation } from './TaskContinuity';
import { resultHash, checkedContract, verificationCriteriaHash, verifierVersion } from './VerificationService';
import type { ProviderDescriptor, RoutingRequest } from '../../src/fabric/types';
import { CapabilityRouter } from '../../src/fabric/CapabilityRouter';
/** Comparable, current deterministic outcomes only; never model reputation guesses. */
export function evidenceRoute(db: FabricDatabase, providers: ProviderDescriptor[], request: RoutingRequest, input: unknown) {
  const contract = checkedContract(input), criteriaHash = verificationCriteriaHash(contract), seen = new Set<string>();
  const observations: Record<string, { providerId: string; model: string; passed: number; failed: number }> = {};
  for (const record of db.verificationRecords()) {
    if (seen.has(record.operationId)) continue; seen.add(record.operationId);
    if (record.criteriaHash !== criteriaHash || record.category !== contract.kind || record.strength !== 'DETERMINISTIC'
      || !['VERIFIED', 'FAILED'].includes(record.state) || record.verifierVersion !== verifierVersion(record.verifierId) || record.verifierId !== 'builtin:' + contract.kind || record.expiresAt <= Date.now()) continue;
    const op = db.operationRecord(record.operationId) as TaskOperation | null;
    if (!op || op.status !== 'SUCCESS' || !op.providerId || !op.model || resultHash(op.text ?? '') !== record.subjectHash) continue;
    const key = op.providerId + ':' + op.model;
    const item = observations[key] ??= { providerId: op.providerId, model: op.model, passed: 0, failed: 0 };
    if (record.state === 'VERIFIED') item.passed++; else item.failed++;
  }
  const annotated = providers.map(p => {
    const samples = Object.values(observations).filter(o => o.providerId === p.id);
    const best = samples.sort((a, b) => (b.passed + 1) / (b.passed + b.failed + 2) - (a.passed + 1) / (a.passed + a.failed + 2))[0];
    return { ...p, quality: best ? (best.passed + 1) / (best.passed + best.failed + 2) : 0.5 };
  });
  const audit = new CapabilityRouter().route(request, annotated);
  const rankedModels = Object.values(observations).filter(o => o.providerId === audit.selectedProviderId)
    .sort((a, b) => (b.passed + 1) / (b.passed + b.failed + 2) - (a.passed + 1) / (a.passed + a.failed + 2));
  return { audit, model: rankedModels[0]?.model ?? null, criteriaHash, category: contract.kind, observations: Object.values(observations), scope: 'Current comparable deterministic checks only; limited sample evidence, not general model quality', automaticExecution: false };
}
