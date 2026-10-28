export type FileKind = 'folder' | 'code' | 'document' | 'image' | 'archive' | 'data' | 'binary';

export interface FileNode {
  id: string;
  name: string;
  path: string;
  kind: FileKind;
  bytes: number;
  modified: number;
  children?: FileNode[];
}

export interface FilesystemService {
  list(path: string): Promise<FileNode[]>;
  search(query: string, root?: string): Promise<FileNode[]>;
  read(path: string): Promise<string>;
  stat(path: string): Promise<FileNode>;
}

export interface StorageVolume {
  id: string;
  label: string;
  kind: 'local' | 'cloud' | 'archive' | 'sync';
  usedBytes: number;
  totalBytes?: number;
  status: 'healthy' | 'attention' | 'syncing';
}

export interface ArchiveCandidate {
  id: string;
  name: string;
  path: string;
  bytes: number;
  lastTouched: number;
  reason: string;
}

export interface SyncTarget {
  id: string;
  label: string;
  kind: 'github' | 'cloud' | 'database' | 'vault';
  status: 'synced' | 'pending' | 'error' | 'syncing';
  lastSync: number;
  pending: number;
  error?: string;
}
