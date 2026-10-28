import type { AgentRun } from '@/types';
import { sanitizeText, REDACTED } from '@/machine/CredentialBoundary';
import type { ConversationMessage, TaskEvidence, TaskState } from './types';

/** Additional boundary for persisted public context. Not a general secret vault. */
export function safeContextText(value: string): string {
  return sanitizeText(value)
    .replace(/^\s*(?:export\s+)?[A-Z][A-Z0-9_]*\s*=.*$/gm, `[env value ${REDACTED}]`)
    .replace(/\b((?:api[-_ ]?key|access[-_ ]?token|refresh[-_ ]?token|client[-_ ]?secret|cookie|set-cookie|authorization)\s*[=:])[^\r\n]*/gi, `$1 ${REDACTED}`);
}

export function isPrivateReasoning(channel: string | null): boolean {
  return !!channel && /^(analysis|reasoning|thoughts?|chain[-_ ]of[-_ ]thought|private[-_ ]reasoning)$/i.test(channel);
}

const text = (value: unknown, max = 4000): string => typeof value === 'string' ? safeContextText(value).slice(0, max) : '';
const list = (value: unknown): string[] => Array.isArray(value) ? value.slice(0, 200).filter((v): v is string => typeof v === 'string').map(v => text(v)) : [];

/** Explicit schema drops unknown/private fields before SQLite, including legacy writes. */
export function normalizeTaskState(value: unknown): TaskState {
  if (!value || typeof value !== 'object' || JSON.stringify(value).length > 256_000) throw new Error('Invalid task size');
  const raw = value as Record<string, unknown>;
  if (typeof raw.taskId !== 'string' || !raw.taskId || raw.taskId.length > 200
    || typeof raw.conversationId !== 'string' || !raw.conversationId || raw.conversationId.length > 200
    || typeof raw.goal !== 'string' || !raw.goal) throw new Error('Invalid task identity');
  const evidence: TaskEvidence[] = Array.isArray(raw.evidence) ? raw.evidence.slice(0, 200).flatMap((v: unknown) => {
    if (!v || typeof v !== 'object') return [];
    const e = v as Record<string, unknown>;
    if (!['step', 'command', 'artifact'].includes(String(e.kind)) || !['RENDERER_REPORTED', 'MAIN_PROCESS'].includes(String(e.source))) return [];
    return [{ id: text(e.id, 200), kind: e.kind as TaskEvidence['kind'], source: e.source as TaskEvidence['source'],
      status: text(e.status, 50), summary: text(e.summary), at: typeof e.at === 'number' && Number.isFinite(e.at) ? e.at : 0,
      contentHash: typeof e.contentHash === 'string' && /^[a-f0-9]{64}$/i.test(e.contentHash) ? e.contentHash : null }];
  }) : [];
  return { taskId: raw.taskId, conversationId: raw.conversationId, goal: text(raw.goal, 20000), currentTask: text(raw.currentTask, 200),
    instructions: list(raw.instructions), findings: list(raw.findings), decisions: list(raw.decisions), artifacts: list(raw.artifacts),
    openQuestions: list(raw.openQuestions), pendingSteps: list(raw.pendingSteps), completedWork: list(raw.completedWork), evidence,
    updatedAt: typeof raw.updatedAt === 'number' && Number.isFinite(raw.updatedAt) ? raw.updatedAt : Date.now() };
}

export function publicMessage(message: ConversationMessage): ConversationMessage {
  if (isPrivateReasoning(message.channel)) throw new Error('Private reasoning is not persisted');
  return { ...message, content: safeContextText(message.content),
    artifacts: message.artifacts.map(safeContextText), contextRefs: message.contextRefs.map(safeContextText) };
}

/** Checkpoint from observable steps; renderer reports are never OS attestation. */
export function taskFromRun(run: AgentRun, conversationId: string): TaskState {
  const work = run.steps.filter(s => s.kind !== 'classify');
  const pending = work.filter(s => s.status !== 'completed' && s.status !== 'skipped');
  const completed = work.filter(s => s.status === 'completed');
  return normalizeTaskState({ taskId: run.id, conversationId, goal: run.prompt, currentTask: run.status,
    instructions: [], findings: run.error ? [run.error] : [], decisions: [], artifacts: [],
    openQuestions: [], completedWork: completed.map(s => s.summary ?? s.title),
    pendingSteps: pending.map(s => `${s.title}: ${s.status}${s.error ? ` — ${s.error}` : ''}`),
    evidence: work.map(s => ({ id: s.id, kind: 'step', source: 'RENDERER_REPORTED', status: s.status,
      summary: `${s.title}${s.summary ? ` — ${s.summary}` : ''}${s.error ? ` — ${s.error}` : ''}`, at: s.endedAt ?? s.startedAt ?? run.createdAt })),
    updatedAt: Date.now() });
}
