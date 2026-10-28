import { randomUUID } from 'node:crypto';
import { safeContextText } from '../../src/fabric/ContinuityState';
import type { IntelligenceProvider, IntelligenceRequest, IntelligenceResponse, UsageRecord } from '../../src/fabric/types';
import type { CredentialStore } from './CredentialStore';
export function loopbackEndpoint(raw: string): string {
  const u = new URL(raw);
  if (!['127.0.0.1', '[::1]', 'localhost'].includes(u.hostname) || u.protocol !== 'http:' || u.username || u.password || u.search || u.hash || u.pathname !== '/') throw Error('LOCAL_ENDPOINT_NOT_LOOPBACK');
  return u.origin;
}
export async function boundedJson(url: string, init: RequestInit, timeoutMs = 15000): Promise<any> {
  const controller = new AbortController(), abort = () => controller.abort();
  init.signal?.addEventListener('abort', abort, { once: true }); if (init.signal?.aborted) abort();
  const timer = setTimeout(abort, timeoutMs);
  try {
    const response = await fetch(url, { ...init, signal: controller.signal, redirect: 'error' });
    if (!response.ok) throw Error('PROVIDER_HTTP_' + response.status);
    const reader = response.body!.getReader(); const chunks: Uint8Array[] = []; let size = 0;
    while (true) { const item = await reader.read(); if (item.done) break; size += item.value.length; if (size > 2 * 1024 * 1024) { controller.abort(); throw Error('PROVIDER_OUTPUT_TOO_LARGE'); } chunks.push(item.value); }
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } finally { clearTimeout(timer); init.signal?.removeEventListener('abort', abort); }
}
export function usageRecord(providerId: string, model: string|null, taskId: string, input: unknown, output: unknown): UsageRecord {
  const n = (v: unknown) => typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : null;
  return { id: randomUUID(), providerId, accountId: null, modelId: model, taskId, unit: 'REQUESTS', amount: 1,
    input: n(input), output: n(output), cached: null, estimatedCost: null, currency: null, timestamp: Date.now(), resetAt: null, source: 'OBSERVED' };
}
/** Documented Responses API. No ChatGPT cookies/token extraction/subscription replay. */
export class ResponsesProvider implements IntelligenceProvider {
  constructor(private readonly endpoint: string, private readonly vault: CredentialStore, private readonly model: string, private readonly guard: () => void) {}
  identity() { return { id: 'openai-api', label: 'OpenAI API', kind: 'GENERAL_AI' as const }; }
  async capabilities() { return [{ id: 'chat' as const, available: true, strength: 0.5 }]; }
  async connectionState() { return this.vault.references().some(r => r.providerId === 'openai-api') ? 'NOT_CONNECTED' as const : 'AUTH_REQUIRED' as const; }
  async entitlement() { return { paid: true, details: 'API de pago separada de suscripción; costo efectivo UNKNOWN.' }; }
  async health() { return { ok: false, message: 'Remote health not verified' }; }
  async usage() { return []; }
  async estimate() { return { amount: null, currency: null }; }
  async execute(request: IntelligenceRequest): Promise<IntelligenceResponse> {
    this.guard();
    const ref = this.vault.references().find(r => r.providerId === 'openai-api' && r.destination === this.endpoint);
    if (!ref) throw Error('PROVIDER_AUTH_REQUIRED');
    const result = await this.vault.use(ref.id, { providerId: 'openai-api', destination: this.endpoint, use: 'PROVIDER_AUTH' }, value => {
      this.guard();
      return boundedJson(this.endpoint + '/responses', { method: 'POST', signal: request.signal,
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + value },
        body: JSON.stringify({ model: this.model, input: safeContextText(request.prompt), ...(request.context ? { instructions: safeContextText(request.context) } : {}), store: false, tools: [], max_output_tokens: 512 }) }, 60000);
    });
    this.guard();
    if (result.status !== 'completed') throw Error('PROVIDER_RESPONSE_NOT_COMPLETED');
    const text = (result.output ?? []).filter((item: any) => item.type === 'message' && item.role === 'assistant')
      .flatMap((item: any) => item.content ?? []).filter((item: any) => item.type === 'output_text').map((item: any) => item.text).join('\n');
    return { text: safeContextText(text), model: typeof result.model === 'string' ? safeContextText(result.model) : this.model,
      usage: [usageRecord('openai-api', this.model, request.taskId, result.usage?.input_tokens, result.usage?.output_tokens)] };
  }
}
