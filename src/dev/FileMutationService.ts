import type { FileChange, PatchOp, PatchResult, RevertReport } from '@/types';
import type { FsPort, SnapshotPort, TrashPort } from './ports';
import { TEMP_MARKER } from './ports';
import type { PathGuard } from './PathGuard';
import { PathDeniedError } from './PathGuard';
import { ChangeSetStore } from './ChangeSetStore';
import { applyOps, computeHunks, patchResult, reverseHunks, splitLines } from './patch';
import { sha256Bytes, fromUtf8, utf8 } from './hash';
import { LARGE_FILE_BYTES, isBinaryExtension, looksBinary } from './classify';
import { basename, dirname, extname, join } from './paths';
import { sanitizeText } from '@/machine/CredentialBoundary';

export class ConflictError extends Error {
  readonly conflict = true;
  constructor(message: string, readonly currentHash: string | null) {
    super(message);
    this.name = 'ConflictError';
  }
}

export interface ReadResult {
  path: string;
  relative: string;
  content: string | null;
  hash: string;
  size: number;
  binary: boolean;
  secret: boolean;
  truncated: boolean;
  totalLines: number | null;
  range: { start: number; end: number } | null;
}

export interface MutationOptions {
  runId: string;
  /** Project root that relative paths resolve against. */
  base?: string;
  /** Hash the caller last saw. Omitted: the hash this run last read. */
  expectedHash?: string | null;
  /**
   * false for the user's own saves from the editor: they are atomic and
   * conflict-checked like JARVIS's, but they are NOT JARVIS changes, so they
   * never enter a ChangeSet and "Undo JARVIS" can never touch them.
   */
  record?: boolean;
}

const MAX_WRITE_BYTES = 10 * 1024 * 1024;
const MAX_PATCH_BYTES = 2 * 1024 * 1024;
const MAX_SNAPSHOT_BYTES = 20 * 1024 * 1024;
const RANGE_DEFAULT_LINES = 400;

/**
 * Every write JARVIS makes. The guarantees, in order:
 *   1. The path is canonical and inside an authorised root (PathGuard).
 *   2. An existing file is only replaced if it still has the hash JARVIS read:
 *      a human edit in between is a ConflictError, never an overwrite.
 *   3. The pre-change content is snapshotted before anything is touched.
 *   4. Writes are atomic: temp file, read-back check, conflict re-check, rename.
 *   5. "Delete" is the Recycle Bin. There is no permanent delete here.
 *   6. Every change lands in the run's ChangeSet, so it can be reviewed and
 *      reverted — without undoing the user's later edits when avoidable.
 */
export class FileMutationService {
  readonly changes = new ChangeSetStore();
  private readHashes = new Map<string, Map<string, string>>();

  constructor(
    private readonly fs: FsPort,
    readonly guard: PathGuard,
    private readonly snapshots: SnapshotPort,
    private readonly trashPort: TrashPort,
    private readonly hooks: { onSelfWrite?: (path: string, hash: string | null) => void; assertMutation?: () => void } = {},
  ) {}

  private f() { return this.fs.flavor; }

  private rememberRead(runId: string, path: string, hash: string) {
    let m = this.readHashes.get(runId);
    if (!m) { m = new Map(); this.readHashes.set(runId, m); }
    m.set(path, hash);
  }

  private async currentHash(path: string): Promise<string | null> {
    try { return sha256Bytes(await this.fs.readFile(path)); } catch { return null; }
  }

  /* ---------------- reading ---------------- */

