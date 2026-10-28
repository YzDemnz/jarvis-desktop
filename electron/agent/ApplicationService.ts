import { app } from 'electron';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

export interface InstalledApp {
  id: string;
  name: string;
  /** Where the shortcut or executable lives. Never executed at this stage. */
  path: string;
  source: 'start-menu' | 'desktop' | 'applications' | 'path';
}

const SHORTCUT_EXT = new Set(['.lnk', '.url', '.appref-ms']);
const MAC_EXT = new Set(['.app']);
const MAX_DEPTH = 3;
const MAX_APPS = 600;

/**
 * Read-only discovery of what is installed. It enumerates shortcut locations
 * and nothing more: there is no launch here, and no execution of anything it
 * finds. `launch()` arrives later, behind ASSIST plus approval.
 */
export class ApplicationService {
  private cache: InstalledApp[] | null = null;
  private cachedAt = 0;

  private roots(): { dir: string; source: InstalledApp['source'] }[] {
    const home = os.homedir();
    const out: { dir: string; source: InstalledApp['source'] }[] = [];
    const push = (dir: string | undefined, source: InstalledApp['source']) => {
      if (dir && fs.existsSync(dir)) out.push({ dir, source });
    };

    if (process.platform === 'win32') {
      const appData = process.env.APPDATA ?? path.join(home, 'AppData', 'Roaming');
      const programData = process.env.ProgramData ?? 'C:\\ProgramData';
      push(path.join(appData, 'Microsoft', 'Windows', 'Start Menu', 'Programs'), 'start-menu');
      push(path.join(programData, 'Microsoft', 'Windows', 'Start Menu', 'Programs'), 'start-menu');
    } else if (process.platform === 'darwin') {
      push('/Applications', 'applications');
      push(path.join(home, 'Applications'), 'applications');
    } else {
      push('/usr/share/applications', 'applications');
      push(path.join(home, '.local', 'share', 'applications'), 'applications');
    }

    try {
      push(app.getPath('desktop'), 'desktop');
    } catch {
      push(path.join(home, 'Desktop'), 'desktop');
    }
    return out;
  }

  /** Cached for a minute: walking the Start Menu on every keystroke is waste. */
  async list(force = false): Promise<InstalledApp[]> {
    if (!force && this.cache && Date.now() - this.cachedAt < 60_000) return this.cache;

    const found = new Map<string, InstalledApp>();
    for (const { dir, source } of this.roots()) {
      await this.walk(dir, source, 0, found);
      if (found.size >= MAX_APPS) break;
    }

    const list = [...found.values()].sort((a, b) => a.name.localeCompare(b.name));
    this.cache = list;
    this.cachedAt = Date.now();
    return list;
  }

  private async walk(
    dir: string,
    source: InstalledApp['source'],
    depth: number,
    found: Map<string, InstalledApp>,
  ): Promise<void> {
    if (depth > MAX_DEPTH || found.size >= MAX_APPS) return;
    let dirents;
    try {
      dirents = await fsp.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const dirent of dirents) {
      if (found.size >= MAX_APPS) return;
      const full = path.join(dir, dirent.name);
      const ext = path.extname(dirent.name).toLowerCase();

      if (dirent.isDirectory()) {
        if (MAC_EXT.has(ext)) {
          this.add(found, dirent.name.replace(/\.app$/i, ''), full, source);
          continue;
        }
        await this.walk(full, source, depth + 1, found);
        continue;
      }

      if (SHORTCUT_EXT.has(ext)) {
        this.add(found, path.basename(dirent.name, ext), full, source);
      } else if (ext === '.desktop') {
        this.add(found, await this.desktopEntryName(full) ?? path.basename(dirent.name, ext), full, source);
      }
    }
  }

  private async desktopEntryName(file: string): Promise<string | null> {
    try {
      const raw = await fsp.readFile(file, 'utf8');
      const match = raw.match(/^Name=(.+)$/m);
      return match?.[1]?.trim() ?? null;
    } catch {
      return null;
    }
  }

  private add(found: Map<string, InstalledApp>, name: string, full: string, source: InstalledApp['source']): void {
    const clean = name.trim();
    if (!clean) return;
    const id = clean.toLowerCase();
    if (found.has(id)) return;
    found.set(id, { id, name: clean, path: full, source });
  }

  /** Fuzzy-ish match: every query word must appear somewhere in the name. */
  async search(query: string, limit = 12): Promise<InstalledApp[]> {
    const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
    const all = await this.list();
    if (!words.length) return all.slice(0, limit);

    return all
      .map((entry) => {
        const name = entry.name.toLowerCase();
        if (!words.every((w) => name.includes(w))) return null;
        const score = name.startsWith(words[0]!) ? 0 : name.includes(words.join(' ')) ? 1 : 2;
        return { entry, score };
      })
      .filter((x): x is { entry: InstalledApp; score: number } => x !== null)
      .sort((a, b) => a.score - b.score || a.entry.name.length - b.entry.name.length)
      .slice(0, limit)
      .map((x) => x.entry);
  }
}

export const applicationService = new ApplicationService();
