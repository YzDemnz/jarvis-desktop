import { randomUUID } from 'node:crypto';
import type { ConversationLedger } from '../../fabric/ConversationLedger';
import type { UsageLedger } from '../../fabric/UsageLedger';
import type { UsageRecord, UsageSource } from '../../fabric/types';
export interface ExternalResponse {
  conversationId: string; taskId: string; provider: string; agent: string; model: string | null;
  session: string; text: string; routingId: string; artifacts: string[]; tools: string[];
}
export class LedgerMapping {
  constructor(readonly conversations: ConversationLedger, readonly usage: UsageLedger) {}
  record(response: ExternalResponse, tokens?: { input: number; output: number; source: UsageSource }): void {
    const usage: UsageRecord[] = [];
    if (tokens && Number.isFinite(tokens.input) && Number.isFinite(tokens.output) && tokens.input >= 0 && tokens.output >= 0) {
      for (const [unit, amount] of [['INPUT_TOKENS', tokens.input], ['OUTPUT_TOKENS', tokens.output]] as const) {
        usage.push({ id: randomUUID(), providerId: response.provider, accountId: null, modelId: response.model, taskId: response.taskId,
          unit, amount, input: tokens.input, output: tokens.output, cached: null, timestamp: Date.now(), source: tokens.source,
          estimatedCost: null, currency: null, resetAt: null });
      }
    }
    usage.forEach(u => this.usage.record(u));
    this.conversations.append({ conversationId: response.conversationId, messageId: randomUUID(), parentId: null, role: 'assistant',
      content: response.text, timestamp: Date.now(), providerId: response.provider, modelId: response.model, channel: 'experimental', taskId: response.taskId,
      artifacts: response.artifacts, tools: response.tools, usageIds: usage.map(u => u.id), contextRefs: [`agent:${response.agent}`, `external-session:${response.session}`], routingDecisionId: response.routingId });
  }
}