  /**
   * Large files come back by line range, binaries come back without content,
   * and secret files come back redacted (or not at all for key material).
   */
  async read(input: string, opts: { runId: string; base?: string; startLine?: number; endLine?: number }): Promise<ReadResult> {
    const g = await this.guard.check(input, { write: false, ...(opts.base ? { base: opts.base } : {}) });
    const st = await this.fs.stat(g.path);
    if (!st.isFile) throw new Error(`«${g.relative}» no es un archivo.`);
    const bytes = await this.fs.readFile(g.path);
    const hash = sha256Bytes(bytes);
    this.rememberRead(opts.runId, g.path, hash);
    const binary = isBinaryExtension(extname(g.path, this.f())) || looksBinary(bytes);
    const base = { path: g.path, relative: g.relative, hash, size: st.size, binary, secret: g.secret };
    if (binary) return { ...base, content: null, truncated: false, totalLines: null, range: null };

    let text = fromUtf8(bytes);
    if (g.secret) {
      // Key material is never shown. env-style files show keys, never values.
      if (/-----BEGIN [A-Z ]*PRIVATE KEY-----/.test(text) || /\.(pem|key|p12|pfx)$/i.test(g.path)) {
        return { ...base, content: null, truncated: false, totalLines: null, range: null };
      }
      text = text.split(/\r?\n/).map((l) => l.replace(/^(\s*[\w.-]+\s*[=:]\s*).+$/, '$1[redactado]')).join('\n');
      text = sanitizeText(text);
    }
    const lines = splitLines(text).lines;
    const wantsRange = opts.startLine !== undefined || st.size > LARGE_FILE_BYTES;
    if (!wantsRange) return { ...base, content: text, truncated: false, totalLines: lines.length, range: null };
    const start = Math.max(1, opts.startLine ?? 1);
    const end = Math.min(lines.length, opts.endLine ?? start + RANGE_DEFAULT_LINES - 1);
    return {
      ...base,
      content: lines.slice(start - 1, end).join('\n'),
      truncated: end < lines.length || start > 1,
      totalLines: lines.length,
      range: { start, end },
    };
  }

  /* ---------------- core write ---------------- */

  private async snapshot(bytes: Uint8Array | null): Promise<string | null> {
    if (!bytes || bytes.length > MAX_SNAPSHOT_BYTES) return null;
    return this.snapshots.put(bytes);
  }

  /**
   * temp → read back → re-check the parent is still where the guard approved
   * → re-check the target still has the expected hash → atomic rename.
   * `expected` null means "must not exist".
   */
  private async atomicWrite(target: string, bytes: Uint8Array, expected: string | null): Promise<string> {
    this.hooks.assertMutation?.();
    const f = this.f();
    const dir = dirname(target, f);
    const tmp = join(f, dir, `.${basename(target, f)}${TEMP_MARKER}${Math.random().toString(36).slice(2, 10)}`);
    await this.fs.writeFile(tmp, bytes);
    try {
      const written = sha256Bytes(await this.fs.readFile(tmp));
      const want = sha256Bytes(bytes);
      if (written !== want) throw new Error('La verificación de la escritura temporal falló.');
      if ((await this.guard.canonical(dir)) !== dir) {
        throw new PathDeniedError('La carpeta de destino cambió durante la escritura (posible enlace sustituido).', 'symlink');
      }
      const now = await this.currentHash(target);
      if (now !== expected) {
        throw new ConflictError(expected === null
          ? `«${basename(target, f)}» apareció mientras JARVIS escribía; no se sobrescribe.`
          : `«${basename(target, f)}» cambió desde que JARVIS lo leyó. No se sobrescribe: vuelve a leerlo y recalcula el cambio.`, now);
      }
      this.hooks.onSelfWrite?.(target, want);
      this.hooks.assertMutation?.();
      await this.fs.rename(tmp, target);
      return want;
    } catch (error) {
      await this.fs.removeTemp(tmp).catch(() => {});
      throw error;
    }
  }

  private expectedFor(opts: MutationOptions, path: string): string {
    if (opts.expectedHash) return opts.expectedHash;
    const known = this.readHashes.get(opts.runId)?.get(path);
    if (!known) throw new ConflictError('JARVIS no ha leído este archivo en esta tarea. Léelo antes de modificarlo.', null);
    return known;
  }

