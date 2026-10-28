/**
 * Local developer agent contract. Every shape is serialisable: these cross IPC,
 * reach the audit log in summarised form, and feed the UI.
 */

export type Technology =
  | 'node' | 'typescript' | 'javascript' | 'react' | 'vite' | 'electron' | 'nextjs'
  | 'python' | 'rust' | 'go' | 'dotnet' | 'java' | 'cmake' | 'cpp' | 'tailwind';

export interface GitSummary {
  isRepo: boolean;
  branch: string | null;
  dirty: boolean;
  /** Files changed before JARVIS touched anything (status at capture time). */
  changedFiles: number;
}

export interface DevProject {
  id: string;
  name: string;
  rootPath: string;
  /** Primary kind, for display. Technologies holds the full picture. */
  type: string;
  technologies: Technology[];
  markers: string[];
  git: GitSummary;
  files: number | null;
  status: 'discovered' | 'indexed' | 'indexing' | 'error';
  lastOpened: number | null;
}

export interface ProjectRoot {
  path: string;
  addedAt: number;
}

export interface IndexedFile {
  relativePath: string;
  size: number;
  mtimeMs: number;
  extension: string;
  language: string | null;
  binary: boolean;
  secret: boolean;
  hash?: string;
}

export interface SearchHit {
  file: string;
  line: number;
  column: number;
  preview: string;
  score: number;
  kind: 'text' | 'reference' | 'definition' | 'file';
}

/* ------------------------------------------------------------------ */
/* Mutations                                                           */
/* ------------------------------------------------------------------ */

export type FileOperation = 'create' | 'write' | 'patch' | 'rename' | 'move' | 'copy' | 'mkdir' | 'trash';

export interface TextEdit {
  /** Exact text expected at the location. The edit fails if it is not there. */
  oldText: string;
  newText: string;
  /** 1-based line near which oldText is expected; disambiguates repeats. */
  nearLine?: number;
}

export type PatchOp =
  | { kind: 'replace'; startLine: number; endLine: number; text: string }
  | { kind: 'insert'; atLine: number; text: string }
  | { kind: 'delete'; startLine: number; endLine: number }
  | { kind: 'edit'; edit: TextEdit };

export interface PatchResult {
  before: string;
  after: string;
  diff: string;
  linesAdded: number;
  linesRemoved: number;
}

export interface FileChange {
  operation: FileOperation;
  path: string;
  /** For rename/move/copy. */
  toPath?: string;
  hashBefore: string | null;
  hashAfter: string | null;
  bytesBefore: number;
  bytesAfter: number;
  at: number;
  /** Snapshot key to restore the pre-JARVIS content, when there was one. */
  snapshotId: string | null;
  /** Set once this single change has been undone. */
  undone?: boolean;
}

export interface ChangeSet {
  runId: string;
  projectRoot: string | null;
  created: number;
  updated: number;
  changes: FileChange[];
  /** Files already modified before JARVIS started (from git or first read). */
  preExisting: string[];
  reverted: boolean;
}

export interface ChangeSetSummary {
  runId: string;
  projectRoot: string | null;
  /** The user's own changes present before JARVIS started: never JARVIS's. */
  preExisting: string[];
  files: { path: string; status: 'M' | 'A' | 'R' | 'T' | 'C'; toPath?: string }[];
  totalBytes: number;
  reverted: boolean;
}

export interface RevertReport {
  restored: string[];
  /** Files the user edited after JARVIS in a way that could not be merged. */
  conflicts: string[];
  skipped: string[];
}

/* ------------------------------------------------------------------ */
/* Processes                                                           */
/* ------------------------------------------------------------------ */

export type CommandRisk = 'SAFE' | 'SENSITIVE' | 'DESTRUCTIVE' | 'CRITICAL';

export interface ProcessRequest {
  executable: string;
  args: string[];
  cwd: string;
  envSubset?: Record<string, string>;
  timeoutMs?: number;
}

export interface CommandVerdict {
  allowed: boolean;
  risk: CommandRisk;
  reason: string;
  /** A dev server or watcher: must run as a managed process, not a command. */
  longRunning: boolean;
}

export interface CommandResult {
  commandId: string;
  exitCode: number | null;
  signal: string | null;
  stdout: string;
  stderr: string;
  durationMs: number;
  timedOut: boolean;
  cancelled: boolean;
  truncated: boolean;
  totalBytes: number;
  /** Id of the full output kept temporarily when it exceeded the limits. */
  outputId: string | null;
}

export interface ManagedProcessInfo {
  id: string;
  runId: string | null;
  label: string;
  executable: string;
  args: string[];
  cwd: string;
  pid: number | null;
  status: 'starting' | 'running' | 'exited' | 'stopped' | 'failed';
  startedAt: number;
  exitCode: number | null;
}

export interface DeveloperTool {
  id: string;
  executable: string;
  path: string | null;
  version: string | null;
  available: boolean;
}

/* ------------------------------------------------------------------ */
/* Git                                                                 */
/* ------------------------------------------------------------------ */

export interface GitStatusEntry {
  path: string;
  /** Porcelain XY code. */
  index: string;
  worktree: string;
  origPath?: string;
}

export interface GitStatus {
  isRepo: boolean;
  branch: string | null;
  entries: GitStatusEntry[];
}

/* ------------------------------------------------------------------ */
/* Coding loop                                                         */
/* ------------------------------------------------------------------ */

export interface VerificationCheck {
  id: string;
  label: string;
  request: Omit<ProcessRequest, 'cwd'>;
}

export interface VerificationFailure {
  check: string;
  exitCode: number | null;
  errors: { file?: string; line?: number; column?: number; message: string }[];
  excerpt: string;
}
