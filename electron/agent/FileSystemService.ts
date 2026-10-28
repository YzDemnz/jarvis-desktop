import { app } from 'electron';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {safeContextText} from '../../src/fabric/ContinuityState';

export interface TextRead {path:string;text:string;bytes:number;sha256:string;truncated:boolean;encoding:string}
export interface SearchStatus {scope:'FULL_DEVICE'|'USER_ROOTS';directories:number;entries:number;unreadable:number;skippedLinks:number;truncated:boolean;elapsedMs:number}

export interface DriveInfo {
  path: string;
  label: string;
  kind: 'drive' | 'home' | 'known';
}

export interface FsEntry {
  name: string;
  path: string;
  kind: 'dir' | 'file';
  size: number;
  modifiedAt: number;
  ext: string;
}

export interface FsStat extends FsEntry {
  createdAt: number;
  readonly: boolean;
}

export interface SearchOptions {
  query: string;
  roots?: string[];
  limit?: number;
  maxDepth?: number;
}

/** Directories that are never worth walking and often huge. */
const SKIP_DIRS = new Set([
  'node_modules', '.git', '.svn', '.hg', 'dist', 'build', 'out', '.next', '.cache',
  'AppData', 'Windows', '$Recycle.Bin', 'System Volume Information', 'ProgramData',
  '.venv', 'venv', '__pycache__', 'target', 'vendor', '.gradle', '.idea',
]);

const MAX_ENTRIES = 2000;
const DEFAULT_LIMIT = 60;
const DEFAULT_DEPTH = 6;

/**
 * Read-only view of the local filesystem.
 *
 * There is no write, move, rename or delete here, and that is deliberate: the
 * class cannot be talked into mutating anything because the capability does not
 * exist in it. Existing write capabilities use the separate execution service.
 *
 * Every path is resolved and checked against the allowed roots before any
 * syscall, so `..` cannot climb out of them.
 */
export class FileSystemService {
  private lastSearch: SearchStatus | null = null;
  private driveCache:{at:number;roots:string[]}|null=null;
  constructor(private readonly fullDevice:()=>boolean = ()=>false) {}
  searchStatus(): SearchStatus | null {return this.lastSearch ? {...this.lastSearch} : null;}
  private deviceRoots():string[] {
    if(this.driveCache&&Date.now()-this.driveCache.at<5000)return [...this.driveCache.roots];
    if(process.platform!=='win32')return ['/'];
    const roots=[...'ABCDEFGHIJKLMNOPQRSTUVWXYZ'].map(letter=>letter+':\\').filter(root=>{try{return fs.existsSync(root);}catch{return false;}});
    this.driveCache={at:Date.now(),roots};return roots;
  }

  /** Roots the agent may read. Everything else is refused. */
  allowedRoots(): string[] {
    const home = os.homedir();
    const roots = this.fullDevice() ? this.deviceRoots() : [home, ...this.extraRoots()];
    return roots.filter((r, i) => r && roots.indexOf(r) === i);
  }

  private extraRoots(): string[] {
    const out: string[] = [];
    const push = (p: string | undefined) => { if (p && fs.existsSync(p)) out.push(p); };
    try {
      push(app.getPath('documents'));
      push(app.getPath('downloads'));
      push(app.getPath('desktop'));
    } catch {
      // getPath throws before the app is ready; the home root is enough then.
    }
    // On Windows the extra fixed drives are useful roots; on other platforms
    // the home directory already covers the interesting ground.
    if (process.platform === 'win32') {
      for (const letter of 'DEFGH') {
        const drive = `${letter}:\\`;
        try { if (fs.existsSync(drive)) out.push(drive); } catch { /* not present */ }
      }
    }
    return out;
  }

  /** True when `target` sits inside one of the allowed roots. */
  isAllowed(target: string): boolean {
    if(!target || !path.isAbsolute(target) || /[\0\r\n]/.test(target))return false;
    if(process.platform==='win32' && (!/^[a-z]:[\\/]/i.test(target)||target.slice(2).includes(':')))return false;
    let resolved: string;
    try {
      resolved = path.resolve(target);
    } catch {
      return false;
    }
    return this.allowedRoots().some((root) => {
      const base = path.resolve(root);
      if (process.platform==='win32') {resolved=resolved.toLowerCase();}
      const comparable=process.platform==='win32'?base.toLowerCase():base;
      if (resolved === comparable) return true;
      const withSep = comparable.endsWith(path.sep) ? comparable : comparable + path.sep;
      return resolved.startsWith(withSep);
    });
  }

