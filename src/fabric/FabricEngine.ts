import { CapabilityRouter } from './CapabilityRouter';
import { ConnectedAIRegistry } from './ConnectedAIRegistry';
import type { IntelligenceProvider, IntelligenceRequest, IntelligenceResponse, ProviderDescriptor, RoutingAudit, RoutingRequest } from './types';
import type { UsageLedger } from './UsageLedger';

export interface FabricAuditStore { recordRouting(audit: RoutingAudit): void; }

/** Silent compatible fallback. No payment, login or privacy escalation is performed here. */
export class FabricEngine {
  private readonly adapters = new Map<string, IntelligenceProvider>();
  constructor(private readonly registry: ConnectedAIRegistry, private readonly usage: UsageLedger,
    private readonly audit: FabricAuditStore, private readonly router = new CapabilityRouter()) {}
  attach(provider: IntelligenceProvider): void { this.adapters.set(provider.identity().id, provider); }

  private candidates(): ProviderDescriptor[] {
    return this.registry.list().map((descriptor) => {
      const quota = this.usage.quota(descriptor.id, descriptor.accountId ?? null, 'REQUESTS');
      return { ...descriptor, quota: quota.state === 'UNKNOWN' ? descriptor.quota : quota.state };
    });
  }
  route(request: RoutingRequest): RoutingAudit {
    const decision = this.router.route(request, this.candidates()); this.audit.recordRouting(decision); return decision;
  }
  async execute(request: RoutingRequest, payload: IntelligenceRequest, onFallback?: (from: string, to: string | null) => void): Promise<{ response: IntelligenceResponse | null; audit: RoutingAudit[] }> {
    const audits: RoutingAudit[] = []; const failed: string[] = []; let previous: string | null = null;
    while (!payload.signal?.aborted) {
      const decision: RoutingAudit = previous === null ? this.router.route(request, this.candidates())
        : this.router.fallback(request, this.candidates(), failed, previous);
      decision.rejected.push(...failed.map((providerId) => ({ providerId, reason: 'previous execution failed' })));
      audits.push(decision); this.audit.recordRouting(decision);
      const id: string | null = decision.selectedProviderId;
      if (!id) { if (previous) onFallback?.(previous, null); return { response: null, audit: audits }; }
      if (previous) onFallback?.(previous, id);
      const provider = this.adapters.get(id);
      if (!provider) { failed.push(id); previous = id; continue; }
      try {
        const response = await provider.execute(payload);
        if (payload.signal?.aborted) return { response: null, audit: audits };
        for (const record of response.usage ?? []) this.usage.record(record);
        return { response, audit: audits };
      } catch (error) {
        if (payload.signal?.aborted) return { response: null, audit: audits };
        failed.push(id); previous = id;
        const descriptor = this.registry.get(id);
        if (descriptor?.state === 'AVAILABLE') this.registry.updateState(id, 'DEGRADED');
        void error;
      }
    }
    return { response: null, audit: audits };
  }
}