  private change(c: Omit<FileChange, 'at'>): FileChange { return { ...c, at: Date.now() }; }

  /* ---------------- operations ---------------- */

  async create(input: string, content: string, opts: MutationOptions): Promise<{ path: string; hash: string }> {
    const g = await this.guard.check(input, { write: true, ...(opts.base ? { base: opts.base } : {}) });
    const bytes = utf8(content);
    if (bytes.length > MAX_WRITE_BYTES) throw new Error('El contenido excede el tamaño máximo de escritura.');
    if (await this.fs.exists(g.path)) throw new ConflictError(`«${g.relative}» ya existe. Usa write o patch.`, await this.currentHash(g.path));
    await this.ensureDir(dirname(g.path, this.f()), opts);
    const hash = await this.atomicWrite(g.path, bytes, null);
    this.rememberRead(opts.runId, g.path, hash);
    if (opts.record !== false) this.changes.record(opts.runId, this.change({ operation: 'create', path: g.path, hashBefore: null, hashAfter: hash, bytesBefore: 0, bytesAfter: bytes.length, snapshotId: null }),
      computeHunks('', content));
    return { path: g.path, hash };
  }

  async write(input: string, content: string, opts: MutationOptions): Promise<{ path: string; hash: string; result: PatchResult }> {
    const g = await this.guard.check(input, { write: true, ...(opts.base ? { base: opts.base } : {}) });
    const bytes = utf8(content);
    if (bytes.length > MAX_WRITE_BYTES) throw new Error('El contenido excede el tamaño máximo de escritura.');
    const before = await this.fs.readFile(g.path).catch(() => null);
    if (!before) return { ...(await this.create(input, content, opts)), result: patchResult('', content, g.relative) };
    if (isBinaryExtension(extname(g.path, this.f())) || looksBinary(before)) {
      throw new Error(`«${g.relative}» es un archivo binario; JARVIS no lo sobrescribe como texto.`);
    }
    const expected = this.expectedFor(opts, g.path);
    const beforeHash = sha256Bytes(before);
    if (beforeHash !== expected) {
      throw new ConflictError(`«${g.relative}» cambió desde que JARVIS lo leyó. No se sobrescribe: vuelve a leerlo y recalcula el cambio.`, beforeHash);
    }
    const snap = await this.snapshot(before);
    const hash = await this.atomicWrite(g.path, bytes, beforeHash);
    this.rememberRead(opts.runId, g.path, hash);
    const beforeText = fromUtf8(before);
    if (opts.record !== false) this.changes.record(opts.runId, this.change({ operation: 'write', path: g.path, hashBefore: beforeHash, hashAfter: hash, bytesBefore: before.length, bytesAfter: bytes.length, snapshotId: snap }),
      computeHunks(beforeText, content));
    return { path: g.path, hash, result: patchResult(beforeText, content, g.relative) };
  }

