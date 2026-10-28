import { app, shell } from 'electron';
import type { BrowserWindow, DownloadItem as ElectronDownloadItem, Rectangle, Session, WebContents } from 'electron';
import path from 'node:path';
import type {
  Bookmark,
  BrowserProfileId,
  BrowserSnapshot,
  DownloadItem,
  HistoryEntry,
  PermissionRecord,
  ViewportRect,
} from '../../src/types/browser';
import { normalizeInput, originOf, titleFromUrl } from '../../src/services/browser/omnibox';
import { sanitizeDom, sanitizeText } from '../../src/machine/CredentialBoundary';
import { DEFAULT_PROFILE, eachLoadedSession, isProfileId, sessionFor } from './profiles';
import { JsonStore } from './JsonStore';
import { Tab } from './Tab';

const HISTORY_LIMIT = 5000;

let seq = 0;
const nextId = (prefix: string) => `${prefix}-${Date.now().toString(36)}-${(seq++).toString(36)}`;

export interface TabManagerBridge {
  allowNavigation?: (url: string) => Promise<boolean>;
  navigationAuthorized?: (url: string) => boolean;
  /** Push serialisable state to the shell renderer. */
  send(channel: string, payload: unknown): void;
}

/**
 * Owns every page in the app. The renderer sends commands and receives state;
 * it never touches a WebContents. Layout is inverted on purpose: React measures
 * the viewport and tells main where to paint, so the native surface always
 * lands exactly where the UI expects it.
 */
export class TabManager {
  private readonly tabs: Tab[] = [];
  private activeId: string | null = null;
  private bounds: Rectangle | null = null;
  private visible = false;
  private attached: Tab | null = null;
  private readonly preparedSessions = new Set<BrowserProfileId>();

  private readonly history = new JsonStore<HistoryEntry[]>('history.json', []);
  private readonly bookmarks = new JsonStore<Bookmark[]>('bookmarks.json', []);
  private readonly permissionStore = new JsonStore<PermissionRecord[]>('permissions.json', []);
  private readonly downloadList: DownloadItem[] = [];
  private readonly liveDownloads = new Map<string, ElectronDownloadItem>();

  constructor(
    private readonly win: BrowserWindow,
    private readonly bridge: TabManagerBridge,
  ) {}

  /* ================================================================ */
  /* State                                                            */
  /* ================================================================ */

  snapshot(): BrowserSnapshot {
    return { tabs: this.tabs.map((t) => t.toState()), activeId: this.activeId };
  }

  private publish(): void {
    if (this.win.isDestroyed()) return;
    this.bridge.send('state', this.snapshot());
  }

  private find(tabId: string): Tab | undefined {
    return this.tabs.find((t) => t.id === tabId);
  }

  private active(): Tab | null {
    return this.tabs.find((t) => t.id === this.activeId) ?? null;
  }

  /* ================================================================ */
  /* Lifecycle                                                        */
  /* ================================================================ */

  create(rawUrl: string, workspaceId: string, profileId?: string, options?: { background?: boolean }): BrowserSnapshot {
    const profile: BrowserProfileId = isProfileId(profileId) ? profileId : DEFAULT_PROFILE;
    this.prepareSession(profile);

    const target = rawUrl && rawUrl !== 'about:blank' ? normalizeInput(rawUrl).url : 'about:blank';
    const tab = new Tab({
      id: nextId('tab'),
      workspaceId,
      profileId: profile,
      url: target,
      allowNavigation: this.bridge.allowNavigation, navigationAuthorized: this.bridge.navigationAuthorized,
      events: {
        onChange: () => this.publish(),
        onNavigated: (t, url, title) => this.recordHistory(t, url, title),
        onOpenUrl: (url, fromProfile, background) => {
          this.create(url, workspaceId, fromProfile, { background });
        },
        onShortcut: (combo) => this.bridge.send('shortcut', combo),
      },
    });
    tab.title = titleFromUrl(target);

    this.tabs.push(tab);
    if (!options?.background || this.activeId === null) this.activeId = tab.id;
    this.syncLayout();
    this.publish();
    return this.snapshot();
  }

