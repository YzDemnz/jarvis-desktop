import type { DevProject, GitSummary, ProjectRoot } from '@/types';
import type { FsPort } from './ports';
import type { PathGuard } from './PathGuard';
import { basename, join, normalize } from './paths';
import { DEFAULT_IGNORED_DIRS } from './classify';
import { detectTechnologies, isProjectMarker } from './technology';
import { ProjectIndexer } from './ProjectIndexer';
import { ProjectWatcher } from './ProjectWatcher';
import type { WatchPort } from './ProjectWatcher';
import { CodeSearch } from './CodeSearch';
import { sha256 } from './hash';

export interface ProjectConfig {
  roots: ProjectRoot[];
  recent: string[];
  lastOpened: Record<string, number>;
}

export interface ConfigPort { load(): Promise<ProjectConfig | null>; save(c: ProjectConfig): Promise<void> }

export class MemoryConfigPort implements ConfigPort {
  constructor(private value: ProjectConfig | null = null) {}
  async load() { return this.value; }
  async save(c: ProjectConfig) { this.value = JSON.parse(JSON.stringify(c)); }
}

export interface OpenProject {
  project: DevProject;
  indexer: ProjectIndexer;
  search: CodeSearch;
  watcher: ProjectWatcher | null;
}

const DISCOVERY_DEPTH = 3;
const MAX_DIRS_VISITED = 5000;

/**
 * Projects are folders with markers (package.json, Cargo.toml, *.csproj, .git…),
 * found only inside the Project Roots the user registered, plus recent
 * folders. Discovery descends at most three levels, skips generated folders,
 * never follows symlinks, and stops at the first project it meets on a branch
 * — it never scans a whole drive.
 */
export class ProjectService {
  private projects = new Map<string, DevProject>();
  private opened = new Map<string, OpenProject>();
  private config: ProjectConfig = { roots: [], recent: [], lastOpened: {} };

  constructor(
    private readonly fs: FsPort,
    readonly guard: PathGuard,
    private readonly deps: {
      config?: ConfigPort;
      gitSummary?: (root: string) => Promise<GitSummary>;
      watchPort?: WatchPort | null;
    } = {},
  ) {}

  static idFor(rootPath: string): string { return `proj_${sha256(rootPath.toLowerCase()).slice(0, 12)}`; }

  async init(): Promise<void> {
    const loaded = await this.deps.config?.load();
    if (loaded) this.config = { roots: loaded.roots ?? [], recent: loaded.recent ?? [], lastOpened: loaded.lastOpened ?? {} };
    for (const r of this.config.roots) await this.guard.addRoot(r.path).catch(() => {});
  }

  private async persist(): Promise<void> { await this.deps.config?.save(this.config); }

  roots(): ProjectRoot[] { return [...this.config.roots]; }

  async addRoot(path: string): Promise<ProjectRoot> {
    const canon = await this.guard.addRoot(path);
    const root = { path: canon, addedAt: Date.now() };
    if (!this.config.roots.some((r) => r.path === canon)) this.config.roots.push(root);
    await this.persist();
    return root;
  }

  async removeRoot(path: string): Promise<void> {
    const n = normalize(path, this.fs.flavor);
    this.guard.removeRoot(n);
    this.config.roots = this.config.roots.filter((r) => r.path !== n);
    await this.persist();
  }

  /** Builds the project record for one folder, or null if it is not a project. */
  async describe(dir: string): Promise<DevProject | null> {
    let names: string[];
    try { names = (await this.fs.readdir(dir)).map((e) => e.name); } catch { return null; }
    if (!names.some(isProjectMarker)) return null;
    let pkg: string | null = null;
    if (names.includes('package.json')) {
      try { pkg = new TextDecoder().decode(await this.fs.readFile(join(this.fs.flavor, dir, 'package.json'))); } catch { /* unreadable */ }
    }
    const tech = detectTechnologies(names, pkg);
    let name = basename(dir, this.fs.flavor);
    try { const parsed = pkg ? JSON.parse(pkg) as { name?: string } : null; if (parsed?.name) name = parsed.name; } catch { /* keep folder name */ }
    const git = await this.deps.gitSummary?.(dir).catch(() => null) ?? { isRepo: names.includes('.git'), branch: null, dirty: false, changedFiles: 0 };
    const id = ProjectService.idFor(dir);
    return {
      id, name, rootPath: dir, type: tech.type, technologies: tech.technologies, markers: tech.markers, git,
      files: this.opened.get(id)?.indexer.size ?? null,
      status: this.opened.has(id) ? 'indexed' : 'discovered',
      lastOpened: this.config.lastOpened[id] ?? null,
    };
  }