  async patch(input: string, ops: PatchOp[], opts: MutationOptions): Promise<{ path: string; hash: string; result: PatchResult }> {
    const g = await this.guard.check(input, { write: true, ...(opts.base ? { base: opts.base } : {}) });
    const st = await this.fs.stat(g.path).catch(() => null);
    if (!st?.isFile) throw new Error(`«${g.relative}» no existe; usa file.create.`);
    if (st.size > MAX_PATCH_BYTES) throw new Error(`«${g.relative}» es demasiado grande para parchearlo de una vez (${Math.round(st.size / 1024)} KB).`);
    const before = await this.fs.readFile(g.path);
    if (isBinaryExtension(extname(g.path, this.f())) || looksBinary(before)) {
      throw new Error(`«${g.relative}» es un archivo binario; file.patch sólo opera sobre texto.`);
    }
    const expected = this.expectedFor(opts, g.path);
    const beforeHash = sha256Bytes(before);
    if (beforeHash !== expected) {
      throw new ConflictError(`«${g.relative}» cambió desde que JARVIS lo leyó. Vuelve a leerlo y recalcula el parche.`, beforeHash);
    }
    if (g.secret && ops.some((o) => o.kind === 'edit')) {
      throw new Error('En archivos de secretos sólo se permiten operaciones por línea: su contenido real nunca se muestra.');
    }
    // Patch the exact UTF-8 text used by main context, retaining a BOM and CRLF.
    // Invalid bytes cannot be silently reconstructed into a different source file.
    let beforeText: string;
    try { beforeText = new TextDecoder('utf-8', {fatal: true, ignoreBOM: true}).decode(before); }
    catch { throw Error('PATCH_INVALID_UTF8'); }
    const afterText = applyOps(beforeText, ops);
    if (afterText === beforeText) throw new Error('El parche no produce ningún cambio.');
    const snap = await this.snapshot(before);
    const bytes = utf8(afterText);
    const hash = await this.atomicWrite(g.path, bytes, beforeHash);
    this.rememberRead(opts.runId, g.path, hash);
    this.changes.record(opts.runId, this.change({ operation: 'patch', path: g.path, hashBefore: beforeHash, hashAfter: hash, bytesBefore: before.length, bytesAfter: bytes.length, snapshotId: snap }),
      computeHunks(beforeText, afterText));
    const result = patchResult(beforeText, afterText, g.relative);
    // A secret file's diff would show its values: keep only the shape.
    return { path: g.path, hash, result: g.secret ? { ...result, before: '', after: '', diff: `(diff omitido: ${g.relative} contiene secretos)` } : result };
  }

  private async ensureDir(dir: string, opts: MutationOptions): Promise<void> {
    if (await this.fs.exists(dir)) return;
    await this.ensureDir(dirname(dir, this.f()), opts);
    await this.guard.check(dir, { write: true });
    this.hooks.assertMutation?.();
    await this.fs.mkdir(dir);
    this.changes.record(opts.runId, this.change({ operation: 'mkdir', path: dir, hashBefore: null, hashAfter: null, bytesBefore: 0, bytesAfter: 0, snapshotId: null }));
  }

  async mkdir(input: string, opts: MutationOptions): Promise<{ path: string }> {
    const g = await this.guard.check(input, { write: true, ...(opts.base ? { base: opts.base } : {}) });
    await this.ensureDir(g.path, opts);
    return { path: g.path };
  }

  /** Rename and move never overwrite: an existing destination is a conflict. */
  async move(from: string, to: string, opts: MutationOptions, operation: 'rename' | 'move' = 'move'): Promise<{ from: string; to: string }> {
    const a = await this.guard.check(from, { write: true, ...(opts.base ? { base: opts.base } : {}) });
    const b = await this.guard.check(to, { write: true, ...(opts.base ? { base: opts.base } : {}) });
    const st = await this.fs.stat(a.path).catch(() => null);
    if (!st) throw new Error(`«${a.relative}» no existe.`);
    if (await this.fs.exists(b.path)) throw new ConflictError(`«${b.relative}» ya existe; JARVIS no sobrescribe al mover.`, await this.currentHash(b.path));
    const hash = st.isFile ? await this.currentHash(a.path) : null;
    if (opts.expectedHash && hash !== opts.expectedHash) throw new ConflictError('El archivo cambió antes de renombrarlo; no se mueve.', hash);
    await this.ensureDir(dirname(b.path, this.f()), opts);
    this.hooks.onSelfWrite?.(a.path, null);
    this.hooks.onSelfWrite?.(b.path, hash);
    this.hooks.assertMutation?.();
    await this.fs.rename(a.path, b.path);
    this.changes.record(opts.runId, this.change({ operation, path: a.path, toPath: b.path, hashBefore: hash, hashAfter: hash, bytesBefore: st.size, bytesAfter: st.size, snapshotId: null }));
    return { from: a.path, to: b.path };
  }