  private assertAllowed(target: string): string {
    const resolved = path.resolve(target);
    if (!this.isAllowed(resolved)) {
      throw new Error(`Ruta fuera de las raíces permitidas: ${resolved}`);
    }
    const canonical = fs.realpathSync(resolved);
    if(!this.isAllowed(canonical))throw Error('FILESYSTEM_CANONICAL_SCOPE_DENIED');
    return canonical;
  }

  /** Same canonical scope as text reads; structured readers never bypass it. */
  documentPath(target:string):string {
    const file=this.assertAllowed(target);
    if(file.split(/[\\/]/).some(part=>/^(?:\.env(?:\..*)?|\.ssh|\.aws|\.azure|credentials(?:\..*)?|cookies(?:\..*)?|login data|id_rsa|id_ed25519)$/i.test(part)))throw Error('FILESYSTEM_CREDENTIAL_MATERIAL_NOT_TEXT_CONTEXT');
    if(!/\.(docx|pdf|txt|md|csv)$/i.test(file))throw Error('DOCUMENT_FORMAT_UNSUPPORTED');
    return file;
  }

  async getDrives(): Promise<DriveInfo[]> {
    const home = os.homedir();
    const drives: DriveInfo[] = [{ path: home, label: path.basename(home) || home, kind: 'home' }];
    for (const root of (this.fullDevice()?this.deviceRoots():this.extraRoots())) {
      if (root === home) continue;
      drives.push({
        path: root,
        label: /^[A-Z]:\\$/i.test(root) ? root.replace(/\\$/, '') : path.basename(root) || root,
        kind: /^[A-Z]:\\$/i.test(root) ? 'drive' : 'known',
      });
    }
    return drives;
  }

  async exists(target: string): Promise<boolean> {
    if (!this.isAllowed(target)) return false;
    try {
      await fsp.access(this.assertAllowed(target), fs.constants.R_OK);
      return true;
    } catch {
      return false;
    }
  }

  async stat(target: string): Promise<FsStat> {
    const resolved = this.assertAllowed(target);
    const info = await fsp.stat(resolved);
    let readonly = false;
    try {
      await fsp.access(resolved, fs.constants.W_OK);
    } catch {
      readonly = true;
    }
    return {
      name: path.basename(resolved) || resolved,
      path: resolved,
      kind: info.isDirectory() ? 'dir' : 'file',
      size: info.size,
      modifiedAt: info.mtimeMs,
      createdAt: info.birthtimeMs,
      ext: info.isDirectory() ? '' : path.extname(resolved).replace('.', '').toLowerCase(),
      readonly,
    };
  }

  async listDirectory(target: string): Promise<FsEntry[]> {
    const resolved = this.assertAllowed(target);
    const dirents = await fsp.readdir(resolved, { withFileTypes: true });
    const out: FsEntry[] = [];
    for (const dirent of dirents.slice(0, MAX_ENTRIES)) {
      if (!this.fullDevice() && dirent.name.startsWith('.')) continue;
      const full = path.join(resolved, dirent.name);
      try {
        const info = await fsp.stat(this.assertAllowed(full));
        out.push({
          name: dirent.name,
          path: full,
          kind: info.isDirectory() ? 'dir' : 'file',
          size: dirent.isDirectory() ? 0 : info.size,
          modifiedAt: info.mtimeMs,
          ext: dirent.isDirectory() ? '' : path.extname(dirent.name).replace('.', '').toLowerCase(),
        });
      } catch {
        // Permission-denied entries are skipped rather than failing the listing.
      }
    }
    return out.sort((a, b) => (a.kind === b.kind ? a.name.localeCompare(b.name) : a.kind === 'dir' ? -1 : 1));
  }

  async readText(target:string):Promise<TextRead> {
    const mode=this.fullDevice(), file=this.assertAllowed(target);
    if(file.split(/[\\/]/).some(part=>/^(?:\.env(?:\..*)?|\.ssh|\.aws|\.azure|credentials(?:\..*)?|cookies(?:\..*)?|login data|id_rsa|id_ed25519)$/i.test(part)))throw Error('FILESYSTEM_CREDENTIAL_MATERIAL_NOT_TEXT_CONTEXT');
    const handle=await fsp.open(file,'r');
    try {
      const info=await handle.stat();if(!info.isFile()||info.size>262144)throw Error('FILESYSTEM_TEXT_SIZE_OR_TYPE_UNSUPPORTED');
      const bytes=Buffer.alloc(262145);const read=await handle.read(bytes,0,bytes.length,0);
      if(read.bytesRead>262144||this.fullDevice()!==mode)throw Error('FILESYSTEM_READ_CHANGED_OR_TOO_LARGE');
      const data=bytes.subarray(0,read.bytesRead), utf16=data[0]===255&&data[1]===254;
      const decoded=new TextDecoder(utf16?'utf-16le':'utf-8',{fatal:true}).decode(data);
      if(decoded.includes('\0'))throw Error('FILESYSTEM_BINARY_NOT_TEXT');
      const text=safeContextText(decoded);
      return {path:file,text:text.slice(0,12000),bytes:read.bytesRead,sha256:createHash('sha256').update(data).digest('hex'),truncated:text.length>12000,encoding:utf16?'UTF-16LE':'UTF-8'};
    } finally {await handle.close();}
  }

