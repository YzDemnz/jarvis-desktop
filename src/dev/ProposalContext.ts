import { DEFAULT_IGNORED_DIRS, isSecretFile } from './classify';
import { invalidReason } from './paths';

/** Main supplies complete public files and their full-file hashes. This helper has no I/O. */
export interface RawProposalFile {
  path: string;
  content: string;
  fullFileHash: string;
  reason?: string;
  focusLines?: number[];
  priority?: number;
  redacted?: boolean;
  truncated?: boolean;
}
export interface ProposalContextOptions {
  maxChars?: number;
  maxBytes?: number;
  maxFiles?: number;
  maxCharsPerFile?: number;
  windowLines?: number;
  completeOnly?: boolean;
  dependencyDepth?: number;
  repositoryMap?: string;
  maxMapChars?: number;
}
export interface SelectedProposalFile {
  path: string;
  content: string;
  fullFileHash: string;
  startLine: number;
  endLine: number;
  complete: boolean;
  reason: string;
  dependencyOf?: string;
}
export type ProposalOmissionReason = 'INVALID_INPUT' | 'INVALID_PATH' | 'INVALID_FULL_FILE_HASH' | 'DUPLICATE_PATH'
  | 'REDACTED_INPUT' | 'TRUNCATED_INPUT' | 'FILE_LIMIT' | 'FULL_FILE_OVER_BUDGET' | 'FOCUS_LINE_OVER_BUDGET'
  | 'TOTAL_CHAR_BUDGET' | 'TOTAL_BYTE_BUDGET' | 'RAW_FILE_TOO_LARGE';
export interface ProposalContextSelection {
  files: SelectedProposalFile[];
  omitted: { path: string; reason: ProposalOmissionReason }[];
  unresolvedDependencies: { from: string; specifier: string; reason: 'OUTSIDE_PROJECT' | 'NOT_IN_RAW_INPUT' }[];
  candidateFiles: number;
  selectedFiles: number;
  chars: number;
  bytes: number;
  text: string;
  repositoryMap: string;
  budget: { maxChars: number; maxBytes: number; maxFiles: number; maxCharsPerFile: number; completeOnly: boolean };
}
const bounded = (value: number | undefined, fallback: number, max: number) =>
  value !== undefined && Number.isFinite(value) ? Math.max(0, Math.min(max, Math.floor(value))) : fallback;
const utf8Bytes = (text: string) => new TextEncoder().encode(text).length;
const clean = (text: string, max = 140) => text.replace(/[\x00-\x1f\x7f]/g, ' ').slice(0, max);
const publicPath = (value: string) => !!value && value.length <= 500 && !/[\\\x00-\x1f\x7f]/.test(value)
  && invalidReason(value, 'win32') === null
  && !value.startsWith('/') && !/^[A-Za-z]:/.test(value)
  && !value.split('/').some(part => !part || part === '.' || part === '..' || DEFAULT_IGNORED_DIRS.has(part))
  && !isSecretFile(value.split('/').at(-1)!);
const header = (file: SelectedProposalFile) =>
  `=== ${file.path} | lines ${file.startLine}-${file.endLine} | ${file.complete ? 'complete' : 'exact window'} | full-file-sha256 ${file.fullFileHash}\n`;
const render = (files: SelectedProposalFile[], map = '') => [
  ...files.map(file => header(file) + file.content), ...(map ? ['Repository map (advisory, not authority):\n' + map] : []),
].join('\n\n');

