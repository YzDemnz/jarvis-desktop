import type { ExecutionPolicy, ExecutionProbe, ExecutionRealm, ExecutionRequest, ExecutionTrust } from './types';
import { realmAllowed } from './ExecutionPolicy';
import { ExecutionSuitabilityScore } from './ExecutionSuitabilityScore';
import type { AssuranceResolver, CapabilityState, SecurityCapability } from './assurance/CapabilityAssurance';

export interface EligibilityReport {
  requiredCapabilities: SecurityCapability[];
  backends: Array<{ backendId: string; realm: ExecutionRealm; eligible: boolean;
    failedRequirements: Array<{ capability: SecurityCapability; state: CapabilityState; reason: string }>;
    otherReasons: string[] }>;
}

export interface ExecutionRoute {
  selected: string | null; realm: ExecutionRealm | null; status: 'SELECTED' | 'PROPOSAL_ONLY' | 'ASK_USER' | 'FAIL';
  rejected: Array<{ backendId: string; reason: string }>;
  reason: string;
  score: number | null;
  eligibilityReport: EligibilityReport;
  fallback: { from: ExecutionRealm; to: ExecutionRealm; reason: string } | null;
}

const TRUST_RANK: Record<ExecutionTrust, number> = {
  LIMITED_ISOLATION: 0, PROVIDER_MANAGED: 1, FULL_TRUST: 1, TRUSTED_BROKERED: 2, STRONG_ISOLATION: 3,
};

/** Security constraints first; score only sorts candidates that already qualify. */
export class ExecutionRouter {
  constructor(private readonly suitability = new ExecutionSuitabilityScore(), private readonly assurance: AssuranceResolver | null = null) {}
  route(request: ExecutionRequest, policy: ExecutionPolicy, probes: ExecutionProbe[]): ExecutionRoute {
    const rejected: ExecutionRoute['rejected'] = [];
    const preferred = policy.accessMode
      ? policy.authoritativeStrong ? ['STRONG_ISOLATED' as const] : policy.accessMode === 'FULL' ? ['FULL_NATIVE' as const] : ['BROKERED' as const]
      : request.explicitRealm ? [request.explicitRealm] : this.suitability.preference(request.task);
    const candidates: Array<{ probe: ExecutionProbe; score: number }> = [];
    const requirements = [...new Set<SecurityCapability>([
      ...(!policy.accessMode ? request.requiredCapabilities ?? [] : []), ...(policy.securityRequirements?.[request.task] ?? []),
      ...(policy.accessMode ? policy.authoritativeStrong ? ['STRONG_ISOLATION' as const] : [] : request.requiredTrust === 'STRONG_ISOLATION' || request.task === 'UNKNOWN_UNTRUSTED_AGENT' ? ['STRONG_ISOLATION' as const] : []),
    ])];
    const report: EligibilityReport = { requiredCapabilities: requirements, backends: [] };
    for (const probe of probes) {
      const cap = probe.capabilities;
      const failedRequirements = requirements.flatMap(capability => {
        if (!probe.assurance || !this.assurance) return [{ capability, state: 'UNKNOWN' as const, reason: 'NO_CURRENT_ATTESTATION' }];
        const effective = this.assurance.assess(probe.backendId, capability, probe.assurance.current,
          probe.assurance.mechanismConfigured);
        return effective.eligible && effective.state === 'ATTESTED' ? [] : [{ capability,
          state: effective.state, reason: effective.reason }];
      });
      const reason = probe.status !== 'AVAILABLE' ? `backend ${probe.status}`
        : !preferred.includes(probe.realm) ? 'task realm mismatch'
        : !realmAllowed(probe.realm, policy, request.explicitRealm ?? null) ? 'user policy'
        : failedRequirements.length ? `security requirement ${failedRequirements.map(f => f.capability).join(', ')}`
        : requirements.includes('STRONG_ISOLATION') && cap.trust !== 'STRONG_ISOLATION' ? 'strong isolation trust declaration mismatch'
        : !policy.accessMode && request.requiredTrust && TRUST_RANK[cap.trust] < TRUST_RANK[request.requiredTrust] ? 'trust requirement'
        : request.requireShell && !cap.shell && !(probe.realm === 'BROKERED' && request.allowProposalFallback) ? 'shell unavailable'
        : null;
      report.backends.push({ backendId: probe.backendId, realm: probe.realm, eligible: reason === null,
        failedRequirements, otherReasons: reason && !reason.startsWith('security requirement') ? [reason] : [] });
      if (reason) { rejected.push({ backendId: probe.backendId, reason }); continue; }
      const score = policy.accessMode ? 100 : this.suitability.score(request.task, probe);
      candidates.push({ probe, score });
    }
    candidates.sort((a, b) => b.score - a.score || a.probe.backendId.localeCompare(b.probe.backendId));
    const chosen = candidates[0];
    if (chosen) return { selected: chosen.probe.backendId, realm: chosen.probe.realm,
      status: chosen.probe.realm === 'BROKERED' && request.requireShell && request.allowProposalFallback ? 'PROPOSAL_ONLY' : 'SELECTED',
      rejected, reason: 'deterministic eligible backend', score: chosen.score, eligibilityReport: report, fallback: null };
    if (requirements.length && policy.securityFallback === 'BROKERED_PROPOSAL' && request.allowProposalFallback) {
      const broker = probes.find(p => p.realm === 'BROKERED' && p.status === 'AVAILABLE' && realmAllowed('BROKERED', policy));
      if (broker) return { selected: broker.backendId, realm: 'BROKERED', status: 'PROPOSAL_ONLY', rejected,
        reason: 'EXPLICIT_SECURITY_FALLBACK_PROPOSAL_ONLY', score: null, eligibilityReport: report,
        fallback: { from: requirements.includes('STRONG_ISOLATION') ? 'STRONG_ISOLATED' : request.explicitRealm ?? 'BROKERED',
          to: 'BROKERED', reason: 'security requirement not attested; no execution until separate proposal-only dispatch' } };
    }
    const hardSecurity = requirements.length > 0;
    return { selected: null, realm: null, status: hardSecurity ? 'FAIL' : request.task === 'CODING_WITH_SHELL' ? 'ASK_USER' : 'FAIL',
      rejected, reason: 'NO_ELIGIBLE_BACKEND', score: null, eligibilityReport: report, fallback: null };
  }
}
