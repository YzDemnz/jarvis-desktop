import type { SessionNotification } from '@agentclientprotocol/sdk';
export type LabEvent = { sessionId: string; kind: string; text?: string; toolId?: string; contextUsed?: number; contextSize?: number };
/** Bounded normalization. Context occupancy is not billable tokens or quota. */
export class ACPEventAdapter {
  readonly events: LabEvent[] = [];
  malformed = 0;
  private listeners = new Set<(event: LabEvent) => void>();
  subscribe(listener: (event: LabEvent) => void): () => void { this.listeners.add(listener); return () => this.listeners.delete(listener); }
  accept(message: SessionNotification): LabEvent | null {
    const update = message?.update;
    if (!message?.sessionId || !update || typeof update.sessionUpdate !== 'string') { this.malformed++; return null; }
    const e: LabEvent = { sessionId: message.sessionId, kind: update.sessionUpdate };
    if (update.sessionUpdate === 'agent_message_chunk' && update.content.type === 'text') e.text = update.content.text.slice(0, 65536);
    if (update.sessionUpdate === 'tool_call' || update.sessionUpdate === 'tool_call_update') e.toolId = update.toolCallId;
    if (update.sessionUpdate === 'usage_update') { e.contextUsed = update.used; e.contextSize = update.size; }
    this.events.push(e); if (this.events.length > 1000) this.events.shift();
    for (const listener of this.listeners) { try { listener(e); } catch { /* consumer cannot corrupt transport */ } }
    return e;
  }
}
