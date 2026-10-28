import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { isSecretFile, looksBinary, DEFAULT_IGNORED_DIRS } from '../../dev/classify';
import { capsulePolicy, validateCapsulePolicy, type AgentCapsulePolicy } from './AgentCapsulePolicy';

export interface CapsuleFile { hash: string; size: number; mtimeMs: number; binary: boolean }
export interface CapsuleManifest {
  capsuleId: string; runId: string; conversationId: string; provider: string; agent: string;
  sourceProject: string; workspace: string; createdAt: number; policy: AgentCapsulePolicy;
  files: Record<string, CapsuleFile>; excluded: Array<{ path: string; reason: string }>;
  sourceStateHash: string; git: { head: string | null; remotesCopied: false; internalsCopied: false };
}

const EXTRA_DIRS = new Set(['logs', 'log', 'cache', 'caches', 'browser-profiles', 'profiles', 'cookies', 'databases', 'storage', '.codex', '.claude', '.opencode']);
const EXTRA_NAMES = /(^|[._-])(token|cookie|credential|password|secret|session|auth)([._-]|$)|\.(db|sqlite|sqlite3|log)$/i;
const SECRET_TEXT = /-----BEGIN (?:[A-Z ]* )?PRIVATE KEY-----|(?:api[_-]?key|(?:access[_-]?|refresh[_-]?)?token|(?:client[_-]?)?secret|password|passwd|authorization|cookie)\s*[:=]\s*["'`]?(?!\s*(?:undefined|null|example|placeholder|your[-_]))[^\s"'`,;]{8,}/i;
const SAFE_EXT = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.json', '.md', '.css', '.scss', '.html', '.py', '.rs', '.go', '.cs', '.java', '.kt', '.c', '.h', '.cpp', '.hpp', '.toml', '.yaml', '.yml', '.xml', '.sh', '.ps1', '.sql', '.lua', '.conf', '.ini', '.txt', '.gitignore', '.editorconfig']);

export const hashBytes = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex');
export function containsSecret(bytes: Uint8Array): boolean { return !looksBinary(bytes) && SECRET_TEXT.test(Buffer.from(bytes).toString('utf8')); }
export function safeRelative(relative: string): boolean {
  return !!relative && !path.isAbsolute(relative) && !path.win32.isAbsolute(relative) && !relative.startsWith('\\\\')
    && !relative.split(/[\\/]/).some(part => !part || part === '.' || part === '..' || part.includes(':')
      || /[. ]$/.test(part) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part)
      || part.toLowerCase() === '.git' || DEFAULT_IGNORED_DIRS.has(part.toLowerCase()) || EXTRA_DIRS.has(part.toLowerCase())
      || isSecretFile(part) || EXTRA_NAMES.test(part));
}
export function capsulePath(root: string, relative: string): string {
  if (!safeRelative(relative)) throw new Error('CAPSULE_PATH_DENIED');
  const target = path.resolve(root, relative);
  const base = path.resolve(root);
  if (!target.toLowerCase().startsWith(`${base.toLowerCase()}${path.sep}`)) throw new Error('CAPSULE_PATH_DENIED');
  let current = base;
  for (const part of path.relative(base, target).split(path.sep)) {
    current = path.join(current, part);
    if (fs.existsSync(current) && fs.lstatSync(current).isSymbolicLink()) throw new Error('CAPSULE_LINK_DENIED');
  }
  return target;
}

/** Metadata stays in JARVIS; only selected file bytes are placed in the agent directory. */
export class AgentCapsuleWorkspace {
  create(input: { project: string; runId: string; conversationId: string; provider: string; agent: string; policy?: AgentCapsulePolicy }): CapsuleManifest {
    const policy = input.policy ?? capsulePolicy(); validateCapsulePolicy(policy);
    const project = fs.realpathSync(input.project);
    if (!fs.statSync(project).isDirectory() || path.parse(project).root === project) throw new Error('CAPSULE_PROJECT_DENIED');
    const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'jarvis-capsule-'));
    const manifest: CapsuleManifest = { capsuleId: randomUUID(), runId: input.runId, conversationId: input.conversationId,
      provider: input.provider, agent: input.agent, sourceProject: project, workspace, createdAt: Date.now(), policy,
      files: {}, excluded: [], sourceStateHash: '', git: { head: null, remotesCopied: false, internalsCopied: false } };
    let total = 0;
    const exclude = (relative: string, reason: string) => manifest.excluded.push({ path: relative, reason });
    const walk = (dir: string, prefix = ''): void => {
      for (const item of fs.readdirSync(dir, { withFileTypes: true })) {
        const relative = prefix ? `${prefix}/${item.name}` : item.name;
        if (item.isSymbolicLink() || fs.lstatSync(path.join(dir, item.name)).isSymbolicLink()) { exclude(relative, 'LINK_EXCLUDED'); continue; }
        if (item.isDirectory()) {
          if (DEFAULT_IGNORED_DIRS.has(item.name.toLowerCase()) || EXTRA_DIRS.has(item.name.toLowerCase())) { exclude(relative, 'DIRECTORY_EXCLUDED'); continue; }
          walk(path.join(dir, item.name), relative); continue;
        }
        if (!item.isFile()) { exclude(relative, 'SPECIAL_FILE_EXCLUDED'); continue; }
        if (!safeRelative(relative) || isSecretFile(item.name) || EXTRA_NAMES.test(item.name)) { exclude(relative, 'CAPSULE_SECRET_EXCLUDED'); continue; }
        if (!SAFE_EXT.has(path.extname(item.name).toLowerCase()) && !['Dockerfile', 'Makefile', 'LICENSE'].includes(item.name)) { exclude(relative, 'TYPE_EXCLUDED'); continue; }
        const source = path.join(dir, item.name); const stat = fs.statSync(source);
        if (stat.size > policy.maxFileBytes || Object.keys(manifest.files).length >= policy.maxFiles || total + stat.size > policy.maxTotalBytes) { exclude(relative, 'LIMIT_EXCLUDED'); continue; }
        const bytes = fs.readFileSync(source);
        if (containsSecret(bytes)) { exclude(relative, 'CAPSULE_SECRET_EXCLUDED'); continue; }
        if (looksBinary(bytes)) { exclude(relative, 'BINARY_EXCLUDED'); continue; }
        const target = capsulePath(workspace, relative); fs.mkdirSync(path.dirname(target), { recursive: true }); fs.writeFileSync(target, bytes);
        manifest.files[relative] = { hash: hashBytes(bytes), size: bytes.length, mtimeMs: stat.mtimeMs, binary: false }; total += bytes.length;
      }
    };
    try {
      walk(project);
      manifest.sourceStateHash = hashBytes(Buffer.from(JSON.stringify(Object.entries(manifest.files).sort())));
      for (const file of Object.values(manifest.files)) Object.freeze(file);
      for (const item of manifest.excluded) Object.freeze(item);
      Object.freeze(manifest.files); Object.freeze(manifest.excluded); Object.freeze(manifest.policy); Object.freeze(manifest.git);
      return Object.freeze(manifest);
    }
    catch (error) { fs.rmSync(workspace, { recursive: true, force: true }); throw error; }
  }
}
