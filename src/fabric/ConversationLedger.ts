import type { ConversationMessage, TaskState } from './types';

export interface ConversationStore {
  appendMessage(message: ConversationMessage): void;
  messagePage(conversationId: string, limit?: number, beforeSeq?: number): { seq: number; message: ConversationMessage }[];
  saveTask(state: TaskState): void;
  task(taskId: string): TaskState | null;
}

/** RAW_LEDGER, WORKING_MEMORY and TASK_STATE are persisted; summaries/RAG remain future interfaces. */
export class ConversationLedger {
  constructor(private readonly store: ConversationStore) {}
  append(message: ConversationMessage): void { this.store.appendMessage(message); }
  page(conversationId: string, limit = 100, beforeSeq?: number): { seq: number; message: ConversationMessage }[] {
    return this.store.messagePage(conversationId, limit, beforeSeq);
  }
  saveTask(state: TaskState): void { this.store.saveTask(state); }
  task(taskId: string): TaskState | null { return this.store.task(taskId); }
  workingMemory(conversationId: string, limit = 40): ConversationMessage[] {
    return this.page(conversationId, limit).reverse().map((row) => row.message);
  }
}

export interface FutureMemoryLayers {
  episodicSummary(conversationId: string): Promise<string | null>;
  semanticSearch(conversationId: string, query: string): Promise<string[]>;
}