  /**
   * Breadth-first name search. Bounded by depth, result count and a visited
   * budget so a search on a large disk cannot hang the agent, and cancellable
   * through the signal at every directory boundary.
   */
  async search(options: SearchOptions, signal?: AbortSignal): Promise<FsEntry[]> {
    const needle = options.query.trim().toLowerCase();
    if (needle.length < 2) return [];

    const limit = Math.min(Math.max(options.limit ?? DEFAULT_LIMIT, 1), 200);
    const fullAccess=this.fullDevice();
    const maxDepth = Math.min(Math.max(options.maxDepth ?? (fullAccess?12:DEFAULT_DEPTH), 1), fullAccess?64:10);
    const requested = options.roots?.length ? options.roots : this.allowedRoots();
    const roots = requested.filter((r) => this.isAllowed(r));

    const results: FsEntry[] = [];
    const queue: { dir: string; depth: number }[] = roots.map((dir) => ({ dir: path.resolve(dir), depth: 0 }));
    let visited = 0;
    const started=Date.now(), status:SearchStatus={scope:fullAccess?'FULL_DEVICE':'USER_ROOTS',directories:0,entries:0,unreadable:0,skippedLinks:0,truncated:false,elapsedMs:0};
    this.lastSearch=status;

    search: while (queue.length && results.length < limit && visited < 6000) {
      if (signal?.aborted||this.fullDevice()!==fullAccess) throw new DOMExceptionLike('La búsqueda fue cancelada.');
      if(Date.now()-started>10000){status.truncated=true;break;}
      const next = queue.shift();
      if (!next) break;
      visited += 1;
      status.directories=visited;

      let dirents;
      try {
        dirents = await fsp.readdir(this.assertAllowed(next.dir), { withFileTypes: true });
      } catch {
        status.unreadable++;
        continue;
      }

      for (const dirent of dirents) {
        status.entries++;
        if(signal?.aborted||this.fullDevice()!==fullAccess)throw new DOMExceptionLike('La búsqueda fue cancelada.');
        if(status.entries>50000||queue.length>12000||Date.now()-started>10000){status.truncated=true;break search;}
        if(dirent.isSymbolicLink()){status.skippedLinks++;continue;}
        if (results.length >= limit) break;
        if (!fullAccess && dirent.name.startsWith('.')) continue;
        if (!fullAccess && dirent.isDirectory() && SKIP_DIRS.has(dirent.name)) continue;

        const full = path.join(next.dir, dirent.name);
        if (dirent.name.toLowerCase().includes(needle)) {
          try {
            const info = await fsp.stat(this.assertAllowed(full));
            results.push({
              name: dirent.name,
              path: full,
              kind: dirent.isDirectory() ? 'dir' : 'file',
              size: dirent.isDirectory() ? 0 : info.size,
              modifiedAt: info.mtimeMs,
              ext: dirent.isDirectory() ? '' : path.extname(dirent.name).replace('.', '').toLowerCase(),
            });
          } catch {
            // Unreadable match: skip it rather than reporting a broken row.
          }
        }
        if (dirent.isDirectory() && next.depth < maxDepth) {
          queue.push({ dir: full, depth: next.depth + 1 });
        } else if(dirent.isDirectory())status.truncated=true;
      }
    }

    // Exact-ish matches first, then most recently touched.
    status.truncated ||= queue.length>0||results.length>=limit;
    status.elapsedMs=Date.now()-started;
    return results.sort((a, b) => {
      const aExact = a.name.toLowerCase() === needle ? 0 : 1;
      const bExact = b.name.toLowerCase() === needle ? 0 : 1;
      if (aExact !== bExact) return aExact - bExact;
      return b.modifiedAt - a.modifiedAt;
    });
  }
}

/** Small stand-in so the service does not depend on DOM types. */
class DOMExceptionLike extends Error {
  readonly name = 'AbortError';
}

export const fileSystemService = new FileSystemService();
