import type { QuotaSnapshot, UsageRecord, UsageUnit } from './types';

export interface UsageStore { recordUsage(record: UsageRecord): void; usagePage(providerId: string, limit?: number, before?: number): UsageRecord[]; setQuota(snapshot: QuotaSnapshot): void; quota(providerId: string, accountId: string | null, unit: UsageUnit): QuotaSnapshot; }

/** Usage and quota are different evidence: observed consumption cannot invent remaining capacity. */
export class UsageLedger {
  constructor(private readonly store: UsageStore) {}
  record(record: UsageRecord): void { this.store.recordUsage(record); }
  page(providerId: string, limit = 100, before?: number): UsageRecord[] { return this.store.usagePage(providerId, limit, before); }
  quota(providerId: string, accountId: string | null, unit: UsageUnit): QuotaSnapshot {
    const snapshot = this.store.quota(providerId, accountId, unit);
    if (snapshot.resetAt !== null && snapshot.resetAt <= Date.now()) {
      return { ...snapshot, used: null, remaining: null, state: 'UNKNOWN', source: 'UNKNOWN' };
    }
    return snapshot;
  }
  updateQuota(snapshot: Omit<QuotaSnapshot, 'state'>): QuotaSnapshot {
    const remaining = snapshot.remaining ?? ((snapshot.source === 'AUTHORITATIVE' || snapshot.source === 'USER_SUPPLIED')
      && snapshot.limit !== null && snapshot.used !== null ? Math.max(0, snapshot.limit - snapshot.used) : null);
    const ratio = remaining !== null && snapshot.limit && snapshot.limit > 0 ? remaining / snapshot.limit : null;
    const state = remaining === null ? 'UNKNOWN' : remaining <= 0 ? 'EXHAUSTED' : ratio !== null && ratio <= 0.05 ? 'CRITICAL' : ratio !== null && ratio <= 0.15 ? 'CONSERVE' : 'NORMAL';
    const normalized: QuotaSnapshot = { ...snapshot, remaining, state };
    this.store.setQuota(normalized);
    return normalized;
  }
}
