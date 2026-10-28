import { app, dialog, ipcMain, Menu } from 'electron';
import type { BrowserWindow, IpcMainInvokeEvent } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { AuthorityState, matchesLink, navigationUrl, originalLinkScopes, internalNavigation } from '../src/authority/AuthorityState';
import type { AccessMode, LinkScope } from '../src/authority/AuthorityState';

export const authority = new AuthorityState();
let owner: BrowserWindow | null = null;
let activeRun = '';
let policyFile = '';
const captures: Array<{ text: string; at: number; action: boolean }> = [];
let navigationScopes: LinkScope[] = [];
const pendingLinks = new Map<string, Promise<boolean>>();
const stopListeners = new Set<(runId: string) => Promise<unknown> | unknown>();
let stopFailure: string | null = null;
export function onAuthorityStop(listener: (runId: string) => Promise<unknown> | unknown): () => void {
  stopListeners.add(listener); return () => { stopListeners.delete(listener); };
}
export async function stopAuthorityRuns(): Promise<void> {
  const ids = authority.liveRunIds();
  ids.forEach(id => authority.stop(id)); publish();
  await notifyStopped(ids);
}
async function notifyStopped(ids: string[]): Promise<void> {
  // Invoke synchronously: abort flags must change before another IPC is admitted.
  const work = ids.flatMap(id => [...stopListeners].map(listener => {
    try { return Promise.resolve(listener(id)); } catch (e) { return Promise.reject(e); }
  }));
  const results = await Promise.allSettled(work);
  stopFailure = results.some(result => result.status === 'rejected') ? 'AUTHORITY_STOP_INCOMPLETE' : null;
  publish();
  if (stopFailure) throw new Error(stopFailure);
}
export function assertAuthoritySender(event: IpcMainInvokeEvent): void {
  if (!owner || event.sender !== owner.webContents || event.senderFrame !== owner.webContents.mainFrame) throw new Error('UNTRUSTED_AUTHORITY_SENDER');
}
export function effectivePermission(): AccessMode { return authority.accessMode(); }
export function authorityHandle(channel: string, listener: Parameters<typeof ipcMain.handle>[1]): void {
  ipcMain.handle(channel, (event, ...args) => { assertAuthoritySender(event); return listener(event, ...args); });
}
export function authorityActiveRun(): string { return activeRun; }
export function authoritySnapshot() { return { accessMode: authority.accessMode(), activeRun, run: authority.run(activeRun), revision: authority.revision(), stopFailure }; }
function publish() { owner?.webContents.send('authority:changed', authoritySnapshot()); }
function menu(): Menu {
  return Menu.buildFromTemplate([{ label: 'Autoridad de JARVIS', submenu: (['FULL', 'RESTRICTED'] as const).map(mode => ({
    id: `access-${mode}`, label: mode, type: 'radio' as const, checked: authority.accessMode() === mode,
    click: () => {
      fs.mkdirSync(path.dirname(policyFile), { recursive: true });
      fs.writeFileSync(`${policyFile}.tmp`, JSON.stringify({ version: 2, accessMode: mode }));
      fs.renameSync(`${policyFile}.tmp`, policyFile);
      const ids = authority.accessMode() === mode ? [] : authority.liveRunIds();
      authority.userSetMode(mode);
      if (ids.length) { captures.length = 0; navigationScopes = []; }
      publish(); Menu.setApplicationMenu(menu()); void notifyStopped(ids).catch(() => { /* Failure is published; admission stays revoked. */ });
    },
  })) }]);
}
export function registerAuthority(win: BrowserWindow): void {
  owner = win; policyFile = path.join(app.getPath('userData'), 'authority', 'policy.json');
  if (fs.existsSync(policyFile)) {
    try { const stored = JSON.parse(fs.readFileSync(policyFile, 'utf8')); authority.userSetMode(stored.accessMode === 'FULL' ? 'FULL' : 'RESTRICTED'); }
    catch { authority.userSetMode('RESTRICTED'); }
  }
  Menu.setApplicationMenu(menu());
  ipcMain.on('authority:capture-original', (event, text: unknown, navigation: unknown) => {
    try { assertAuthoritySender(event as IpcMainInvokeEvent); } catch { return; }
    if (typeof text !== 'string' || text.length > 100000 || !text.trim()) return;
    // This channel is private to the isolated preload, not exposed in window.jarvis.
    if (navigation === true) { navigationScopes = originalLinkScopes(text); return; }
    // One-use most recent gesture only; a previous action cannot substitute a
    // newly typed Strong/original link instruction.
    captures.length = 0;
    captures.push({ text: text.trim(), at: Date.now(), action: navigation === 'ACTION' });
  });
  ipcMain.handle('authority:snapshot', event => { assertAuthoritySender(event); return authoritySnapshot(); });
  ipcMain.handle('authority:choose', event => { assertAuthoritySender(event); menu().popup({ window: win }); return true; });
  ipcMain.handle('authority:begin', (event, id: unknown, text: unknown) => {
    assertAuthoritySender(event);
    if (typeof id !== 'string' || typeof text !== 'string') throw new Error('INVALID_ORIGINAL_INPUT');
    // Typed originals must match exactly. Fixed UI actions can create a task,
    // but never authorize discovered links or impose/remove typed Strong.
    const index = captures.findIndex(c => (c.action || c.text === text.trim()) && Date.now() - c.at < 30000);
    if (index < 0) throw new Error('ORIGINAL_INPUT_GESTURE_REQUIRED');
    const capture = captures.splice(index, 1)[0]!;
    authority.admit(id, createHash('sha256').update(capture.text).digest('hex'), capture.text, capture.action ? 'USER_UI_GESTURE' : 'USER_INPUT_GESTURE');
    activeRun = id; publish(); return authoritySnapshot();
  });
  ipcMain.handle('authority:stop', async event => { assertAuthoritySender(event); await stopAuthorityRuns(); return activeRun; });
}
export function unregisterAuthority(): void {
  ['authority:snapshot', 'authority:choose', 'authority:begin', 'authority:stop'].forEach(c => ipcMain.removeHandler(c));
  ipcMain.removeAllListeners('authority:capture-original'); stopListeners.clear(); owner = null; activeRun = ''; captures.length = 0; navigationScopes = [];
}
/** Navigation only: no session-wide request interception and no egress firewall. */
export function navigationAuthorized(raw: string, runId = activeRun): boolean {
  if (raw === 'about:blank') return true;
  const url = navigationUrl(raw);
  const run = authority.run(runId);
  return !!url && (internalNavigation(url) || matchesLink(run?.stopped ? [] : run?.links ?? [], url) || matchesLink(navigationScopes, url));
}
export async function allowNavigation(raw: string, runId = activeRun): Promise<boolean> {
  if (raw === 'about:blank') return true;
  const url = navigationUrl(raw);
  if (!url || !owner) return false;
  if (navigationAuthorized(url, runId)) return true;
  const key = `${runId}:${url}`;
  const revision = authority.revision();
  if (pendingLinks.has(key)) return pendingLinks.get(key)!;
  const request = (async () => {
    const result = await dialog.showMessageBox(owner!, { type: 'question', title: 'Navegación externa',
      message: 'Este destino no está autorizado en tu entrada original.', detail: url, buttons: ['Cancelar', 'Abrir'], defaultId: 0, cancelId: 0 });
    if (result.response !== 1 || authority.revision() !== revision || authority.run(runId)?.stopped) return false;
    if (runId) authority.grantLink(runId, url); else navigationScopes.push({ kind: 'URL', value: url });
    return true;
  })();
  pendingLinks.set(key, request);
  try { return await request; } finally { pendingLinks.delete(key); }
}
