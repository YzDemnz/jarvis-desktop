import type { AdapterMap } from './types';
import { CancelledError } from '../cancellation';
import { sanitizeText } from '@/machine/CredentialBoundary';

type Bridge = NonNullable<Window['jarvis']>;
type AgentBridge = Bridge['agent'];

interface PrivilegedResult<T> { ok: boolean; data?: T; error?: string; reason?: string }

/** Unwraps a main-process result, turning a refusal into a real failure. */
function unwrap<T>(result: PrivilegedResult<T>): T {
  if (!result.ok) throw new Error(result.error ?? 'El proceso principal rechazó la operación.');
  return result.data as T;
}

function guardCancel(signal: AbortSignal): void {
  if (signal.aborted) throw new CancelledError('La ejecución fue cancelada.');
}

/**
 * Renderer-side adapters that forward to the main process. They hold no
 * privilege of their own: each call carries the session permission level, and
 * main re-checks it before doing anything.
 */
export function buildBridgeAdapters(
  agent: AgentBridge,
  browser: Bridge['browser'],
  getLevel: () => string,
): AdapterMap {
  return {
    'filesystem.getDrives': async (_args: never, ctx) => {
      guardCancel(ctx.signal);
      return unwrap(await agent.fsGetDrives(getLevel()));
    },
    'filesystem.list': async (args: { path: string }, ctx) => {
      guardCancel(ctx.signal);
      return unwrap(await agent.fsList(getLevel(), args?.path ?? ''));
    },
    'filesystem.stat': async (args: { path: string }, ctx) => {
      guardCancel(ctx.signal);
      return unwrap(await agent.fsStat(getLevel(), args?.path ?? ''));
    },
    'filesystem.exists': async (args: { path: string }, ctx) => {
      guardCancel(ctx.signal);
      return unwrap(await agent.fsExists(getLevel(), args?.path ?? ''));
    },
    'filesystem.readText': async (args: { path: string }, ctx) => {
      guardCancel(ctx.signal);
      const result = unwrap(await agent.fsReadText(getLevel(), args.path));
      guardCancel(ctx.signal); return result;
    },
    'filesystem.search': async (args: { query: string; limit?: number; roots?: string[] }, ctx) => {
      guardCancel(ctx.signal);
      const result = unwrap(await agent.fsSearch(getLevel(), args));
      guardCancel(ctx.signal);
      return result;
    },
    'app.list': async (args: { query?: string }, ctx) => {
      guardCancel(ctx.signal);
      return unwrap(await agent.appList(getLevel(), args?.query));
    },
    'system.getInfo': async (_args: never, ctx) => {
      guardCancel(ctx.signal);
      return unwrap(await agent.systemInfo(getLevel()));
    },
    'process.list': async (_args: never, ctx) => {
      guardCancel(ctx.signal);
      return unwrap(await agent.processList(getLevel()));
    },

    'browser.getActiveTab': async (_args: never, ctx) => {
      guardCancel(ctx.signal);
      const snapshot = await browser.snapshot();
      const tab = snapshot.tabs.find((t) => t.id === snapshot.activeId);
      if (!tab) throw new Error('No hay ninguna pestaña abierta.');
      return { id: tab.id, url: tab.url, title: tab.title, loading: tab.loading };
    },
    'browser.getPageText': async (_args: never, ctx) => {
      guardCancel(ctx.signal);
      const snapshot = await browser.snapshot();
      if (!snapshot.activeId) throw new Error('No hay ninguna pestaña abierta.');
      const text = await browser.pageText(snapshot.activeId);
      guardCancel(ctx.signal);
      // Nothing leaves the page with a credential still in it.
      return sanitizeText(text);
    },
    'browser.navigate': async (args: { url: string }, ctx) => {
      guardCancel(ctx.signal);
      const snapshot = await browser.snapshot();
      if (!snapshot.activeId) throw new Error('No hay ninguna pestaña abierta.');
      await browser.navigate(snapshot.activeId, args?.url ?? '');
      return { url: args?.url ?? '' };
    },
    'browser.back': async (_args: never, ctx) => {
      guardCancel(ctx.signal);
      const snapshot = await browser.snapshot();
      if (!snapshot.activeId) throw new Error('No hay ninguna pestaña abierta.');
      await browser.back(snapshot.activeId);
      return { ok: true };
    },
    'browser.forward': async (_args: never, ctx) => {
      guardCancel(ctx.signal);
      const snapshot = await browser.snapshot();
      if (!snapshot.activeId) throw new Error('No hay ninguna pestaña abierta.');
      await browser.forward(snapshot.activeId);
      return { ok: true };
    },
  };
}
