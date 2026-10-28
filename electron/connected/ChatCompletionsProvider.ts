import type { ConnectionState, IntelligenceProvider, IntelligenceRequest, IntelligenceResponse } from '../../src/fabric/types';
import { safeContextText } from '../../src/fabric/ContinuityState';
import type { CredentialStore } from './CredentialStore';
import { boundedJson, loopbackEndpoint, usageRecord } from './HttpProvider';

/** Official API destinations. Renderer input never selects a URL or auth header. */
export const API_ROUTES = Object.freeze({
  'claude-api': Object.freeze({ id: 'claude-api', label: 'Claude · API oficial', destination: 'https://api.anthropic.com/v1', transport: 'MESSAGES_API' as const }),
  'gemini-api': Object.freeze({ id: 'gemini-api', label: 'Gemini · API oficial', destination: 'https://generativelanguage.googleapis.com/v1beta/openai', transport: 'CHAT_COMPLETIONS_API' as const }),
  'grok-api': Object.freeze({ id: 'grok-api', label: 'Grok · API oficial', destination: 'https://api.x.ai/v1', transport: 'CHAT_COMPLETIONS_API' as const }),
  'groq-api': Object.freeze({ id: 'groq-api', label: 'Groq direct API', destination: 'https://api.groq.com/openai/v1', transport: 'CHAT_COMPLETIONS_API' as const }),
  'openrouter-api': Object.freeze({ id: 'openrouter-api', label: 'OpenRouter aggregated API', destination: 'https://openrouter.ai/api/v1', transport: 'CHAT_COMPLETIONS_API' as const }),
});
export type ChatCompletionsRouteId = keyof typeof API_ROUTES;
export interface ChatCompletionsOptions {
  /** Main-owned test injection only. This is not a renderer/IPC setting. */
  fixtureEndpoint?: string;
}

function publicFailure(error: unknown, aborted: boolean): string {
  if (aborted) return 'CONNECTED_RUN_REVOKED';
  const message = error instanceof Error ? error.message : '';
  if (message === 'PROVIDER_HTTP_429') return 'PROVIDER_RATE_LIMITED';
  if (/^PROVIDER_HTTP_(401|403)$/.test(message)) return 'PROVIDER_AUTH_REQUIRED';
  if (/^PROVIDER_HTTP_5\d\d$/.test(message)) return 'PROVIDER_UNAVAILABLE';
  if (['PROVIDER_AUTH_REQUIRED', 'PROVIDER_RESPONSE_NOT_COMPLETED', 'PROVIDER_OUTPUT_TOO_LARGE', 'CONNECTED_RUN_REVOKED'].includes(message)) return message;
  return 'PROVIDER_FAILED';
}

/**
 * Text-only, one-request official API adapter. No retry, tools, account scraping,
 * quota estimation, price assumption, or paid/free fallback. Broker aggregation
 * does not prove eligibility of downstream providers for CLIENT_DATA.
 */