  async copy(from: string, to: string, opts: MutationOptions): Promise<{ from: string; to: string }> {
    const a = await this.guard.check(from, { write: false, ...(opts.base ? { base: opts.base } : {}) });
    const b = await this.guard.check(to, { write: true, ...(opts.base ? { base: opts.base } : {}) });
    const st = await this.fs.stat(a.path).catch(() => null);
    if (!st?.isFile) throw new Error(`«${a.relative}» no es un archivo.`);
    if (await this.fs.exists(b.path)) throw new ConflictError(`«${b.relative}» ya existe.`, await this.currentHash(b.path));
    await this.ensureDir(dirname(b.path, this.f()), opts);
    const hash = await this.currentHash(a.path);
    this.hooks.onSelfWrite?.(b.path, hash);
    this.hooks.assertMutation?.();
    await this.fs.copyFile(a.path, b.path);
    this.changes.record(opts.runId, this.change({ operation: 'copy', path: a.path, toPath: b.path, hashBefore: null, hashAfter: hash, bytesBefore: 0, bytesAfter: st.size, snapshotId: null }));
    return { from: a.path, to: b.path };
  }

  /** The Recycle Bin, never unlink. The content is snapshotted for undo first. */
  async trash(input: string, opts: MutationOptions): Promise<{ path: string; restorable: boolean }> {
    const g = await this.guard.check(input, { write: true, ...(opts.base ? { base: opts.base } : {}) });
    const st = await this.fs.stat(g.path).catch(() => null);
    if (!st) throw new Error(`«${g.relative}» no existe.`);
    const bytes = st.isFile ? await this.fs.readFile(g.path) : null;
    if (opts.expectedHash && (bytes ? sha256Bytes(bytes) : null) !== opts.expectedHash) {
      throw new ConflictError('El archivo cambió antes de enviarlo a la papelera; no se elimina.', bytes ? sha256Bytes(bytes) : null);
    }
    const snap = await this.snapshot(bytes);
    this.hooks.onSelfWrite?.(g.path, null);
    this.hooks.assertMutation?.();
    await this.trashPort.trash(g.path);
    this.changes.record(opts.runId, this.change({ operation: 'trash', path: g.path, hashBefore: bytes ? sha256Bytes(bytes) : null, hashAfter: null, bytesBefore: st.size, bytesAfter: 0, snapshotId: snap }));
    return { path: g.path, restorable: snap !== null };
  }

  /* ---------------- revert ---------------- */

  async revertRun(runId: string): Promise<RevertReport> {
    const set = this.changes.get(runId);
    const report: RevertReport = { restored: [], conflicts: [], skipped: [] };
    if (!set) return report;
    for (let i = set.changes.length - 1; i >= 0; i--) {
      if (set.changes[i]!.undone) continue;
      await this.revertOne(runId, i, report);
    }
    if (!report.conflicts.length) this.changes.markReverted(runId);
    return report;
  }

  /** Revert File: every JARVIS change to one path in a run, newest first. */
  async revertFile(runId: string, path: string): Promise<RevertReport> {
    const set = this.changes.get(runId);
    const report: RevertReport = { restored: [], conflicts: [], skipped: [] };
    if (!set) throw new Error('No existe un ChangeSet para esa tarea.');
    const touches = set.changes.map((c, i) => ({ c, i })).filter(({ c }) => !c.undone && (c.path === path || c.toPath === path));
    if (!touches.length) throw new Error('JARVIS no cambió ese archivo en esa tarea.');
    for (const { i } of touches.reverse()) await this.revertOne(runId, i, report);
    if (set.changes.every((c) => c.undone)) this.changes.markReverted(runId);
    return report;
  }

  /**
   * Drops a run's ChangeSet and deletes snapshots no remaining ChangeSet
   * references. After this the run can no longer be reverted.
   */
  async forgetRun(runId: string): Promise<{ deleted: number }> {
    this.changes.forget(runId);
    this.readHashes.delete(runId);
    const referenced = new Set(this.changes.list().flatMap((s) => s.changes.map((c) => c.snapshotId).filter((x): x is string => !!x)));
    let deleted = 0;
    for (const id of await this.snapshots.list()) if (!referenced.has(id)) { await this.snapshots.delete(id); deleted++; }
    return { deleted };
  }