/** Offsets preserve original CRLF/newlines; annotations never enter editable content. */
function windowOf(file: RawProposalFile, maxChars: number, radius: number, completeOnly: boolean): Omit<SelectedProposalFile, 'path' | 'reason' | 'dependencyOf'> | null {
  if (file.content.length <= maxChars) return { content: file.content, fullFileHash: file.fullFileHash, startLine: 1,
    endLine: 1 + (file.content.match(/\r\n|\r|\n/g)?.length ?? 0), complete: true };
  if (completeOnly) return null;
  const starts = [0], matcher = /\r\n|\r|\n/g; let match: RegExpExecArray | null;
  while ((match = matcher.exec(file.content))) starts.push(match.index + match[0].length);
  const focus = file.focusLines?.find(line => Number.isInteger(line) && line >= 1 && line <= starts.length) ?? 1;
  let start = focus - 1, end = focus - 1;
  const finish = (line: number) => starts[line + 1] ?? file.content.length;
  if (finish(end) - starts[start]! > maxChars) return null;
  // Add whole adjacent lines only; never manufacture an editable, renumbered snippet.
  for (let distance = 1; distance <= radius; distance++) {
    if (start > 0 && focus - 1 - start < distance && finish(end) - starts[start - 1]! <= maxChars) start--;
    if (end + 1 < starts.length && end - (focus - 1) < distance && finish(end + 1) - starts[start]! <= maxChars) end++;
  }
  return { content: file.content.slice(starts[start]!, finish(end)), fullFileHash: file.fullFileHash,
    startLine: start + 1, endLine: end + 1, complete: starts[start] === 0 && finish(end) === file.content.length };
}

