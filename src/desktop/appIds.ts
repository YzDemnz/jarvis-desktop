/**
 * Stable ids for well-known apps, shared by discovery (main) and the planner
 * (renderer) so "abre VS Code" and the Start Menu shortcut resolve to the same
 * "app:vscode" without the model ever handling a path.
 */
/**
 * `processNames` is how a window is found after launch. Process names are
 * stable; titles are not ("Bienvenida - Visual Studio Code", "● app.ts — x").
 */
export const KNOWN_APPS: { id: string; match: RegExp; aliases: string[]; processNames: string[] }[] = [
  { id: 'app:vscode', match: /^visual studio code$|^code$|vs ?code/i, aliases: ['vscode', 'vs code', 'visual studio code', 'code'], processNames: ['code.exe'] },
  { id: 'app:chrome', match: /^google chrome$|^chrome$/i, aliases: ['chrome', 'google chrome'], processNames: ['chrome.exe'] },
  { id: 'app:edge', match: /^microsoft edge$/i, aliases: ['edge', 'microsoft edge'], processNames: ['msedge.exe'] },
  { id: 'app:firefox', match: /^(mozilla )?firefox$/i, aliases: ['firefox'], processNames: ['firefox.exe'] },
  { id: 'app:blender', match: /^blender/i, aliases: ['blender'], processNames: ['blender.exe'] },
  { id: 'app:notepad', match: /^(notepad|bloc de notas)$/i, aliases: ['notepad', 'bloc de notas'], processNames: ['notepad.exe'] },
  { id: 'app:explorer', match: /^(file explorer|explorador de archivos)$/i, aliases: ['explorador', 'explorer', 'explorador de archivos'], processNames: ['explorer.exe'] },
  { id: 'app:terminal', match: /^(windows )?terminal$/i, aliases: ['terminal'], processNames: ['windowsterminal.exe'] },
  { id: 'app:obsidian', match: /^obsidian$/i, aliases: ['obsidian'], processNames: ['obsidian.exe'] },
  { id: 'app:steam', match: /^steam$/i, aliases: ['steam'], processNames: ['steam.exe', 'steamwebhelper.exe'] },
  { id: 'app:spotify', match: /^spotify$/i, aliases: ['spotify'], processNames: ['spotify.exe'] },
];

export function slug(name: string): string {
  return name.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48) || 'app';
}

export function stableId(name: string): string {
  const known = KNOWN_APPS.find((k) => k.match.test(name.trim()));
  return known ? known.id : `app:${slug(name)}`;
}

/** Finds a known app mentioned anywhere in a sentence. */
export function appIdFromText(text: string): { id: string; name: string } | null {
  const t = ` ${text.toLowerCase()} `;
  // Whole words only: "decoder" is not VS Code, "explorers" is not Explorer.
  const has = (alias: string) => new RegExp(`[^a-z0-9áéíóúñ]${alias.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[^a-z0-9áéíóúñ]`).test(t);
  for (const app of KNOWN_APPS) {
    const alias = [...app.aliases].sort((a, b) => b.length - a.length).find(has);
    if (alias) return { id: app.id, name: alias };
  }
  return null;
}

/** Process names that belong to a known app id, lowercased. Empty if unknown. */
export function processNamesFor(appId: string): string[] {
  return KNOWN_APPS.find((a) => a.id === appId)?.processNames ?? [];
}
