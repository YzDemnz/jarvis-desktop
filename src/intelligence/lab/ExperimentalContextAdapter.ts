import type { ConversationMessage } from '../../fabric/types';
/** OpenCode-inspired bounded pruning, not copied upstream source or replacement.
 * Retains explicit facts and recent complete task groups. No invented summaries.
 */
export class ExperimentalContextAdapter {
  select(messages: ConversationMessage[], limit: number, facts: string[], reserve = 1536) {
    const budget = Math.max(0, limit - reserve);
    const estimate = (text: string) => Math.ceil(text.length / 3.5) + 32;
    let used = 0; const retainedFacts: string[] = [];
    for (const f of facts) { const n = estimate(f); if (used + n <= budget) { retainedFacts.push(f); used += n; } }
    const groups = new Map<string, ConversationMessage[]>();
    for (const m of messages) { const id = m.taskId ?? m.messageId; const g = groups.get(id) ?? []; g.push(m); groups.set(id, g); }
    const selected: ConversationMessage[] = [];
    for (const group of [...groups.values()].reverse()) {
      const trimmed = group.map(m => m.role === 'tool' ? { ...m, content: m.content.slice(-1400) } : m);
      const n = trimmed.reduce((s, m) => s + estimate(m.content), 0);
      if (used + n <= budget) { selected.unshift(...trimmed); used += n; }
    }
    return { selected, retainedFacts, estimatedTokens: used, budget, taskCompletion: 'NOT_MEASURED' as const };
  }
}
