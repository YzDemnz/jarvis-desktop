import { ipcMain, Menu } from 'electron';
import type { BrowserWindow } from 'electron';
import { IPC } from '../ipc';
import { PROFILES } from './profiles';
import { TabManager } from './TabManager';

/** Anything the renderer sends is untrusted input; validate before using it. */
import { authorityHandle, allowNavigation, navigationAuthorized } from '../authority';

const str = (value: unknown, fallback = ''): string => (typeof value === 'string' ? value : fallback);
const bool = (value: unknown): boolean => value === true;
const num = (value: unknown): number => (typeof value === 'number' && Number.isFinite(value) ? value : 0);

const NOT_IMPLEMENTED = {
  ok: false,
  detail: 'Requiere la capa de permisos del agente (CONTROL). Aún no implementado.',
};

export function registerBrowserIpc(win: BrowserWindow): TabManager {
  const manager = new TabManager(win, {
    allowNavigation, navigationAuthorized,
    send: (channel, payload) => {
      if (win.isDestroyed()) return;
      if (channel === 'state') win.webContents.send(IPC.browser.stateChanged, payload);
      else if (channel === 'downloads') win.webContents.send(IPC.browser.downloadsChanged, payload);
      else if (channel === 'shortcut') win.webContents.send(IPC.hotkeys.forwarded, payload);
    },
  });

  const B = IPC.browser;

  // ---- lifecycle
  authorityHandle(B.create, (_e, url: unknown, workspaceId: unknown, profileId: unknown) =>
    manager.create(str(url, 'about:blank'), str(workspaceId, 'default'), str(profileId) || undefined));
  authorityHandle(B.close, (_e, tabId: unknown) => { manager.close(str(tabId)); });
  authorityHandle(B.activate, (_e, tabId: unknown) => { manager.activate(str(tabId)); });
  authorityHandle(B.setPinned, (_e, tabId: unknown, pinned: unknown) => { manager.setPinned(str(tabId), bool(pinned)); });
  authorityHandle(B.setProfile, (_e, tabId: unknown, profileId: unknown) => { manager.setProfile(str(tabId), str(profileId)); });

  // ---- navigation
  authorityHandle(B.navigate, (_e, tabId: unknown, input: unknown) => { manager.navigate(str(tabId), str(input)); });
  authorityHandle(B.back, (_e, tabId: unknown) => { manager.back(str(tabId)); });
  authorityHandle(B.forward, (_e, tabId: unknown) => { manager.forward(str(tabId)); });
  authorityHandle(B.reload, (_e, tabId: unknown) => { manager.reload(str(tabId)); });
  authorityHandle(B.stop, (_e, tabId: unknown) => { manager.stop(str(tabId)); });

  // ---- layout
  authorityHandle(B.setBounds, (_e, rect: unknown) => {
    const r = (rect ?? {}) as Record<string, unknown>;
    manager.setBounds({ x: num(r.x), y: num(r.y), width: num(r.width), height: num(r.height) });
  });
  authorityHandle(B.setVisible, (_e, visible: unknown) => { manager.setVisible(bool(visible)); });

  // ---- state and data
  authorityHandle(B.snapshot, () => manager.snapshot());
  authorityHandle(B.profiles, () => PROFILES.map(({ id, label, accent, description }) => ({ id, label, accent, description })));
  authorityHandle(B.history, (_e, query: unknown) => manager.historyEntries(str(query) || undefined));
  authorityHandle(B.clearHistory, (_e, profileId: unknown) => { manager.clearHistory(str(profileId) || undefined); });
  authorityHandle(B.bookmarks, () => manager.bookmarkList());
  authorityHandle(B.addBookmark, (_e, tabId: unknown, folder: unknown) => { manager.addBookmark(str(tabId), str(folder) || undefined); });
  authorityHandle(B.removeBookmark, (_e, id: unknown) => { manager.removeBookmark(str(id)); });
  authorityHandle(B.downloads, () => manager.downloads());
  authorityHandle(B.cancelDownload, (_e, id: unknown) => { manager.cancelDownload(str(id)); });
  authorityHandle(B.permissions, () => manager.permissions());
  authorityHandle(B.setPermission, (_e, origin: unknown, permission: unknown, _allowed: unknown, profileId: unknown) => {
    // Renderer requests to show the control; only a native user choice edits
    // browser policy. Passing `allowed=true` is not an authority grant.
    const url = new URL(str(origin));
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) throw Error('INVALID_PERMISSION_ORIGIN');
    const name = str(permission), profile = str(profileId);
    if (!['media', 'geolocation', 'notifications', 'clipboard-read', 'clipboard-sanitized-write', 'fullscreen', 'pointerLock', 'midi', 'midiSysex'].includes(name)) throw Error('UNKNOWN_BROWSER_PERMISSION');
    Menu.buildFromTemplate([{ label: `${url.origin}: ${name}`, enabled: false },
      { label: 'Permitir', click: () => manager.setPermission(url.origin, name, true, profile) },
      { label: 'Denegar', click: () => manager.setPermission(url.origin, name, false, profile) }]).popup({ window: win });
    return { changed: false, nativeChoiceRequired: true };
  });

  // ---- read-only inspection
  authorityHandle(B.pageText, (_e, tabId: unknown) => manager.pageText(str(tabId)));
  authorityHandle(B.domSnapshot, (_e, tabId: unknown, depth: unknown) => manager.domSnapshot(str(tabId), num(depth) || 4));
  authorityHandle(B.screenshot, (_e, tabId: unknown) => manager.screenshot(str(tabId)));

  // ---- declared but refused on purpose: acting on a page needs the agent
  //      permission model, which is not part of this stage.
  authorityHandle(B.findElements, () => []);
  authorityHandle(B.clickElement, () => NOT_IMPLEMENTED);
  authorityHandle(B.typeIntoElement, () => NOT_IMPLEMENTED);
  authorityHandle(B.executeAction, () => NOT_IMPLEMENTED);

  return manager;
}

export function unregisterBrowserIpc(): void {
  Object.values(IPC.browser).forEach((channel) => {
    try {
      ipcMain.removeHandler(channel);
    } catch {
      // Channels that were never registered are fine to skip.
    }
  });
}
