import type { AdapterMap } from './types';
import { CancelledError } from '../cancellation';
import { sanitizeText } from '@/machine/CredentialBoundary';
import { mockTree } from '@/mocks/files';
import type { FileNode } from '@/types';

/**
 * Used when the renderer runs outside the Electron shell. Same tool ids, same
 * permission checks, mock data underneath — so the whole agent layer stays
 * exercisable in a plain browser and in tests.
 */
function flatten(nodes: FileNode[], out: FileNode[] = []): FileNode[] {
  for (const node of nodes) {
    out.push(node);
    if (node.children) flatten(node.children, out);
  }
  return out;
}

export function buildMockAdapters(): AdapterMap {
  const all = flatten(mockTree);

  const guard = (signal: AbortSignal) => {
    if (signal.aborted) throw new CancelledError('La ejecución fue cancelada.');
  };

  return {
    'filesystem.getDrives': (_args: never, ctx) => {
      guard(ctx.signal);
      return [{ path: 'D:\\', label: 'D:', kind: 'drive' as const }];
    },
    'filesystem.list': (args: { path: string }, ctx) => {
      guard(ctx.signal);
      const node = all.find((n) => n.path === args?.path);
      return (node?.children ?? []).map(toEntry);
    },
    'filesystem.stat': (args: { path: string }, ctx) => {
      guard(ctx.signal);
      const node = all.find((n) => n.path === args?.path);
      if (!node) throw new Error(`No existe: ${args?.path}`);
      return { ...toEntry(node), createdAt: node.modified, readonly: true };
    },
    'filesystem.exists': (args: { path: string }, ctx) => {
      guard(ctx.signal);
      return all.some((n) => n.path === args?.path);
    },
    'filesystem.search': (args: { query: string; limit?: number }, ctx) => {
      guard(ctx.signal);
      const needle = (args?.query ?? '').toLowerCase();
      if (needle.length < 2) return [];
      return all
        .filter((n) => n.name.toLowerCase().includes(needle))
        .slice(0, args?.limit ?? 40)
        .map(toEntry);
    },
    'app.list': (args: { query?: string }, ctx) => {
      guard(ctx.signal);
      const apps = ['Blender', 'Visual Studio Code', 'Arma Reforger', 'Obsidian', 'PowerShell']
        .map((name) => ({ id: name.toLowerCase(), name, path: `C:\\Mock\\${name}.lnk`, source: 'start-menu' as const }));
      const q = (args?.query ?? '').toLowerCase().trim();
      return q ? apps.filter((a) => a.name.toLowerCase().includes(q)) : apps;
    },
    'system.getInfo': (_args: never, ctx) => {
      guard(ctx.signal);
      return {
        platform: 'mock', release: '0.0.0', arch: 'x64', hostname: 'jarvis-mock',
        cpuModel: 'CPU simulada', cpuCount: 8, totalMemory: 34_359_738_368,
        freeMemory: 12_884_901_888, uptimeSeconds: 7200,
        appVersion: '0.1.0', electronVersion: 'n/d', nodeVersion: 'n/d',
      };
    },
    'process.list': (_args: never, ctx) => {
      guard(ctx.signal);
      return [{ pid: 1, name: 'JARVIS Desktop (simulado)', memory: 180_000_000 }];
    },
    'browser.getActiveTab': (_args: never, ctx) => {
      guard(ctx.signal);
      return { id: 'mock-tab', url: 'about:blank', title: 'Nueva pestaña', loading: false };
    },
    'browser.getPageText': (_args: never, ctx) => {
      guard(ctx.signal);
      return sanitizeText('Contenido simulado: no hay motor de navegación en este entorno.');
    },
    'browser.navigate': (args: { url: string }, ctx) => {
      guard(ctx.signal);
      return { url: args?.url ?? '' };
    },
    'browser.back': (_args: never, ctx) => { guard(ctx.signal); return { ok: true }; },
    'browser.forward': (_args: never, ctx) => { guard(ctx.signal); return { ok: true }; },
  };
}

function toEntry(node: FileNode) {
  return {
    name: node.name,
    path: node.path,
    kind: node.kind === 'folder' ? ('dir' as const) : ('file' as const),
    size: node.bytes,
    modifiedAt: node.modified,
    ext: node.name.includes('.') ? node.name.split('.').pop()!.toLowerCase() : '',
  };
}
