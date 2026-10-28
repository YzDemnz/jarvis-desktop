import type { IndexedFile } from '@/types';
import type { FsPort } from './ports';
import { TEMP_MARKER } from './ports';
import { join, relative, extname, basename } from './paths';
import { DEFAULT_IGNORED_DIRS, isBinaryExtension, isSecretFile, languageOf } from './classify';
import { IgnoreMatcher } from './ignore';
import { sha256Bytes } from './hash';

export interface IndexDelta { added: number; changed: number; removed: number; unchanged: number }

const MAX_FILES = 200_000;
const HASH_LIMIT = 256 * 1024;

/**
 * Incremental file index for one project. The first build walks the tree once;
 * afterwards refresh() only re-reads what changed (size or mtime), and watcher
 * events update single entries. Ignored: generated and vendored folders, VCS
 * internals, .gitignore'd paths, JARVIS temp files. Symlinked folders are not
 * followed (they are a classic way to escape a project).
 */
export class ProjectIndexer {
  private files = new Map<string, IndexedFile>();
  private ignore = new IgnoreMatcher();
  /** Revision of the selected project snapshot, including JARVIS self-writes. */
  revision = 0;
  truncated = false;

  constructor(private readonly fs: FsPort, readonly root: string) {}

  private async loadIgnore(): Promise<void> {
    this.ignore = new IgnoreMatcher();
    try { this.ignore.add(new TextDecoder().decode(await this.fs.readFile(join(this.fs.flavor, this.root, '.gitignore')))); } catch { /* none */ }
  }

  private skipDir(name: string, rel: string): boolean {
    return DEFAULT_IGNORED_DIRS.has(name) || this.ignore.ignores(rel, true);
  }

  private async entryFor(abs: string, rel: string, size: number, mtimeMs: number, previous?: IndexedFile): Promise<IndexedFile> {
    const ext = extname(abs, this.fs.flavor);
    const name = basename(abs, this.fs.flavor);
    const entry: IndexedFile = {
      relativePath: rel, size, mtimeMs, extension: ext, language: languageOf(ext),
      binary: isBinaryExtension(ext), secret: isSecretFile(name),
    };
    // Hashes only for small text files, and reused when nothing changed.
    if (previous && previous.size === size && previous.mtimeMs === mtimeMs && previous.hash) entry.hash = previous.hash;
    else if (!entry.binary && !entry.secret && size <= HASH_LIMIT) {
      try { entry.hash = sha256Bytes(await this.fs.readFile(abs)); } catch { /* vanished */ }
    }
    return entry;
  }

  private async walk(visit: (abs: string, rel: string, size: number, mtimeMs: number) => Promise<void>): Promise<void> {
    const f = this.fs.flavor;
    const stack = [this.root];
    let count = 0;
    while (stack.length) {
      const dir = stack.pop()!;
      let entries;
      try { entries = await this.fs.readdir(dir); } catch { continue; }
      for (const e of entries) {
        const abs = join(f, dir, e.name);
        const rel = relative(this.root, abs, f);
        if (e.isSymlink) continue;
        if (e.isDirectory) { if (!this.skipDir(e.name, rel)) stack.push(abs); continue; }
        if (!e.isFile || e.name.includes(TEMP_MARKER) || this.ignore.ignores(rel, false)) continue;
        if (++count > MAX_FILES) { this.truncated = true; return; }
        const st = await this.fs.stat(abs).catch(() => null);
        if (st) await visit(abs, rel, st.size, st.mtimeMs);
      }
    }
  }

  async build(): Promise<IndexDelta> {
    await this.loadIgnore();
    this.files.clear();
    this.truncated = false;
    await this.walk(async (abs, rel, size, mtime) => { this.files.set(rel, await this.entryFor(abs, rel, size, mtime)); });
    this.revision++;
    return { added: this.files.size, changed: 0, removed: 0, unchanged: 0 };
  }

  /** Re-stat everything, re-read only what changed. */
  async refresh(): Promise<IndexDelta> {
    await this.loadIgnore();
    const seen = new Set<string>();
    const delta: IndexDelta = { added: 0, changed: 0, removed: 0, unchanged: 0 };
    await this.walk(async (abs, rel, size, mtime) => {
      seen.add(rel);
      const prev = this.files.get(rel);
      if (prev && prev.size === size && prev.mtimeMs === mtime) { delta.unchanged++; return; }
      this.files.set(rel, await this.entryFor(abs, rel, size, mtime, prev));
      if (prev) delta.changed++; else delta.added++;
    });
    for (const rel of [...this.files.keys()]) if (!seen.has(rel)) { this.files.delete(rel); delta.removed++; }
    if (delta.added || delta.changed || delta.removed) this.revision++;
    return delta;
  }

  /** One file changed on disk (from the watcher). */
  async update(rel: string): Promise<'added' | 'changed' | 'removed' | 'ignored'> {
    const f = this.fs.flavor;
    const name = basename(rel, 'posix');
    if (name.includes(TEMP_MARKER) || rel.split('/').some((seg) => DEFAULT_IGNORED_DIRS.has(seg)) || this.ignore.ignores(rel, false)) return 'ignored';
    const abs = join(f, this.root, ...rel.split('/'));
    const st = await this.fs.stat(abs).catch(() => null);
    if (!st || !st.isFile) {
      if (!this.files.delete(rel)) return 'ignored';
      this.revision++; return 'removed';
    }
    const prev = this.files.get(rel);
    this.files.set(rel, await this.entryFor(abs, rel, st.size, st.mtimeMs, prev));
    this.revision++;
    return prev ? 'changed' : 'added';
  }

  list(): IndexedFile[] { return [...this.files.values()]; }
  get(rel: string): IndexedFile | undefined { return this.files.get(rel); }
  get size(): number { return this.files.size; }
}
