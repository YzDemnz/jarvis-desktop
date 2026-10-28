import type { LocalAIRuntime } from '../machine/localai/types';
import type { IntelligenceProvider, IntelligenceRequest, IntelligenceResponse, ProviderCapability, ProviderIdentity, UsageRecord } from './types';

/** Provider surface delegates to a local runtime; no direct tool or OS access. */
export class OllamaProvider implements IntelligenceProvider {
  constructor(private readonly runtime: LocalAIRuntime, private readonly modelId: string) {}
  identity(): ProviderIdentity { return { id: 'ollama-local', label: 'Ollama local', kind: 'LOCAL_MODEL' }; }
  async capabilities(): Promise<ProviderCapability[]> {
    const cap = this.runtime.capabilities();
    return [
      { id: 'chat', strength: 0.5, available: true },
      { id: 'structuredOutput', strength: 0.5, available: cap.structuredOutput },
      { id: 'toolCalling', strength: 0, available: false },
    ];
  }
  async connectionState() { return (await this.runtime.health()).online ? 'AVAILABLE' as const : 'OFFLINE' as const; }
  async entitlement() { return { paid: false, details: 'Modelo local; sin cuota remota.' }; }
  async health() { const h = await this.runtime.health(); return { ok: h.online, message: h.error }; }
  async usage(): Promise<UsageRecord[]> { return []; }
  async estimate(_request: IntelligenceRequest) { return { amount: null, currency: null }; }
  async execute(request: IntelligenceRequest): Promise<IntelligenceResponse> {
    if (!this.runtime.generate) throw new Error('Runtime has no generation adapter');
    return { text: await this.runtime.generate({ model: this.modelId, prompt: request.prompt,
      ...(request.context ? { system: request.context } : {}) }, request.signal), model: this.modelId };
  }
  async *stream(request: IntelligenceRequest): AsyncIterable<string> {
    if (!this.runtime.stream) { yield (await this.execute(request)).text; return; }
    yield* this.runtime.stream({ model: this.modelId, prompt: request.prompt,
      ...(request.context ? { system: request.context } : {}) }, request.signal);
  }
}