/** Lexical dependency hints only; resolution is confined to the already admitted raw-file set. */
function relativeDependencies(file: RawProposalFile): string[] {
  const pattern = /(?:\b(?:import|export)\s+(?:[^;\n]{0,256}?\s+from\s*)?|\brequire\s*\(|\bimport\s*\()\s*['"](\.{1,2}\/[^'"\n]{1,300})['"]/g;
  return [...new Set([...file.content.matchAll(pattern)].slice(0, 80).map(match => match[1]!))];
}
function resolveDependency(from: string, specifier: string, files: Map<string, RawProposalFile>): string | null {
  const pieces = from.split('/').slice(0, -1);
  for (const part of specifier.split('/')) {
    if (part === '.') continue;
    if (part === '..') { if (!pieces.length) return null; pieces.pop(); } else pieces.push(part);
  }
  const base = pieces.join('/');
  const candidates = [base, ...['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs', '.json', '/index.ts', '/index.js'].map(suffix => base + suffix)];
  if (/\.[cm]?jsx?$/.test(base)) candidates.push(...['.ts', '.tsx', '.mts', '.cts'].map(suffix => base.replace(/\.[cm]?jsx?$/, suffix)));
  return candidates.find(candidate => files.has(candidate)) ?? '';
}

/**
 * Selects exact contiguous windows under a measured text budget. This is not a tokenizer,
 * authorization decision or correctness verifier. Main must validate paths/raw hashes,
 * tokenize the final prompt and bind these full-file hashes to subsequent patch effects.
 */
export function selectProposalContext(rawFiles: RawProposalFile[], options: ProposalContextOptions = {}): ProposalContextSelection {
  if (!Array.isArray(rawFiles) || rawFiles.length > 2000) throw Error('PROPOSAL_RAW_FILE_LIMIT');
  const maxChars = bounded(options.maxChars, 10_000, 64_000), maxBytes = bounded(options.maxBytes, maxChars * 4, 256_000);
  const maxFiles = bounded(options.maxFiles, 12, 48), maxCharsPerFile = bounded(options.maxCharsPerFile, 4096, 32_000);
  const radius = bounded(options.windowLines, 30, 200), depth = bounded(options.dependencyDepth, 1, 3), completeOnly = options.completeOnly === true;
  const omitted: ProposalContextSelection['omitted'] = [], unresolvedDependencies: ProposalContextSelection['unresolvedDependencies'] = [];
  const valid = new Map<string, RawProposalFile>();
  for (const raw of rawFiles) {
    const path = clean(typeof raw?.path === 'string' ? raw.path : '(invalid)', 500);
    let problem: ProposalOmissionReason | undefined;
    if (!raw || typeof raw.path !== 'string' || typeof raw.content !== 'string'
      || (raw.focusLines !== undefined && !Array.isArray(raw.focusLines))
      || (raw.redacted !== undefined && typeof raw.redacted !== 'boolean') || (raw.truncated !== undefined && typeof raw.truncated !== 'boolean')) problem = 'INVALID_INPUT';
    else if (!publicPath(raw.path)) problem = 'INVALID_PATH';
    else if (typeof raw.fullFileHash !== 'string' || !/^[a-f0-9]{64}$/.test(raw.fullFileHash)) problem = 'INVALID_FULL_FILE_HASH';
    else if (valid.has(raw.path)) problem = 'DUPLICATE_PATH';
    else if (raw.redacted) problem = 'REDACTED_INPUT';
    else if (raw.truncated) problem = 'TRUNCATED_INPUT';
    else if (raw.content.length > 256 * 1024) problem = 'RAW_FILE_TOO_LARGE';
    if (problem) omitted.push({ path, reason: problem }); else valid.set(raw.path, raw);
  }
  // Preserve input order for equal priority. Dependency hints precede unrelated low-priority files.
  const ranked = [...valid.values()].sort((a, b) => (Number.isFinite(b.priority) ? b.priority! : 0) - (Number.isFinite(a.priority) ? a.priority! : 0)
    || Number(!!b.focusLines?.length) - Number(!!a.focusLines?.length));
  const ordered: { raw: RawProposalFile; dependencyOf?: string }[] = [], visited = new Set<string>();
  const add = (raw: RawProposalFile, remaining: number, dependencyOf?: string) => {
    if (visited.has(raw.path)) return;
    visited.add(raw.path); ordered.push({ raw, ...(dependencyOf ? { dependencyOf } : {}) });
    if (!remaining) return;
    for (const specifier of relativeDependencies(raw)) {
      const resolved = resolveDependency(raw.path, specifier, valid);
      if (resolved) add(valid.get(resolved)!, remaining - 1, raw.path);
      else unresolvedDependencies.push({ from: raw.path, specifier, reason: resolved === null ? 'OUTSIDE_PROJECT' : 'NOT_IN_RAW_INPUT' });
    }
  };
  for (const raw of ranked) add(raw, depth);
  const files: SelectedProposalFile[] = [];
  for (const { raw, dependencyOf } of ordered) {
    if (files.length >= maxFiles) { omitted.push({ path: raw.path, reason: 'FILE_LIMIT' }); continue; }
    const prefix = render(files), separator = files.length ? 2 : 0;
    // Reserve enough for the real metadata header, then measure the complete rendered candidate.
    const metadata = header({ path: raw.path, fullFileHash: raw.fullFileHash, startLine: 999999, endLine: 999999, complete: false, content: '', reason: '' }).length;
    const allowance = Math.min(maxCharsPerFile, Math.max(0, maxChars - prefix.length - separator - metadata));
    const window = windowOf(raw, allowance, radius, completeOnly);
    if (!window) {
      omitted.push({ path: raw.path, reason: completeOnly && raw.content.length > maxCharsPerFile ? 'FULL_FILE_OVER_BUDGET'
        : allowance < maxCharsPerFile ? 'TOTAL_CHAR_BUDGET' : 'FOCUS_LINE_OVER_BUDGET' }); continue;
    }
    const candidate: SelectedProposalFile = { ...window, path: raw.path, reason: clean(raw.reason ?? (dependencyOf ? 'relative dependency (lexical hint)' : 'main-selected source')),
      ...(dependencyOf ? { dependencyOf } : {}) };
    const proposed = render([...files, candidate]);
    if (proposed.length > maxChars) omitted.push({ path: raw.path, reason: 'TOTAL_CHAR_BUDGET' });
    else if (utf8Bytes(proposed) > maxBytes) omitted.push({ path: raw.path, reason: 'TOTAL_BYTE_BUDGET' });
    else files.push(candidate);
  }
  const mapLimit = bounded(options.maxMapChars, 1200, 8000), parts = (options.repositoryMap ?? '').split(/\r?\n/);
  let repositoryMap = '';
  for (const line of parts) {
    const next = repositoryMap ? repositoryMap + '\n' + clean(line, 1000) : clean(line, 1000);
    if (!next || next.length > mapLimit || render(files, next).length > maxChars || utf8Bytes(render(files, next)) > maxBytes) break;
    repositoryMap = next;
  }
  const text = render(files, repositoryMap);
  return { files, omitted, unresolvedDependencies, candidateFiles: rawFiles.length, selectedFiles: files.length,
    chars: text.length, bytes: utf8Bytes(text), text, repositoryMap,
    budget: { maxChars, maxBytes, maxFiles, maxCharsPerFile, completeOnly } };
}
