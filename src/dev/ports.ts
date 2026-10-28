import type { PathFlavor } from './paths';

export interface FsStat {
  isFile: boolean;
  isDirectory: boolean;
  isSymlink: boolean;
  size: number;
  mtimeMs: number;
}

export interface DirEntry { name: string; isDirectory: boolean; isFile: boolean; isSymlink: boolean }

/**
 * The only way the developer agent touches a disk. Node implements it in main;
 * an in-memory version backs the renderer harness. Note what is missing: there
 * is no recursive delete and no generic unlink — removing user files goes
 * through TrashPort, and `removeTemp` only ever sees JARVIS's own temp files.
 */
export interface FsPort {
  readonly flavor: PathFlavor;
  realpath(p: string): Promise<string>;
  stat(p: string): Promise<FsStat>;
  lstat(p: string): Promise<FsStat>;
  exists(p: string): Promise<boolean>;
  readdir(p: string): Promise<DirEntry[]>;
  readFile(p: string): Promise<Uint8Array>;
  writeFile(p: string, data: Uint8Array): Promise<void>;
  rename(from: string, to: string): Promise<void>;
  copyFile(from: string, to: string): Promise<void>;
  mkdir(p: string): Promise<void>;
  /** Removes an EMPTY directory only. */
  rmdirEmpty(p: string): Promise<void>;
  /** Removes a temp file JARVIS created (name matches TEMP_MARKER). */
  removeTemp(p: string): Promise<void>;
}

export const TEMP_MARKER = '.jarvis-tmp-';

/** Deleting means the Recycle Bin. Permanent deletion does not exist here. */
export interface TrashPort {
  readonly native: boolean;
  trash(p: string): Promise<void>;
}

/** Content-addressed store for pre-change file contents (undo). */
export interface SnapshotPort {
  put(data: Uint8Array): Promise<string>;
  get(id: string): Promise<Uint8Array | null>;
  list(): Promise<string[]>;
  delete(id: string): Promise<void>;
}

export interface SpawnRequest {
  file: string;
  args: string[];
  cwd: string;
  env: Record<string, string>;
  /** Windows: pass args untouched (used only for cmd.exe with pre-quoted args). */
  windowsVerbatimArguments?: boolean;
  /** Native app launches may show a window, but keep ownership. */
  visible?: boolean;
}

export interface SpawnedProcess {
  readonly pid: number | null;
  readonly ready?: Promise<number>;
  readonly ownership?: 'WINDOWS_JOB';
  onStdout(cb: (chunk: string) => void): void;
  onStderr(cb: (chunk: string) => void): void;
  onExit(cb: (code: number | null, signal: string | null) => void): void;
  /** Terminates this process and the children it created. Never anything else. */
  killTree(): Promise<void>;
}

export interface ProcessPort {
  readonly platform: 'win32' | 'posix';
  /** Resolves an executable name on PATH. Null when it is not installed. */
  which(executable: string): Promise<string | null>;
  spawn(req: SpawnRequest): SpawnedProcess;
  /** Environment the process port may pass down (already filtered). */
  baseEnv(): Record<string, string>;
}