export class ChatCompletionsProvider implements IntelligenceProvider {
  readonly destination: string;
  private state: ConnectionState = 'NOT_CONNECTED';
  constructor(readonly providerId: ChatCompletionsRouteId, private readonly vault: CredentialStore,
    private readonly model: string, private readonly guard: () => void, options: ChatCompletionsOptions = {}) {
    if (!Object.prototype.hasOwnProperty.call(API_ROUTES, providerId)) throw Error('UNKNOWN_API_ROUTE');
    if (!/^[a-zA-Z0-9._:/-]{1,200}$/.test(model) || safeContextText(model) !== model
      || (providerId === 'groq-api' && /^groq\/compound(?:-|$)/.test(model))
      || (providerId === 'openrouter-api' && /^openrouter\//.test(model))) throw Error('INVALID_CONNECTED_MODEL');
    this.destination = options.fixtureEndpoint ? loopbackEndpoint(options.fixtureEndpoint) : API_ROUTES[providerId].destination;
  }
  identity() { return { id: this.providerId, label: API_ROUTES[this.providerId].label, kind: 'GENERAL_AI' as const }; }
  async capabilities() { return [{ id: 'chat' as const, available: true, strength: 0.5 }]; }
  async connectionState(): Promise<ConnectionState> {
    return this.vault.references().some(ref => ref.providerId === this.providerId && ref.destination === this.destination) ? this.state : 'AUTH_REQUIRED';
  }
  async entitlement() { return { paid: true, details: 'Conservative PAID_API gate; account entitlement, actual cost and quota UNKNOWN. No free tier is assumed.' }; }
  async health() { const available = await this.connectionState() === 'AVAILABLE'; return { ok: available, message: available ? 'A text completion was observed; not a new health probe.' : 'Remote health and inference not verified.' }; }
  async usage() { return []; }
  async estimate() { return { amount: null, currency: null }; }
  private validate(signal?: AbortSignal) {
    if (signal?.aborted) throw Error('CONNECTED_RUN_REVOKED');
    try { this.guard(); } catch { throw Error('CONNECTED_RUN_REVOKED'); }
  }
  async execute(request: IntelligenceRequest): Promise<IntelligenceResponse> {
    try {
      this.validate(request.signal);
      if (typeof request.prompt !== 'string' || !request.prompt.trim() || request.prompt.length > 16000
        || (request.context !== undefined && (typeof request.context !== 'string' || request.context.length > 32000))) throw Error('INVALID_CONNECTED_INPUT');
      const ref = this.vault.references().find(r => r.providerId === this.providerId && r.destination === this.destination);
      if (!ref) throw Error('PROVIDER_AUTH_REQUIRED');
      if (this.providerId === 'claude-api') {
        const result = await this.vault.use(ref.id, { providerId: this.providerId, destination: this.destination, use: 'PROVIDER_AUTH' }, value => {
          this.validate(request.signal);
          return boundedJson(this.destination + '/messages', { method: 'POST', signal: request.signal,
            headers: { 'Content-Type': 'application/json', 'x-api-key': value, 'anthropic-version': '2023-06-01' },
            body: JSON.stringify({ model: this.model, max_tokens: 512, ...(request.context ? { system: safeContextText(request.context) } : {}), messages: [{ role: 'user', content: safeContextText(request.prompt) }] }) }, 60000);
        });
        this.validate(request.signal);
        if (result.type !== 'message' || result.role !== 'assistant' || result.stop_reason !== 'end_turn' || !Array.isArray(result.content)
          || result.content.some((x: any) => x.type !== 'text' || typeof x.text !== 'string')) throw Error('PROVIDER_RESPONSE_NOT_COMPLETED');
        const text = result.content.map((x: any) => x.text).join('\n'); if (!text.trim()) throw Error('PROVIDER_EMPTY_RESPONSE');
        this.state = 'AVAILABLE'; return { text: safeContextText(text), model: this.model,
          usage: [usageRecord(this.providerId, this.model, request.taskId, result.usage?.input_tokens, result.usage?.output_tokens)] };
      }
      const messages = [
        ...(request.context ? [{ role: 'system', content: safeContextText(request.context) }] : []),
        { role: 'user', content: safeContextText(request.prompt) },
      ];
      const body = { model: this.model, messages, stream: false, tools: [], tool_choice: 'none',
        ...(this.providerId === 'groq-api' ? { max_completion_tokens: 512 } : this.providerId !== 'openrouter-api' ? { max_tokens: 512 } : {
          max_tokens: 512,
          // Upstream retention/routing declarations, not independent attestation.
          provider: { allow_fallbacks: false, require_parameters: true, data_collection: 'deny', zdr: true },
        }),
      };
      const result = await this.vault.use(ref.id, { providerId: this.providerId, destination: this.destination, use: 'PROVIDER_AUTH' }, value => {
        this.validate(request.signal);
        return boundedJson(this.destination + '/chat/completions', { method: 'POST', signal: request.signal,
          headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + value }, body: JSON.stringify(body) }, 60000);
      });
      this.validate(request.signal);
      const choice = Array.isArray(result?.choices) && result.choices.length === 1 ? result.choices[0] : null;
      if (!choice || choice.finish_reason !== 'stop' || choice.message?.role !== 'assistant'
        || typeof choice.message.content !== 'string' || !choice.message.content.trim()
        || choice.message.function_call || (choice.message.tool_calls && (!Array.isArray(choice.message.tool_calls) || choice.message.tool_calls.length))) throw Error('PROVIDER_RESPONSE_NOT_COMPLETED');
      // Only public assistant content. Reasoning, tool arguments, extra response
      // metadata, raw errors and headers never leave this adapter.
      if (choice.message.content.length > 24000) throw Error('PROVIDER_OUTPUT_TOO_LARGE');
      const text = safeContextText(choice.message.content.replace(/<think>[\s\S]*?<\/think>/gi, '').trim());
      if (!text.trim() || /<\/?think>/i.test(text)) throw Error('PROVIDER_RESPONSE_NOT_COMPLETED');
      const observedModel = typeof result.model === 'string' && /^[a-zA-Z0-9._:/-]{1,200}$/.test(result.model) && safeContextText(result.model) === result.model ? result.model : this.model;
      this.state = 'AVAILABLE';
      return { text, model: observedModel, usage: [usageRecord(this.providerId, observedModel, request.taskId,
        result.usage?.prompt_tokens, result.usage?.completion_tokens)] };
    } catch (error) {
      const failure = publicFailure(error, !!request.signal?.aborted);
      this.state = failure === 'PROVIDER_RATE_LIMITED' ? 'RATE_LIMITED' : failure === 'PROVIDER_AUTH_REQUIRED' ? 'AUTH_REQUIRED' : 'DEGRADED';
      throw Error(failure);
    }
  }
}
