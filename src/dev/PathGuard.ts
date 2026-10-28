import type { FsPort } from './ports';
import { basename, dirname, invalidReason, isAbsolute, isWithin, join, normalize, relative, resolve, sepOf } from './paths';
import { isSecretFile } from './classify';

export class PathDeniedError extends Error {
  constructor(message: string, readonly code: 'invalid' | 'outside_roots' | 'protected' | 'symlink' | 'vcs_internal') {
    super(message);
    this.name = 'PathDeniedError';
  }
}

export interface GuardedPath {
  /** Canonical absolute path: symlinks and junctions resolved. */
  path: string;
  root: string | null;
  /** Relative to its root, with forward slashes. */
  relative: string;
  secret: boolean;
}

export function defaultProtectedPaths(flavor: 'win32' | 'posix', env: Record<string, string | undefined> = {}): string[] {
  if (flavor === 'win32') {
    const sys = (env.SystemDrive ?? 'C:').replace(/\\$/, '');
    return [
      env.SystemRoot ?? `${sys}\\Windows`, env.ProgramFiles ?? `${sys}\\Program Files`,
      env['ProgramFiles(x86)'] ?? `${sys}\\Program Files (x86)`, `${sys}\\ProgramData\\Microsoft`,
      `${sys}\\Boot`, `${sys}\\Recovery`, `${sys}\\System Volume Information`, `${sys}\\$Recycle.Bin`,
    ];
  }
  return ['/etc', '/bin', '/sbin', '/usr', '/boot', '/lib', '/lib64', '/proc', '/sys', '/dev', '/var/lib', '/System', '/Library'];
}

/**
 * Every developer-agent path goes through here before any disk operation.
 *
 * The check is made on the CANONICAL path: ".." is resolved lexically, then
 * the deepest existing ancestor is resolved on disk (symlinks, junctions), and
 * only that result is compared with the authorised roots. A junction inside a
 * project that points to C:\Windows therefore resolves to C:\Windows and is
 * refused, whatever the path string looked like.
 *
 * RESTRICTED keeps the project/system fences. FULL permits ordinary local paths
 * under Windows ACLs, while structured tools still protect JARVIS control files.
 */
export class PathGuard {
  private roots: string[] = [];
  readonly protectedPaths: string[];

  constructor(
    private readonly fs: FsPort,
    options: { protectedPaths?: string[]; installDir?: string | null; home?: string | null; readOutsideRoots?: boolean; fullNative?: () => boolean; controlPaths?: string[] } = {},
  ) {
    this.protectedPaths = [...(options.protectedPaths ?? defaultProtectedPaths(fs.flavor)), ...(options.installDir ? [options.installDir] : [])]
      .map((p) => normalize(p, fs.flavor));
    this.home = options.home ? normalize(options.home, fs.flavor) : null;
    this.readOutsideRoots = options.readOutsideRoots ?? false;
    this.fullNative = options.fullNative ?? (() => false);
    this.controlPaths = options.controlPaths ?? [];
  }
  private readonly home: string | null;
  private readonly readOutsideRoots: boolean;
  private readonly fullNative: () => boolean;
  private readonly controlPaths: string[];

  get flavor() { return this.fs.flavor; }
  listRoots(): string[] { return [...this.roots]; }

  /** Resolves symlinks/junctions on the part of the path that exists. */
  async canonical(input: string): Promise<string> {
    const f = this.fs.flavor;
    const lexical = normalize(input, f);
    const tail: string[] = [];
    let cur = lexical;
    for (let i = 0; i < 512; i++) {
      try {
        const real = await this.fs.realpath(cur);
        return tail.length ? join(f, real, ...tail.reverse()) : normalize(real, f);
      } catch {
        const parent = dirname(cur, f);
        if (parent === cur) return lexical;
        tail.push(basename(cur, f));
        cur = parent;
      }
    }
    return lexical;
  }

  private isProtected(p: string): string | null {
    return this.protectedPaths.find((prot) => isWithin(prot, p, this.fs.flavor)) ?? null;
  }