  close(tabId: string): void {
    const index = this.tabs.findIndex((t) => t.id === tabId);
    if (index === -1) return;
    const [tab] = this.tabs.splice(index, 1);
    if (!tab) return;
    if (this.attached === tab) {
      this.detach(tab);
    }
    tab.destroy();

    if (this.activeId === tabId) {
      const fallback = this.tabs[index] ?? this.tabs[index - 1] ?? this.tabs[0];
      this.activeId = fallback ? fallback.id : null;
    }
    this.syncLayout();
    this.publish();
  }

  activate(tabId: string): void {
    if (!this.find(tabId)) return;
    this.activeId = tabId;
    this.syncLayout();
    this.publish();
  }

  setPinned(tabId: string, pinned: boolean): void {
    const tab = this.find(tabId);
    if (!tab) return;
    tab.pinned = pinned;
    this.publish();
  }

  /**
   * A profile is baked into the session at creation, so switching profiles
   * means rebuilding the page in the other partition. The tab keeps its place.
   */
  setProfile(tabId: string, profileId: string): void {
    const tab = this.find(tabId);
    if (!tab || !isProfileId(profileId) || tab.profileId === profileId) return;
    const index = this.tabs.indexOf(tab);
    const url = tab.url;
    const workspaceId = tab.workspaceId;
    const pinned = tab.pinned;
    const wasActive = this.activeId === tab.id;

    this.prepareSession(profileId);
    if (this.attached === tab) this.detach(tab);
    this.tabs.splice(index, 1);
    tab.destroy();

    const replacement = new Tab({
      id: nextId('tab'),
      workspaceId,
      profileId,
      url,
      allowNavigation: this.bridge.allowNavigation, navigationAuthorized: this.bridge.navigationAuthorized,
      events: {
        onChange: () => this.publish(),
        onNavigated: (t, u, title) => this.recordHistory(t, u, title),
        onOpenUrl: (u, fromProfile, background) => { this.create(u, workspaceId, fromProfile, { background }); },
        onShortcut: (combo) => this.bridge.send('shortcut', combo),
      },
    });
    replacement.pinned = pinned;
    this.tabs.splice(index, 0, replacement);
    if (wasActive) this.activeId = replacement.id;
    this.syncLayout();
    this.publish();
  }

  closeAll(): void {
    while (this.tabs.length) {
      const tab = this.tabs.pop();
      tab?.destroy();
    }
    this.attached = null;
    this.activeId = null;
  }

  /* ================================================================ */
  /* Navigation                                                       */
  /* ================================================================ */

  navigate(tabId: string, input: string): void {
    const tab = this.find(tabId);
    if (!tab) return;
    const { url } = normalizeInput(input);
    void tab.load(url);
  }

  back(tabId: string): void { this.find(tabId)?.back(); }
  forward(tabId: string): void { this.find(tabId)?.forward(); }
  reload(tabId: string): void { this.find(tabId)?.reload(); }
  stop(tabId: string): void { this.find(tabId)?.stop(); }

  /* ================================================================ */
  /* Layout                                                           */
  /* ================================================================ */

  setBounds(rect: ViewportRect): void {
    this.bounds = {
      x: Math.round(rect.x),
      y: Math.round(rect.y),
      width: Math.max(0, Math.round(rect.width)),
      height: Math.max(0, Math.round(rect.height)),
    };
    this.syncLayout();
  }

  setVisible(visible: boolean): void {
    this.visible = visible;
    this.syncLayout();
  }

  /**
   * Only the active tab is ever in the view tree. Background tabs keep their
   * process but stop compositing, which is what makes ten open tabs cheap.
   */
  private syncLayout(): void {
    if (this.win.isDestroyed()) return;
    const active = this.active();
    const shouldShow = Boolean(active && this.visible && this.bounds && this.bounds.width > 0 && this.bounds.height > 0);

    if (this.attached && (!shouldShow || this.attached !== active)) {
      this.detach(this.attached);
    }
    if (!shouldShow || !active) return;

    if (this.attached !== active) this.attach(active);
    if (this.bounds) active.view.setBounds(this.bounds);
  }

  private attach(tab: Tab): void {
    this.win.contentView.addChildView(tab.view);
    this.attached = tab;
  }

  private detach(tab: Tab): void {
    try {
      this.win.contentView.removeChildView(tab.view);
    } catch {
      // Already gone — removing twice is not an error worth surfacing.
    }
    if (this.attached === tab) this.attached = null;
  }

  /* ================================================================ */
  /* Session wiring: downloads and permissions                        */
  /* ================================================================ */