  async discover(): Promise<DevProject[]> {
    const found = new Map<string, DevProject>();
    let visited = 0;
    const visit = async (dir: string, depth: number): Promise<void> => {
      if (visited++ > MAX_DIRS_VISITED) return;
      const project = await this.describe(dir);
      if (project) { found.set(project.id, project); return; }
      if (depth >= DISCOVERY_DEPTH) return;
      let entries;
      try { entries = await this.fs.readdir(dir); } catch { return; }
      for (const e of entries) {
        if (!e.isDirectory || e.isSymlink || DEFAULT_IGNORED_DIRS.has(e.name) || e.name.startsWith('.')) continue;
        await visit(join(this.fs.flavor, dir, e.name), depth + 1);
      }
    };
    for (const root of this.guard.listRoots()) await visit(root, 0);
    for (const recent of this.config.recent) {
      const inRoot = this.guard.rootOf(await this.guard.canonical(recent));
      if (!inRoot) continue; // recents outside the roots are not trusted
      const p = await this.describe(recent);
      if (p) found.set(p.id, p);
    }
    this.projects = found;
    return this.list();
  }

  list(): DevProject[] {
    return [...this.projects.values()].sort((a, b) => (b.lastOpened ?? 0) - (a.lastOpened ?? 0) || a.name.localeCompare(b.name));
  }

  get(id: string): DevProject | undefined { return this.projects.get(id); }

  /** Finds a project by id, exact name, or a name mentioned in a sentence. */
  resolve(query: string): DevProject | undefined {
    const q = query.toLowerCase();
    return this.projects.get(query)
      ?? this.list().find((p) => p.name.toLowerCase() === q)
      ?? this.list().find((p) => q.includes(p.name.toLowerCase()) || q.includes(basename(p.rootPath, this.fs.flavor).toLowerCase()));
  }

  async inspect(id: string): Promise<DevProject> {
    const p = this.projects.get(id);
    if (!p) throw new Error('Proyecto desconocido. Ejecuta project.discover primero.');
    const fresh = await this.describe(p.rootPath);
    if (!fresh) throw new Error('La carpeta ya no parece un proyecto.');
    this.projects.set(id, fresh);
    return fresh;
  }

  /** Indexes the project and starts watching it. Idempotent. */
  async open(id: string): Promise<OpenProject> {
    const existing = this.opened.get(id);
    if (existing) return existing;
    const p = this.projects.get(id);
    if (!p) throw new Error('Proyecto desconocido.');
    const check = await this.guard.check(p.rootPath, { write: false });
    if (!check.root) throw new Error('El proyecto está fuera de los Project Roots.');
    const indexer = new ProjectIndexer(this.fs, p.rootPath);
    p.status = 'indexing';
    await indexer.build();
    const watcher = this.deps.watchPort ? new ProjectWatcher(this.deps.watchPort, indexer, this.fs.flavor) : null;
    watcher?.start();
    const now = Date.now();
    this.config.lastOpened[id] = now;
    this.config.recent = [p.rootPath, ...this.config.recent.filter((r) => r !== p.rootPath)].slice(0, 20);
    await this.persist();
    Object.assign(p, { status: 'indexed', files: indexer.size, lastOpened: now });
    const open: OpenProject = { project: p, indexer, search: new CodeSearch(this.fs, indexer), watcher };
    this.opened.set(id, open);
    return open;
  }

  openedProject(id: string): OpenProject | undefined { return this.opened.get(id); }
  /** The open project that contains a path, for routing watcher notices. */
  openedFor(path: string): OpenProject | undefined {
    return [...this.opened.values()].find((o) => normalize(path, this.fs.flavor).toLowerCase().startsWith(o.project.rootPath.toLowerCase()));
  }

  closeAll(): void { this.opened.forEach((o) => o.watcher?.stop()); this.opened.clear(); }
}