  /**
   * Registers a Project Root. Refused: drive or filesystem roots, the home
   * folder itself, protected paths, and any folder that contains one.
   */
  async addRoot(input: string): Promise<string> {
    const f = this.fs.flavor;
    const bad = invalidReason(input, f);
    if (bad) throw new PathDeniedError(bad, 'invalid');
    if (!isAbsolute(input, f)) throw new PathDeniedError('Un Project Root debe ser una ruta absoluta.', 'invalid');
    const canon = await this.canonical(input);
    // The rule, not the accident: a drive root is refused even if absent.
    if (!this.fullNative() && dirname(canon, f) === canon) throw new PathDeniedError('Una unidad completa no puede ser un Project Root.', 'protected');
    const st = await this.fs.stat(canon).catch(() => null);
    if (!st?.isDirectory) throw new PathDeniedError('El Project Root debe ser una carpeta existente.', 'invalid');
    if (!this.fullNative() && this.home && normalize(canon, f).toLowerCase() === this.home.toLowerCase()) {
      throw new PathDeniedError('La carpeta de usuario completa no puede ser un Project Root; elige una subcarpeta.', 'protected');
    }
    const prot = this.isProtected(canon) ?? this.protectedPaths.find((pp) => isWithin(canon, pp, f));
    if (prot && !this.fullNative()) throw new PathDeniedError(`«${canon}» es o contiene una ruta protegida del sistema (${prot}).`, 'protected');
    if (!this.roots.some((r) => normalize(r, f) === canon)) this.roots.push(canon);
    return canon;
  }

  removeRoot(input: string): void {
    const n = normalize(input, this.fs.flavor);
    this.roots = this.roots.filter((r) => r !== n);
  }

  rootOf(canonicalPath: string): string | null {
    const f = this.fs.flavor;
    // Longest match wins when roots nest.
    return [...this.roots].sort((a, b) => b.length - a.length).find((r) => isWithin(r, canonicalPath, f)) ?? null;
  }

  /**
   * Validates a path for reading or writing. Relative paths resolve against
   * `base` (normally the project root) and never against the process cwd.
   */
  async check(input: string, opts: { write: boolean; base?: string; allowSymlinkLeaf?: boolean }): Promise<GuardedPath> {
    const f = this.fs.flavor;
    const bad = invalidReason(input, f);
    if (bad) throw new PathDeniedError(bad, 'invalid');
    if (!isAbsolute(input, f) && !opts.base) throw new PathDeniedError('Ruta relativa sin proyecto de referencia.', 'invalid');
    const absolute = opts.base ? resolve(opts.base, input, f) : normalize(input, f);

    const leaf = await this.fs.lstat(absolute).catch(() => null);
    if (leaf?.isSymlink && !opts.allowSymlinkLeaf) {
      throw new PathDeniedError('JARVIS no opera sobre enlaces simbólicos ni junctions directamente.', 'symlink');
    }

    const canon = await this.canonical(absolute);
    const prot = this.isProtected(canon);
    if (this.controlPaths.some(p => isWithin(p, canon, f))) throw new PathDeniedError('Control plane de JARVIS: no es un destino de herramientas.', 'protected');
    if (prot && !this.fullNative()) throw new PathDeniedError(`«${canon}» está dentro de una ruta protegida (${prot}).`, 'protected');

    const root = this.rootOf(canon);
    if (!root) {
      if (!this.fullNative() && (opts.write || !this.readOutsideRoots)) {
        throw new PathDeniedError(`«${canon}» está fuera de los Project Roots autorizados.`, 'outside_roots');
      }
    }
    const rel = root ? relative(root, canon, f) : canon;
    // Writing into .git would allow hooks (arbitrary code on the next git
    // command). Git state changes only through GitService.
    if (!this.fullNative() && opts.write && root && (rel === '.git' || rel.startsWith('.git/') || rel.includes('/.git/'))) {
      throw new PathDeniedError('Los internos de .git sólo se modifican a través de los comandos de Git permitidos.', 'vcs_internal');
    }
    return { path: canon, root, relative: rel, secret: isSecretFile(basename(canon, f)) };
  }

  describe(): string {
    return `${this.roots.length} Project Roots · separador ${sepOf(this.fs.flavor)}`;
  }
}
