import type { Capability, CostPolicy, ProviderDescriptor, RoutingAudit, RoutingRequest } from './types';

const READY = new Set(['AVAILABLE', 'CONNECTED']);
const usable = (p: ProviderDescriptor) => READY.has(p.state) || p.state === 'DEGRADED' || p.state === 'QUOTA_LOW';
const has = (p: ProviderDescriptor, cap: Capability) => p.capabilities.some((item) => item.id === cap && item.available && item.strength > 0);
const costRank: Record<CostPolicy, Record<string, number>> = {
  SUBSCRIPTIONS_FIRST: { SUBSCRIPTION: 0, LOCAL: 1, PAID_API: 2, UNKNOWN: 3 },
  QUALITY_FIRST: { SUBSCRIPTION: 0, LOCAL: 0, PAID_API: 0, UNKNOWN: 2 },
  LOCAL_FIRST: { LOCAL: 0, SUBSCRIPTION: 1, PAID_API: 2, UNKNOWN: 3 },
  ECONOMY: { LOCAL: 0, SUBSCRIPTION: 1, PAID_API: 3, UNKNOWN: 4 },
  MANUAL: { LOCAL: 0, SUBSCRIPTION: 0, PAID_API: 0, UNKNOWN: 0 },
};

/** Deterministic constraints first. A local classifier may supply taskType but cannot bypass this filter. */
export class CapabilityRouter {
  route(request: RoutingRequest, providers: ProviderDescriptor[], fallbackFrom: string | null = null): RoutingAudit {
    const policy = request.policy ?? 'SUBSCRIPTIONS_FIRST';
    const reserve = Math.max(0, Math.min(1, request.reservePremiumCapacity ?? 0.15));
    const rejected: RoutingAudit['rejected'] = [];
    const accepted: ProviderDescriptor[] = [];
    for (const provider of providers) {
      const missing = request.required.find((cap) => !has(provider, cap));
      const reason = request.allowedProviderIds && !request.allowedProviderIds.includes(provider.id) ? 'provider destination disabled'
        : request.dataClass === 'CLIENT_DATA' && provider.privacyClass !== 'LOCAL' && (!provider.surface?.destination || !request.authorizedDestinations?.includes(provider.surface.destination)) ? 'client destination not authorized'
        : missing ? `missing capability: ${missing}`
        : !usable(provider) && !(provider.state === 'DETECTED' && provider.surface?.transport === 'LLAMA_CPP_CLI'
          && request.allowedProviderIds?.length === 1 && request.allowedProviderIds[0] === provider.id)
          && !(provider.state === 'NOT_CONNECTED' && ['RESPONSES_API', 'CHAT_COMPLETIONS_API'].includes(provider.surface?.transport ?? '')
          && provider.surface?.auth === 'SECRET_REF' && request.allowPaidApi && request.allowedProviderIds?.length === 1
          && request.allowedProviderIds[0] === provider.id) ? `state: ${provider.state}`
        : provider.quota === 'EXHAUSTED' ? 'quota exhausted'
        : provider.costClass === 'PAID_API' && !request.allowPaidApi ? 'paid API disabled'
        : request.maxPrivacy === 'LOCAL' && provider.privacyClass !== 'LOCAL' ? 'privacy policy'
        : provider.costClass !== 'LOCAL' && provider.quota === 'CRITICAL' && reserve > 0 ? 'premium reserve'
        : null;
      if (reason) rejected.push({ providerId: provider.id, reason }); else accepted.push(provider);
    }
    accepted.sort((a, b) => {
      const rank = (costRank[policy][a.costClass] ?? 10) - (costRank[policy][b.costClass] ?? 10);
      if (rank && policy !== 'QUALITY_FIRST') return rank;
      const pref = (p: ProviderDescriptor) => (request.preferred ?? []).reduce((n, cap) => n + (has(p, cap) ? 1 : 0), 0);
      return (b.quality + pref(b)) - (a.quality + pref(a)) || a.id.localeCompare(b.id);
    });
    return {
      id: crypto.randomUUID(), taskId: request.taskId, taskType: request.taskType,
      candidates: accepted.map((p) => p.id), rejected, selectedProviderId: accepted[0]?.id ?? null,
      fallbackFrom, policy, required: [...request.required],
      quota: Object.fromEntries(providers.map((p) => [p.id, p.quota])), timestamp: Date.now(),
    };
  }

  /** Re-evaluates capability and policy after a failure; never blindly advances a list. */
  fallback(request: RoutingRequest, providers: ProviderDescriptor[], failedIds: string[], previous: string): RoutingAudit {
    return this.route(request, providers.filter((p) => !failedIds.includes(p.id)), previous);
  }
}