  private prepareSession(profileId: BrowserProfileId): Session {
    const ses = sessionFor(profileId);
    if (this.preparedSessions.has(profileId)) return ses;
    this.preparedSessions.add(profileId);
    if (this.bridge.allowNavigation) {
      // Navigation requests only. XHR/fetch, providers, packages and subresources
      // remain untouched. This covers initial frames, redirects and POST while
      // retaining Chromium's method/body; no GET replay or top-frame replacement.
      ses.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*'] }, (details, callback) => {
        if (!['mainFrame', 'subFrame'].includes(details.resourceType)) { callback({}); return; }
        const mine = this.tabs.some(tab => tab.webContents.id === details.webContentsId && !tab.destroyed);
        if (!mine) { callback({ cancel: true }); return; }
        void this.bridge.allowNavigation!(details.url).then(allowed => callback({ cancel: !allowed }), () => callback({ cancel: true }));
      });
    }

    // Default-deny. A site only gets a capability after an explicit decision,
    // which today is recorded in permissions.json rather than prompted for.
    ses.setPermissionRequestHandler((wc: WebContents, permission: string, callback: (granted: boolean) => void) => {
      const origin = originOf(wc.getURL());
      const record = this.permissionStore.read().find(
        (p) => p.origin === origin && p.permission === permission && p.profileId === profileId,
      );
      callback(record?.allowed === true);
    });

    ses.setPermissionCheckHandler((_wc: WebContents | null, permission: string, requestingOrigin: string) => {
      const record = this.permissionStore.read().find(
        (p) => p.origin === requestingOrigin && p.permission === permission && p.profileId === profileId,
      );
      return record?.allowed === true;
    });

    ses.on('will-download', (_event: unknown, item: ElectronDownloadItem) => {
      const id = nextId('dl');
      const filename = item.getFilename();
      const savePath = path.join(app.getPath('downloads'), filename);
      item.setSavePath(savePath);

      const entry: DownloadItem = {
        id,
        filename,
        url: item.getURL(),
        savePath,
        bytes: item.getTotalBytes(),
        received: 0,
        state: 'in_progress',
        startedAt: Date.now(),
      };
      this.downloadList.unshift(entry);
      this.liveDownloads.set(id, item);
      this.publishDownloads();

      item.on('updated', (_e: unknown, state: string) => {
        entry.received = item.getReceivedBytes();
        entry.bytes = item.getTotalBytes();
        entry.state = state === 'interrupted' ? 'failed' : 'in_progress';
        this.publishDownloads();
      });

      item.once('done', (_e: unknown, state: string) => {
        entry.received = item.getReceivedBytes();
        entry.state = state === 'completed' ? 'completed' : state === 'cancelled' ? 'cancelled' : 'failed';
        this.liveDownloads.delete(id);
        this.publishDownloads();
      });
    });

    return ses;
  }

  private publishDownloads(): void {
    if (this.win.isDestroyed()) return;
    this.bridge.send('downloads', [...this.downloadList]);
  }

  downloads(): DownloadItem[] {
    return [...this.downloadList];
  }

  cancelDownload(id: string): void {
    this.liveDownloads.get(id)?.cancel();
  }

  revealDownload(id: string): void {
    const entry = this.downloadList.find((d) => d.id === id);
    if (entry && entry.state === 'completed') shell.showItemInFolder(entry.savePath);
  }

  permissions(): PermissionRecord[] {
    return this.permissionStore.read();
  }

  setPermission(origin: string, permission: string, allowed: boolean, profileId: string): void {
    const profile: BrowserProfileId = isProfileId(profileId) ? profileId : DEFAULT_PROFILE;
    const list = this.permissionStore.read().filter(
      (p) => !(p.origin === origin && p.permission === permission && p.profileId === profile),
    );
    list.push({ origin, permission, allowed, profileId: profile, decidedAt: Date.now() });
    this.permissionStore.write(list);
  }

  /* ================================================================ */
  /* History and bookmarks                                            */
  /* ================================================================ */

  private recordHistory(tab: Tab, url: string, title: string): void {
    if (!/^https?:/i.test(url)) return;
    const list = this.history.read();
    const last = list[0];
    if (last && last.url === url && Date.now() - last.visitedAt < 30_000) return;
    list.unshift({
      id: nextId('hist'),
      title: title || titleFromUrl(url),
      url,
      visitedAt: Date.now(),
      profileId: tab.profileId,
    });
    this.history.write(list.slice(0, HISTORY_LIMIT));
  }

  historyEntries(query?: string): HistoryEntry[] {
    const list = this.history.read();
    if (!query) return list.slice(0, 300);
    const needle = query.toLowerCase();
    return list
      .filter((h) => h.title.toLowerCase().includes(needle) || h.url.toLowerCase().includes(needle))
      .slice(0, 300);
  }

  clearHistory(profileId?: string): void {
    if (!profileId) {
      this.history.write([]);
      return;
    }
    this.history.write(this.history.read().filter((h) => h.profileId !== profileId));
  }

  bookmarkList(): Bookmark[] {
    return this.bookmarks.read();
  }

  addBookmark(tabId: string, folder = 'General'): void {
    const tab = this.find(tabId);
    if (!tab || !/^https?:/i.test(tab.url)) return;
    const list = this.bookmarks.read();
    if (list.some((b) => b.url === tab.url && b.profileId === tab.profileId)) return;
    list.unshift({
      id: nextId('bm'),
      title: tab.title || titleFromUrl(tab.url),
      url: tab.url,
      folder,
      profileId: tab.profileId,
      createdAt: Date.now(),
    });
    this.bookmarks.write(list);
  }

  removeBookmark(id: string): void {
    this.bookmarks.write(this.bookmarks.read().filter((b) => b.id !== id));
  }

  /* ================================================================ */
  /* Read-only page inspection                                        */
  /* ================================================================ */

  async pageText(tabId: string): Promise<string> {
    const tab = this.find(tabId);
    if (!tab) return '';
    const script = `(() => {
      const drop = ['script','style','noscript','svg','canvas'];
      drop.forEach(t => document.querySelectorAll(t).forEach(n => n.remove?.()));
      const main = document.querySelector('main, article, [role=main]') || document.body;
      return (main && main.innerText ? main.innerText : '').replace(/\\n{3,}/g, '\\n\\n').slice(0, 40000);
    })()`;
    try {
      const result: unknown = await tab.webContents.executeJavaScript(script, true);
      // The credential boundary applies on this side too: a secret must not
      // survive even as far as the IPC reply.
      return typeof result === 'string' ? sanitizeText(result) : '';
    } catch {
      return '';
    }
  }

  async domSnapshot(tabId: string, maxDepth = 4): Promise<unknown> {
    const tab = this.find(tabId);
    if (!tab) return null;
    const depth = Math.max(1, Math.min(8, maxDepth));
    const script = `(() => {
      const KEEP = ['id','href','type','name','aria-label','placeholder','role'];
      function walk(node, depth) {
        if (!node || node.nodeType !== 1 || depth < 0) return null;
        const attributes = {};
        for (const key of KEEP) {
          const value = node.getAttribute && node.getAttribute(key);
          if (value) attributes[key] = String(value).slice(0, 200);
        }
        const own = Array.from(node.childNodes)
          .filter(n => n.nodeType === 3)
          .map(n => n.textContent.trim())
          .join(' ')
          .slice(0, 200);
        return {
          tag: node.tagName.toLowerCase(),
          role: node.getAttribute ? node.getAttribute('role') || undefined : undefined,
          text: own || undefined,
          attributes: Object.keys(attributes).length ? attributes : undefined,
          children: depth > 0
            ? Array.from(node.children).slice(0, 40).map(c => walk(c, depth - 1)).filter(Boolean)
            : undefined,
        };
      }
      return walk(document.body, ${depth});
    })()`;
    try {
      return sanitizeDom(await tab.webContents.executeJavaScript(script, true));
    } catch {
      return null;
    }
  }

  async screenshot(tabId: string): Promise<string> {
    const tab = this.find(tabId);
    if (!tab) return '';
    try {
      const image = await tab.webContents.capturePage();
      return image.isEmpty() ? '' : image.toDataURL();
    } catch {
      return '';
    }
  }

  /* ================================================================ */
  /* Teardown                                                         */
  /* ================================================================ */

  dispose(): void {
    this.history.flush();
    this.bookmarks.flush();
    this.permissionStore.flush();
    eachLoadedSession((_id, ses) => ses.removeAllListeners('will-download'));
    this.closeAll();
  }
}
