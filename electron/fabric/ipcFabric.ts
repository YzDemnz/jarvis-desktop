import { app, ipcMain } from 'electron';
import type { BrowserWindow } from 'electron';
import path from 'node:path';
import { IPC } from '../ipc';
import { FabricDatabase } from './FabricDatabase';
import type { ConversationMessage, TaskState, UsageUnit } from '../../src/fabric/types';
import { normalizeTaskState } from '../../src/fabric/ContinuityState';
import { HandoffContextBuilder } from '../../src/fabric/ContextBudgetManager';
import { devRunEvidence } from '../dev/ipcDev';

let database: FabricDatabase | null = null;
const str = (value: unknown, max = 200): string => typeof value === 'string' ? value.slice(0, max) : '';
const int = (value: unknown, fallback: number): number => typeof value === 'number' && Number.isSafeInteger(value) ? value : fallback;

export function registerFabricIpc(win: BrowserWindow): void {
  const h: typeof ipcMain.handle = (channel, listener) => ipcMain.handle(channel, (event, ...args) => {
    if (event.sender !== win.webContents || event.senderFrame !== win.webContents.mainFrame) throw new Error('Untrusted Fabric sender');
    return listener(event, ...args);
  });
  database ??= new FabricDatabase(path.join(app.getPath('userData'), 'intelligence-fabric', 'fabric.sqlite'));
  const F = IPC.fabric;
  h(F.appendMessage, (_event, value: unknown) => {
    if (!value || typeof value !== 'object') throw new Error('Invalid message');
    const message = value as ConversationMessage;
    if (!str(message.conversationId) || !str(message.messageId) || !['user', 'assistant', 'tool', 'system'].includes(message.role)
      || typeof message.content !== 'string' || message.content.length > 100000) throw new Error('Invalid message');
    database!.appendMessage({ ...message, conversationId: str(message.conversationId), messageId: str(message.messageId),
      parentId: message.parentId ? str(message.parentId) : null, providerId: message.providerId ? str(message.providerId) : null,
      modelId: message.modelId ? str(message.modelId) : null, channel: message.channel ? str(message.channel) : null,
      taskId: message.taskId ? str(message.taskId) : null, routingDecisionId: message.routingDecisionId ? str(message.routingDecisionId) : null,
      tools: Array.isArray(message.tools) ? message.tools.map((x) => str(x)).slice(0, 50) : [],
      artifacts: Array.isArray(message.artifacts) ? message.artifacts.map((x) => str(x, 1000)).slice(0, 50) : [],
      usageIds: Array.isArray(message.usageIds) ? message.usageIds.map((x) => str(x)).slice(0, 50) : [],
      contextRefs: Array.isArray(message.contextRefs) ? message.contextRefs.map((x) => str(x)).slice(0, 50) : [],
      timestamp: int(message.timestamp, Date.now()) });
    return true;
  });
  h(F.messagePage, (_event, conversationId: unknown, limit: unknown, beforeSeq: unknown) =>
    database!.messagePage(str(conversationId), int(limit, 50), int(beforeSeq, Number.MAX_SAFE_INTEGER)));
  h(F.saveTask, (_event, value: unknown) => {
    if (!value || typeof value !== 'object') throw new Error('Invalid task');
    const state = value as TaskState;
    if (!str(state.taskId) || !str(state.conversationId) || !str(state.goal, 10000)) throw new Error('Invalid task');
    const safe = normalizeTaskState(state);
    const checkpoint = database!.checkpointRecord(safe.taskId) as { state: TaskState } | null;
    if (checkpoint) {
      const main = checkpoint.state.evidence ?? [];
      database!.saveTask({ ...checkpoint.state, evidence: [...main, ...(safe.evidence ?? []).filter(e => !main.some(m => m.id === e.id)).map(e => ({ ...e, source: 'RENDERER_REPORTED' as const }))] });
      return true;
    }
    // Renderer cannot promote its own evidence to MAIN_PROCESS.
    const main = [...(database!.task(safe.taskId)?.evidence ?? []).filter(e => e.source === 'MAIN_PROCESS'), ...devRunEvidence(safe.taskId)];
    safe.evidence = [...new Map(main.map(e => [e.id, e])).values(), ...(safe.evidence ?? []).filter(e => !main.some(m => m.id === e.id)).map(e => ({ ...e, source: 'RENDERER_REPORTED' as const }))];
    database!.saveTask(safe); return true;
  });
  h(F.task, (_event, taskId: unknown) => database!.task(str(taskId)));
  h(F.taskPage, (_event, limit: unknown, before: unknown) => {
    let cursor: { updatedAt: number; taskId: string } | null = null;
    if (before && typeof before === 'object') {
      const b = before as Record<string, unknown>;
      if (Number.isSafeInteger(b.updatedAt) && typeof b.taskId === 'string') cursor = { updatedAt: b.updatedAt as number, taskId: str(b.taskId) };
    }
    return database!.taskPage(int(limit, 50), cursor);
  });
  h(F.handoff, (_event, taskId: unknown, contextLimit: unknown) => {
    const state = database!.task(str(taskId));
    if (!state) throw new Error('Task not found');
    const limit = Math.max(2048, Math.min(int(contextLimit, 8192), 128000));
    // Unscoped legacy messages must not import a different task's content.
    const messages = database!.messagePage(state.conversationId, 100).reverse().map(row => row.message).filter(m => m.taskId === state.taskId);
    return new HandoffContextBuilder().build(state, messages, limit, limit);
  });
  h(F.usagePage, (_event, providerId: unknown, limit: unknown, before: unknown) =>
    database!.usagePage(str(providerId), int(limit, 100), int(before, Number.MAX_SAFE_INTEGER)));
  h(F.quota, (_event, providerId: unknown, accountId: unknown, unit: unknown) =>
    database!.quota(str(providerId), typeof accountId === 'string' ? str(accountId) : null, str(unit) as UsageUnit));
  h(F.routingPage, (_event, taskId: unknown, limit: unknown) => database!.routingPage(str(taskId), int(limit, 100)));
}
export function fabricDatabase(): FabricDatabase { if (!database) throw Error('FABRIC_NOT_READY'); return database; }
export function unregisterFabricIpc(): void {
  Object.values(IPC.fabric).forEach((channel) => ipcMain.removeHandler(channel));
  database?.close(); database = null;
}
