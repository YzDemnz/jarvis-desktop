import { ipcMain } from 'electron';
import type { BrowserWindow } from 'electron';
import { IPC } from '../ipc';
import { FileSystemService } from './FileSystemService';
import { applicationService } from './ApplicationService';
import { systemService } from './SystemService';
import { ollamaProvider } from './OllamaProvider';
import { heuristicRoute } from '../../src/services/ai/routing';
import { toolRegistry } from '../../src/agent/registry';
import { PermissionEngine } from '../../src/agent/permissions';
import type { RoutingDecision, ToolId } from '../../src/types';

const str = (v: unknown, fallback = ''): string => (typeof v === 'string' ? v : fallback);
const num = (v: unknown, fallback: number): number => (typeof v === 'number' && Number.isFinite(v) ? v : fallback);

import { authority, authorityActiveRun, authorityHandle, effectivePermission, onAuthorityStop } from '../authority';
import { safeContextText } from '../../src/fabric/ContinuityState';

const permissions = new PermissionEngine();
const fileSystemService = new FileSystemService(() => effectivePermission() === 'FULL');

export interface PrivilegedResult<T = unknown> {
  ok: boolean;
  data?: T;
  error?: string;
  reason?: 'permission_denied' | 'tool_disabled' | 'not_implemented' | 'tool_unknown' | 'adapter_error' | 'invalid_args';
}

/**
 * Authoritative gate. The renderer already runs its own broker for
 * orchestration and approval UX, but a renderer decision is only advice: every
 * privileged capability is re-checked here against the same registry before a
 * single syscall happens. Client permission arguments are compatibility metadata:
 * main reads its own AccessMode instead. Read-only UI operations do not mint runs.
 */
function guard<T>(toolId: ToolId, _sessionLevel: unknown, run: () => Promise<T> | T): Promise<PrivilegedResult<T>> {
  const tool = toolRegistry.get(toolId);
  const verdict = permissions.check(tool, effectivePermission());
  if (!verdict.allowed) {
    return Promise.resolve({
      ok: false,
      error: verdict.reason,
      reason: verdict.code === 'permission_denied' ? 'permission_denied'
        : verdict.code === 'not_implemented' ? 'not_implemented' : 'tool_disabled',
    });
  }
  return Promise.resolve()
    .then(run)
    .then((data) => ({ ok: true, data }))
    .catch((error: unknown) => ({
      ok: false,
      error: error instanceof Error ? error.message : String(error),
      reason: 'adapter_error' as const,
    }));
}

export function registerAgentIpc(win: BrowserWindow): void {
  const A = IPC.agent;
  const searching = new Set<AbortController>();
  onAuthorityStop(() => searching.forEach(c => c.abort()));

  /* ---------------- filesystem: read-only ---------------- */
  authorityHandle(A.fsGetDrives, (_e, lvl: unknown) =>
    guard('filesystem.getDrives', lvl, () => fileSystemService.getDrives()));

  authorityHandle(A.fsList, (_e, lvl: unknown, target: unknown) =>
    guard('filesystem.list', lvl, () => fileSystemService.listDirectory(str(target))));

  authorityHandle(A.fsStat, (_e, lvl: unknown, target: unknown) =>
    guard('filesystem.stat', lvl, () => fileSystemService.stat(str(target))));

  authorityHandle(A.fsExists, (_e, lvl: unknown, target: unknown) =>
    guard('filesystem.exists', lvl, () => fileSystemService.exists(str(target))));
  authorityHandle(A.fsReadText, (_e, lvl: unknown, target: unknown) =>
    guard('filesystem.readText', lvl, () => fileSystemService.readText(str(target))));
  authorityHandle(A.fsSearchStatus, () => fileSystemService.searchStatus());

  authorityHandle(A.fsSearch, (_e, lvl: unknown, options: unknown) => {
    const o = (options ?? {}) as Record<string, unknown>;
    const query = str(o.query);
    if (query.trim().length < 2) {
      return Promise.resolve<PrivilegedResult>({ ok: false, error: 'La búsqueda necesita al menos dos caracteres.', reason: 'invalid_args' });
    }
    const controller = new AbortController(); searching.add(controller);
    return guard('filesystem.search', lvl, () =>
      fileSystemService.search({
        query,
        limit: num(o.limit, 60),
        maxDepth: num(o.maxDepth, 6),
        ...(Array.isArray(o.roots) ? { roots: (o.roots as unknown[]).filter((r): r is string => typeof r === 'string') } : {}),
      }, controller.signal)).finally(() => searching.delete(controller));
  });

  /* ---------------- applications and system ---------------- */
  authorityHandle(A.appList, (_e, lvl: unknown, query: unknown) =>
    guard('app.list', lvl, () => (str(query) ? applicationService.search(str(query)) : applicationService.list())));

  authorityHandle(A.systemInfo, (_e, lvl: unknown) =>
    guard('system.getInfo', lvl, () => systemService.getInfo()));

  authorityHandle(A.processList, (_e, lvl: unknown) =>
    guard('process.list', lvl, () => systemService.listProcesses()));

  /* ---------------- ollama ---------------- */
  authorityHandle(A.ollamaHealth, (_e, force: unknown) => ollamaProvider.health(force === true));
  authorityHandle(A.ollamaModels, () => ollamaProvider.listModels());

  /**
   * Classification only. The router receives a prompt and returns a shape; it
   * is never handed a tool, and its `tools` field is a suggestion the planner
   * is free to ignore.
   */
  authorityHandle(A.route, async (_e, prompt: unknown, _preferredModel: unknown, requestedRun: unknown): Promise<RoutingDecision> => {
    const text = safeContextText(str(prompt));
    if (!text.trim()) return heuristicRoute('');
    const id = typeof requestedRun === 'string' ? requestedRun : authorityActiveRun();
    authority.gate(id);
    // Organization belongs to JARVIS. Classification needs no model load,
    // prompt tokens or provider call; actual reasoning stays in execution.
    const decision = heuristicRoute(text);
    return {...decision, reason: decision.reason + '; organización local sin inferencia de clasificación'};
  });

  /* ---------------- audit forwarding ---------------- */
  authorityHandle(A.notifyReady, () => {
    if (!win.isDestroyed()) win.webContents.send(A.ready, true);
    return true;
  });
}

export function unregisterAgentIpc(): void {
  Object.values(IPC.agent).forEach((channel) => {
    try {
      ipcMain.removeHandler(channel);
    } catch {
      // Event-only channels have no handler to remove.
    }
  });
}
