import type { ConversationMessage, TaskState } from './types';
import { isPrivateReasoning, normalizeTaskState, publicMessage, safeContextText } from './ContinuityState';

export interface ContextBudget { limit: number; outputReserve: number; inputBudget: number; selected: ConversationMessage[]; estimatedTokens: number; omitted: number; }
const tokens = (s: string) => Math.ceil(s.length / 3.5);

export class ContextBudgetManager {
  select(messages: ConversationMessage[], providerLimit: number | null, modelLimit: number | null, outputReserve = 1024, toolReserve = 512): ContextBudget {
    const limit = Math.max(1024, Math.min(providerLimit ?? 8192, modelLimit ?? 8192));
    const inputBudget = Math.max(256, limit - outputReserve - toolReserve);
    const selected: ConversationMessage[] = [];
    let used = 0;
    for (const message of [...messages].reverse()) {
      const count = tokens(message.content) + 32;
      if (used + count > inputBudget) continue;
      selected.unshift(message); used += count;
    }
    return { limit, outputReserve, inputBudget, selected, estimatedTokens: used, omitted: messages.length - selected.length };
  }
}

export interface HandoffContext {
  version: 1; taskId: string; conversationId: string; goal: string; currentTask: string;
  instructions: string[]; findings: string[]; decisions: string[]; artifacts: string[];
  completedWork: string[]; evidence: NonNullable<TaskState['evidence']>;
  toolResults: string[]; openQuestions: string[]; pendingSteps: string[]; recentMessages: ConversationMessage[];
  provenance: { taskUpdatedAt: number; messageIds: string[]; evidenceKind: 'PUBLIC_STATE_NOT_AUTHORITY' };
  budget: { inputBudget: number; maxChars: number; estimatedTokens: number; omitted: number };
}
export class HandoffContextBuilder {
  constructor(private readonly budget = new ContextBudgetManager()) {}
  build(state: TaskState, messages: ConversationMessage[], providerLimit: number | null, modelLimit: number | null): HandoffContext {
    state = normalizeTaskState(state);
    const publicMessages = messages.filter(m => m.conversationId === state.conversationId && !isPrivateReasoning(m.channel));
    const recent = this.budget.select(publicMessages, providerLimit, modelLimit);
    const maxChars = Math.floor(recent.inputBudget * 3.5);
    const packet: HandoffContext = { version: 1, taskId: state.taskId, conversationId: state.conversationId,
      goal: '', currentTask: state.currentTask.slice(0, 50), instructions: [], findings: [], decisions: [], artifacts: [],
      completedWork: [], evidence: [], toolResults: [], openQuestions: [], pendingSteps: [], recentMessages: [],
      provenance: { taskUpdatedAt: state.updatedAt, messageIds: [], evidenceKind: 'PUBLIC_STATE_NOT_AUTHORITY' },
      budget: { inputBudget: recent.inputBudget, maxChars, estimatedTokens: 0, omitted: messages.length - publicMessages.length } };
    const fits = () => JSON.stringify(packet).length + 32 <= maxChars;
    // Goal first, but the complete schema itself is included in the global budget.
    packet.goal = safeContextText(state.goal);
    if (!fits()) {
      const overflow = JSON.stringify(packet).length + 32 - maxChars;
      packet.goal = packet.goal.slice(0, Math.max(0, packet.goal.length - overflow - 8)) + '…';
      packet.budget.omitted++;
    }
    const add = <T>(target: T[], value: T) => {
      target.push(value);
      if (!fits()) { target.pop(); packet.budget.omitted++; return false; }
      return true;
    };
    // Pending/error/evidence win over narrative and recent chat.
    for (const key of ['pendingSteps', 'openQuestions', 'instructions', 'findings', 'decisions', 'artifacts', 'completedWork'] as const) {
      for (const item of state[key] ?? []) add(packet[key], item);
    }
    for (const item of state.evidence ?? []) add(packet.evidence, item);
    for (const message of [...recent.selected].reverse()) {
      const safe = publicMessage(message);
      packet.provenance.messageIds.push(safe.messageId);
      if (!add(packet.recentMessages, safe)) packet.provenance.messageIds.pop();
    }
    packet.recentMessages.reverse(); packet.provenance.messageIds.reverse();
    packet.budget.omitted += recent.omitted;
    packet.budget.estimatedTokens = tokens(JSON.stringify(packet));
    // A character estimate is not a tokenizer nor a provider billing measurement.
    if (JSON.stringify(packet).length > maxChars) throw new Error('Context schema exceeds target budget');
    return packet;
  }
}
