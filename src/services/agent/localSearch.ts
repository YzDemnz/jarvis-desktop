import type { PermissionLevel } from '@/types';
import { toolBroker } from './runtime';
import { CancellationToken } from '@/agent';
import { uid } from '@/lib/id';

export type SearchSource = 'files' | 'folders' | 'apps' | 'history' | 'projects' | 'commands' | 'conversations';

export interface SearchHit {
  id: string;
  title: string;
  subtitle: string;
  source: SearchSource;
  /** True when the row came from the real machine rather than a mock. */
  live: boolean;
  path?: string;
}

interface FsEntryLike { name: string; path: string; kind: 'dir' | 'file'; size: number; modifiedAt: number }
interface AppLike { id: string; name: string; path: string; source: string }

/**
 * Search that goes through the broker like everything else. It opens a
 * short-lived run so the same permission check, audit entry and cancellation
 * apply to a keystroke-driven lookup as to an agent step — there is no side
 * door into the filesystem.
 */
export class LocalSearchService {
  private token: CancellationToken | null = null;

  cancel(): void {
    this.token?.cancel('Búsqueda reemplazada');
    this.token = null;
  }

  async query(text: string, permission: PermissionLevel): Promise<SearchHit[]> {
    const needle = text.trim();
    if (needle.length < 2) return [];

    this.cancel();
    const token = new CancellationToken();
    this.token = token;

    const runId = uid('search');
    toolBroker.openRun(runId, permission, token, `Búsqueda universal: ${needle}`);

    try {
      const [files, apps] = await Promise.all([
        toolBroker.execute<FsEntryLike[]>({ runId, toolId: 'filesystem.search', args: { query: needle, limit: 30 } }),
        toolBroker.execute<AppLike[]>({ runId, toolId: 'app.list', args: { query: needle } }),
      ]);

      if (token.cancelled) return [];
      const hits: SearchHit[] = [];

      if (files.ok && Array.isArray(files.data)) {
        for (const entry of files.data) {
          hits.push({
            id: `fs-${entry.path}`,
            title: entry.name,
            subtitle: entry.path,
            source: entry.kind === 'dir' ? 'folders' : 'files',
            live: true,
            path: entry.path,
          });
        }
      }

      if (apps.ok && Array.isArray(apps.data)) {
        for (const app of apps.data.slice(0, 8)) {
          hits.push({
            id: `app-${app.id}`,
            title: app.name,
            subtitle: app.path,
            source: 'apps',
            live: true,
            path: app.path,
          });
        }
      }

      return hits;
    } finally {
      toolBroker.closeRun(runId);
      if (this.token === token) this.token = null;
    }
  }

  /** Why a search came back empty, so the UI can say something useful. */
  async explain(permission: PermissionLevel): Promise<string | null> {
    const definition = toolBroker.registry.get('filesystem.search');
    if (!definition) return 'La herramienta de búsqueda no está declarada.';
    const verdict = toolBroker.permissions.check(definition, permission);
    return verdict.allowed ? null : verdict.reason;
  }
}

export const localSearch = new LocalSearchService();
