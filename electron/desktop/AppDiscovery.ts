import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import type { DiscoveredApp } from '../../src/types';
import type { InstalledApp } from '../agent/ApplicationService';
import { stableId } from '../../src/desktop/appIds';

export { slug, stableId } from '../../src/desktop/appIds';

/** Fixed, well-known install locations. Probed with existsSync, never scanned. */
function knownLocations(): { id: string; name: string; target: string }[] {
  const pf = process.env.ProgramFiles ?? 'C:\\Program Files';
  const pf86 = process.env['ProgramFiles(x86)'] ?? 'C:\\Program Files (x86)';
  const local = process.env.LOCALAPPDATA ?? '';
  const win = process.env.WINDIR ?? 'C:\\Windows';
  return [
    { id: 'app:vscode', name: 'Visual Studio Code', target: path.join(local, 'Programs', 'Microsoft VS Code', 'Code.exe') },
    { id: 'app:vscode', name: 'Visual Studio Code', target: path.join(pf, 'Microsoft VS Code', 'Code.exe') },
    { id: 'app:chrome', name: 'Google Chrome', target: path.join(pf, 'Google', 'Chrome', 'Application', 'chrome.exe') },
    { id: 'app:edge', name: 'Microsoft Edge', target: path.join(pf86, 'Microsoft', 'Edge', 'Application', 'msedge.exe') },
    { id: 'app:blender', name: 'Blender', target: path.join(pf, 'Blender Foundation', 'Blender', 'blender.exe') },
    { id: 'app:notepad', name: 'Bloc de notas', target: path.join(win, 'System32', 'notepad.exe') },
  ];
}

/**
 * Registered applications from the App Paths key. A fixed `reg.exe` query with
 * constant arguments — nothing interpolated, run without a shell.
 */
function registryApps(): Promise<{ name: string; target: string }[]> {
  if (process.platform !== 'win32') return Promise.resolve([]);
  return new Promise((resolve) => {
    execFile('reg.exe', ['query', 'HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\App Paths', '/s', '/ve'],
      { timeout: 5000, windowsHide: true, maxBuffer: 2 * 1024 * 1024 },
      (error, stdout) => {
        if (error || !stdout) { resolve([]); return; }
        const out: { name: string; target: string }[] = [];
        let key = '';
        for (const line of stdout.split(/\r?\n/)) {
          if (line.startsWith('HKEY_')) { key = line.split('\\').pop() ?? ''; continue; }
          const m = line.match(/REG_(?:EXPAND_)?SZ\s+(.+\.exe)"?\s*$/i);
          if (m?.[1] && key) out.push({ name: key.replace(/\.exe$/i, ''), target: m[1].replace(/^"/, '') });
        }
        resolve(out.slice(0, 400));
      });
  });
}

/**
 * Merges Start Menu shortcuts, the registry and known locations into one list
 * keyed by stable id. The launch target stays in main; the renderer and the
 * model only ever see id and name.
 */
export async function discoverApps(startMenu: InstalledApp[]): Promise<DiscoveredApp[]> {
  const byId = new Map<string, DiscoveredApp>();
  const add = (app: DiscoveredApp) => { if (!byId.has(app.id)) byId.set(app.id, app); };

  for (const entry of startMenu) {
    add({
      id: stableId(entry.name), name: entry.name,
      source: entry.source === 'desktop' ? 'desktop' : 'start-menu',
      launchTarget: entry.path, requiresElevation: false,
    });
  }
  for (const loc of knownLocations()) {
    if (fs.existsSync(loc.target)) add({ id: loc.id, name: loc.name, source: 'known-location', launchTarget: loc.target, requiresElevation: false });
  }
  for (const reg of await registryApps()) {
    if (fs.existsSync(reg.target)) add({ id: stableId(reg.name), name: reg.name, source: 'registry', launchTarget: reg.target, requiresElevation: false });
  }
  return [...byId.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/** What crosses to the renderer: never the path. */
export function publicApp(app: DiscoveredApp): Omit<DiscoveredApp, 'launchTarget'> & { launchTarget: '' } {
  return { ...app, launchTarget: '' };
}
