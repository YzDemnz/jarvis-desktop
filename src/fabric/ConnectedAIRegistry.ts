import type { ConnectionState, ProviderDescriptor } from './types';

/** In-memory discovery state. Credentials are deliberately absent. */
export class ConnectedAIRegistry {
  private readonly providers = new Map<string, ProviderDescriptor>();

  register(descriptor: ProviderDescriptor): void {
    if (!descriptor.id || !Number.isFinite(descriptor.quality)) throw new Error('Invalid provider descriptor');
    this.providers.set(descriptor.id, structuredClone(descriptor));
  }

  updateState(id: string, state: ConnectionState): void {
    const current = this.providers.get(id);
    if (!current) throw new Error(`Unknown provider: ${id}`);
    this.providers.set(id, { ...current, state, healthCheckedAt: Date.now() });
  }

  get(id: string): ProviderDescriptor | null { const item = this.providers.get(id); return item ? structuredClone(item) : null; }
  list(): ProviderDescriptor[] { return [...this.providers.values()].map((item) => structuredClone(item)); }
}

/** Names reserve identity only; no authentication, network call or capability is implied. */
export const FUTURE_PROVIDER_IDS = [
  'codex', 'claude-code', 'antigravity', 'grok-build', 'openai-api', 'anthropic-api',
  'gemini-api', 'xai-api', 'bolt', 'image-specialist', 'video-specialist', 'voice-specialist',
] as const;

export function registerFutureProviderStubs(registry: ConnectedAIRegistry): void {
  const kinds: Record<(typeof FUTURE_PROVIDER_IDS)[number], ProviderDescriptor['kind']> = {
    codex: 'CODING_AGENT', 'claude-code': 'CODING_AGENT', antigravity: 'CODING_AGENT',
    'grok-build': 'CODING_AGENT', 'openai-api': 'GENERAL_AI', 'anthropic-api': 'GENERAL_AI',
    'gemini-api': 'GENERAL_AI', 'xai-api': 'GENERAL_AI', bolt: 'SPECIALIST',
    'image-specialist': 'CREATIVE_IMAGE', 'video-specialist': 'CREATIVE_VIDEO', 'voice-specialist': 'VOICE',
  };
  for (const id of FUTURE_PROVIDER_IDS) registry.register({ id, label: id, kind: kinds[id],
    state: 'NOT_IMPLEMENTED', capabilities: [], costClass: 'UNKNOWN', privacyClass: 'UNKNOWN',
    contextLimit: null, quality: 0, healthCheckedAt: null, quota: 'UNKNOWN' });
}