  /** Undo Last JARVIS Change: the most recent single operation. */
  async undoLast(): Promise<RevertReport & { runId: string | null }> {
    const set = this.changes.latest();
    const report: RevertReport = { restored: [], conflicts: [], skipped: [] };
    if (!set) return { ...report, runId: null };
    for (let i = set.changes.length - 1; i >= 0; i--) {
      if (set.changes[i]!.undone) continue;
      await this.revertOne(set.runId, i, report);
      break;
    }
    return { ...report, runId: set.runId };
  }

  private async restoreBytes(path: string, snapshotId: string | null, expected: string | null): Promise<boolean> {
    if (!snapshotId) return false;
    const bytes = await this.snapshots.get(snapshotId);
    if (!bytes) return false;
    await this.atomicWrite(path, bytes, expected);
    return true;
  }

  private async revertOne(runId: string, index: number, report: RevertReport): Promise<void> {
    const c = this.changes.get(runId)!.changes[index]!;
    const done = (path: string) => { c.undone = true; report.restored.push(path); };
    try {
      switch (c.operation) {
        case 'write':
        case 'patch': {
          const current = await this.fs.readFile(c.path).catch(() => null);
          if (!current) { report.conflicts.push(c.path); return; }
          const currentHash = sha256Bytes(current);
          if (currentHash === c.hashAfter) {
            if (await this.restoreBytes(c.path, c.snapshotId, currentHash)) done(c.path);
            else report.skipped.push(c.path);
            return;
          }
          // The user edited the file after JARVIS: undo only JARVIS's hunks.
          const hunks = this.changes.hunksOf(runId, index);
          const merged = hunks ? reverseHunks(fromUtf8(current), hunks) : null;
          if (merged === null) { report.conflicts.push(c.path); return; }
          await this.atomicWrite(c.path, utf8(merged), currentHash);
          done(c.path);
          return;
        }
        case 'create':
        case 'copy': {
          const target = c.toPath ?? c.path;
          const now = await this.currentHash(target);
          if (now === null) { c.undone = true; return; }
          if (now !== c.hashAfter) { report.conflicts.push(target); return; }
          this.hooks.onSelfWrite?.(target, null);
          this.hooks.assertMutation?.();
          await this.trashPort.trash(target);
          done(target);
          return;
        }
        case 'rename':
        case 'move': {
          if (await this.fs.exists(c.path) || !(await this.fs.exists(c.toPath!))) { report.conflicts.push(c.toPath!); return; }
          if (c.hashAfter && (await this.currentHash(c.toPath!)) !== c.hashAfter) { report.conflicts.push(c.toPath!); return; }
          this.hooks.assertMutation?.(); await this.fs.rename(c.toPath!, c.path);
          done(c.path);
          return;
        }
        case 'mkdir': {
          const entries = await this.fs.readdir(c.path).catch(() => null);
          if (entries && entries.length === 0) { this.hooks.assertMutation?.(); await this.fs.rmdirEmpty(c.path); done(c.path); }
          else { c.undone = true; if (entries) report.skipped.push(c.path); }
          return;
        }
        case 'trash': {
          if (await this.fs.exists(c.path)) { report.conflicts.push(c.path); return; }
          if (!c.snapshotId) { report.skipped.push(c.path); return; }
          this.hooks.assertMutation?.(); await this.fs.mkdir(dirname(c.path, this.f()));
          if (await this.restoreBytes(c.path, c.snapshotId, null)) done(c.path);
          else report.skipped.push(c.path);
          return;
        }
      }
    } catch (error) {
      if (error instanceof ConflictError) report.conflicts.push(c.toPath ?? c.path);
      else throw error;
    }
  }
}
