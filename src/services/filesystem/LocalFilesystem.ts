import type { FileNode, PermissionLevel } from '@/types';
import { toolBroker } from '@/services/agent/runtime';
import { CancellationToken } from '@/agent';
import { uid } from '@/lib/id';

interface FsEntry { name: string; path: string; kind: 'dir' | 'file'; size: number; modifiedAt: number; ext: string }
interface Drive { path: string; label: string; kind: 'drive' | 'home' | 'known' }

const CODE = new Set(['ts', 'tsx', 'js', 'jsx', 'py', 'rs', 'go', 'java', 'c', 'cpp', 'cs', 'sh', 'ps1']);
const DOC = new Set(['md', 'txt', 'pdf', 'docx', 'rtf']);
const IMAGE = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'ico']);
const ARCHIVE = new Set(['zip', 'rar', '7z', 'tar', 'gz']);
const DATA = new Set(['json', 'csv', 'tsv', 'xlsx', 'yml', 'yaml', 'xml', 'ini', 'toml', 'db', 'sqlite']);

function kindOf(entry: FsEntry): FileNode['kind'] {
  if (entry.kind === 'dir') return 'folder';
  if (CODE.has(entry.ext)) return 'code';
  if (DOC.has(entry.ext)) return 'document';
  if (IMAGE.has(entry.ext)) return 'image';
  if (ARCHIVE.has(entry.ext)) return 'archive';
  if (DATA.has(entry.ext)) return 'data';
  return 'binary';
}

function toNode(entry: FsEntry): FileNode {
  return {
    id: entry.path,
    name: entry.name,
    path: entry.path,
    kind: kindOf(entry),
    bytes: entry.size,
    modified: entry.modifiedAt,
    ...(entry.kind === 'dir' ? { children: [] } : {}),
  };
}

/**
 * Read-only view of the local disk for the Files module. Every call goes
 * through the broker, so browsing a folder is audited and permission-checked
 * exactly like an agent step. There is no write path in this class.
 */
export class LocalFilesystem {
  private async run<T>(toolId: string, args: unknown, permission: PermissionLevel): Promise<T | null> {
    const runId = uid('fsui');
    const token = new CancellationToken();
    toolBroker.openRun(runId, permission, token, 'Explorador de archivos');
    try {
      const result = await toolBroker.execute<T>({ runId, toolId, args });
      return result.ok ? (result.data as T) : null;
    } finally {
      toolBroker.closeRun(runId);
    }
  }

  async drives(permission: PermissionLevel): Promise<FileNode[]> {
    const drives = await this.run<Drive[]>('filesystem.getDrives', {}, permission);
    if (!drives) return [];
    return drives.map((d) => ({
      id: d.path, name: d.label, path: d.path, kind: 'folder' as const,
      bytes: 0, modified: Date.now(), children: [],
    }));
  }

  async list(path: string, permission: PermissionLevel): Promise<FileNode[]> {
    const entries = await this.run<FsEntry[]>('filesystem.list', { path }, permission);
    return entries ? entries.map(toNode) : [];
  }

  async search(query: string, permission: PermissionLevel): Promise<FileNode[]> {
    const entries = await this.run<FsEntry[]>('filesystem.search', { query, limit: 60 }, permission);
    return entries ? entries.map(toNode) : [];
  }

  async readText(path:string,permission:PermissionLevel) {
    return this.run<import('../../../electron/agent/FileSystemService').TextRead>('filesystem.readText',{path},permission);
  }
  async stat(path: string, permission: PermissionLevel): Promise<FileNode | null> {
    const entry = await this.run<FsEntry>('filesystem.stat', { path }, permission);
    return entry ? toNode(entry) : null;
  }
}

export const localFilesystem = new LocalFilesystem();
