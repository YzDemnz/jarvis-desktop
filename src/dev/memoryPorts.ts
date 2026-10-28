import type { DirEntry, FsPort, FsStat, SnapshotPort, TrashPort } from './ports';
import { TEMP_MARKER } from './ports';
import type { PathFlavor } from './paths';
import { basename, dirname, normalize, isWithin } from './paths';
import { sha256Bytes } from './hash';

interface MemNode { kind: 'file' | 'dir'; data?: Uint8Array; mtimeMs: number }

/**
 * In-memory filesystem with real path semantics (case-insensitive on win32).
 * Backs the renderer harness, where Node's fs does not exist. Symlinks are
 * not modelled — their behaviour is tested against the real disk instead.
 */
export class MemoryFsPort implements FsPort {
  private nodes = new Map<string, MemNode>();
  constructor(readonly flavor: PathFlavor = 'win32', files: Record<string, string> = {}) {
    for (const [p, content] of Object.entries(files)) this.seed(p, content);
  }

  private key(p: string) { const n = normalize(p, this.flavor); return this.flavor === 'win32' ? n.toLowerCase() : n; }
  private display = new Map<string, string>();

  seed(p: string, content: string, mtimeMs = Date.now()): void {
    const n = normalize(p, this.flavor);
    let dir = dirname(n, this.flavor);
    const dirs: string[] = [];
    while (!this.nodes.has(this.key(dir))) { dirs.push(dir); const up = dirname(dir, this.flavor); if (up === dir) break; dir = up; }
    for (const d of dirs.reverse()) { this.nodes.set(this.key(d), { kind: 'dir', mtimeMs }); this.display.set(this.key(d), d); }
    this.nodes.set(this.key(n), { kind: 'file', data: new TextEncoder().encode(content), mtimeMs });
    this.display.set(this.key(n), n);
  }

  private get(p: string): MemNode {
    const node = this.nodes.get(this.key(p));
    if (!node) { const e = new Error(`ENOENT: ${p}`) as Error & { code: string }; e.code = 'ENOENT'; throw e; }
    return node;
  }

  async realpath(p: string) { this.get(p); return this.display.get(this.key(p)) ?? normalize(p, this.flavor); }
  async stat(p: string): Promise<FsStat> {
    const n = this.get(p);
    return { isFile: n.kind === 'file', isDirectory: n.kind === 'dir', isSymlink: false, size: n.data?.length ?? 0, mtimeMs: n.mtimeMs };
  }
  lstat(p: string) { return this.stat(p); }
  async exists(p: string) { return this.nodes.has(this.key(p)); }
  async readdir(p: string): Promise<DirEntry[]> {
    if (this.get(p).kind !== 'dir') throw new Error(`ENOTDIR: ${p}`);
    const base = this.key(p);
    const out: DirEntry[] = [];
    for (const [k, n] of this.nodes) {
      if (k !== base && this.key(dirname(k, this.flavor)) === base) {
        out.push({ name: basename(this.display.get(k) ?? k, this.flavor), isDirectory: n.kind === 'dir', isFile: n.kind === 'file', isSymlink: false });
      }
    }
    return out;
  }
  async readFile(p: string) { const n = this.get(p); if (n.kind !== 'file') throw new Error(`EISDIR: ${p}`); return new Uint8Array(n.data!); }
  async writeFile(p: string, data: Uint8Array) {
    this.get(dirname(p, this.flavor));
    this.nodes.set(this.key(p), { kind: 'file', data: new Uint8Array(data), mtimeMs: Date.now() });
    this.display.set(this.key(p), normalize(p, this.flavor));
  }
  async rename(from: string, to: string) {
    const fk = this.key(from);
    for (const [k, n] of [...this.nodes]) {
      if (k === fk || isWithin(fk, k, this.flavor)) {
        const rest = (this.display.get(k) ?? k).slice(normalize(from, this.flavor).length);
        const nk = normalize(normalize(to, this.flavor) + rest, this.flavor);
        this.nodes.delete(k); this.display.delete(k);
        this.nodes.set(this.key(nk), n); this.display.set(this.key(nk), nk);
      }
    }
  }
  async copyFile(from: string, to: string) { await this.writeFile(to, await this.readFile(from)); }
  async mkdir(p: string) {
    const n = normalize(p, this.flavor);
    const chain: string[] = [];
    let cur = n;
    while (!this.nodes.has(this.key(cur))) { chain.push(cur); const up = dirname(cur, this.flavor); if (up === cur) break; cur = up; }
    for (const d of chain.reverse()) { this.nodes.set(this.key(d), { kind: 'dir', mtimeMs: Date.now() }); this.display.set(this.key(d), d); }
  }
  async rmdirEmpty(p: string) { if ((await this.readdir(p)).length) throw new Error('ENOTEMPTY'); this.nodes.delete(this.key(p)); }
  async removeTemp(p: string) {
    if (!basename(p, this.flavor).includes(TEMP_MARKER)) throw new Error('removeTemp sólo acepta temporales de JARVIS.');
    this.nodes.delete(this.key(p));
  }

  /** Test/harness helper: simulate the user editing a file outside JARVIS. */
  async userEdit(p: string, content: string) { await this.writeFile(p, new TextEncoder().encode(content)); }
  text(p: string): string | null { const n = this.nodes.get(this.key(p)); return n?.data ? new TextDecoder().decode(n.data) : null; }
  /** Test/harness helper: every file path under a folder (display casing). */
  filesUnder(dir: string): string[] {
    const base = this.key(dir);
    return [...this.nodes.entries()].filter(([k, n]) => n.kind === 'file' && isWithin(base, k, this.flavor) && k !== base).map(([k]) => this.display.get(k) ?? k);
  }
  /** Test/harness helper: a file disappearing behind JARVIS's back. */
  vanish(p: string): void { this.nodes.delete(this.key(p)); }
}

/** Moves items into an in-memory "bin" — never deletes. */
export class MemoryTrashPort implements TrashPort {
  readonly native = false;
  readonly items: string[] = [];
  constructor(private readonly fs: MemoryFsPort, private readonly binDir: string) {}
  async trash(p: string) {
    await this.fs.mkdir(this.binDir);
    const target = `${this.binDir}${this.fs.flavor === 'win32' ? '\\' : '/'}${Date.now()}-${this.items.length}-${basename(p, this.fs.flavor)}`;
    await this.fs.rename(p, target);
    this.items.push(p);
  }
}

export class MemorySnapshotPort implements SnapshotPort {
  private store = new Map<string, Uint8Array>();
  async put(data: Uint8Array) { const id = sha256Bytes(data); this.store.set(id, new Uint8Array(data)); return id; }
  async get(id: string) { return this.store.get(id) ?? null; }
  async list() { return [...this.store.keys()]; }
  async delete(id: string) { this.store.delete(id); }
  size() { return this.store.size; }
}
