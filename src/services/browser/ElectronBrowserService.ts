import type {
  Bookmark,
  BrowserActionResult,
  BrowserProfile,
  BrowserProfileId,
  BrowserService,
  BrowserSnapshot,
  BrowserTab,
  DomNode,
  DownloadItem,
  FoundElement,
  HistoryEntry,
  PermissionRecord,
  ViewportRect,
} from '@/types';

type Bridge = NonNullable<Window['jarvis']>['browser'];

/**
 * Real browsing. Every call is a message to the main process; nothing here
 * touches Electron directly, and the renderer never sees a WebContents.
 */
export class ElectronBrowserService implements BrowserService {
  constructor(private readonly bridge: Bridge) {}

  subscribe(listener: (snapshot: BrowserSnapshot) => void): () => void {
    return this.bridge.onState(listener);
  }

  snapshot(): Promise<BrowserSnapshot> {
    return this.bridge.snapshot();
  }

  async create(url: string, workspaceId: string, profileId?: BrowserProfileId): Promise<BrowserTab> {
    const snapshot = await this.bridge.create(url, workspaceId, profileId);
    const created = snapshot.tabs[snapshot.tabs.length - 1];
    if (!created) throw new Error('El proceso principal no devolvió la pestaña creada.');
    return created;
  }

  close(tabId: string): Promise<void> { return this.bridge.close(tabId); }
  activate(tabId: string): Promise<void> { return this.bridge.activate(tabId); }
  setPinned(tabId: string, pinned: boolean): Promise<void> { return this.bridge.setPinned(tabId, pinned); }
  setProfile(tabId: string, profileId: BrowserProfileId): Promise<void> { return this.bridge.setProfile(tabId, profileId); }

  navigate(tabId: string, input: string): Promise<void> { return this.bridge.navigate(tabId, input); }
  back(tabId: string): Promise<void> { return this.bridge.back(tabId); }
  forward(tabId: string): Promise<void> { return this.bridge.forward(tabId); }
  reload(tabId: string): Promise<void> { return this.bridge.reload(tabId); }
  stop(tabId: string): Promise<void> { return this.bridge.stop(tabId); }

  setBounds(rect: ViewportRect): Promise<void> { return this.bridge.setBounds(rect); }
  setVisible(visible: boolean): Promise<void> { return this.bridge.setVisible(visible); }

  profiles(): Promise<BrowserProfile[]> { return this.bridge.profiles(); }
  history(query?: string): Promise<HistoryEntry[]> { return this.bridge.history(query); }
  clearHistory(profileId?: BrowserProfileId): Promise<void> { return this.bridge.clearHistory(profileId); }
  bookmarks(): Promise<Bookmark[]> { return this.bridge.bookmarks(); }
  addBookmark(tabId: string, folder?: string): Promise<void> { return this.bridge.addBookmark(tabId, folder); }
  removeBookmark(id: string): Promise<void> { return this.bridge.removeBookmark(id); }
  downloads(): Promise<DownloadItem[]> { return this.bridge.downloads(); }
  onDownloads(listener: (items: DownloadItem[]) => void): () => void { return this.bridge.onDownloads(listener); }
  cancelDownload(id: string): Promise<void> { return this.bridge.cancelDownload(id); }
  permissions(): Promise<PermissionRecord[]> { return this.bridge.permissions(); }
  setPermission(origin: string, permission: string, allowed: boolean, profileId: BrowserProfileId): Promise<void> {
    return this.bridge.setPermission(origin, permission, allowed, profileId);
  }

  // Read-only inspection — safe today.
  pageText(tabId: string): Promise<string> { return this.bridge.pageText(tabId); }
  getPageText(tabId: string): Promise<string> { return this.bridge.pageText(tabId); }
  getDOMSnapshot(tabId: string, maxDepth?: number): Promise<DomNode> { return this.bridge.domSnapshot(tabId, maxDepth); }
  getScreenshot(tabId: string): Promise<string> { return this.bridge.screenshot(tabId); }

  // Acting on a page waits for the agent permission model.
  findElements(tabId: string, query: string): Promise<FoundElement[]> { return this.bridge.findElements(tabId, query); }
  clickElement(tabId: string, ref: string): Promise<BrowserActionResult> { return this.bridge.clickElement(tabId, ref); }
  typeIntoElement(tabId: string, ref: string, text: string): Promise<BrowserActionResult> {
    return this.bridge.typeIntoElement(tabId, ref, text);
  }
  executeBrowserAction(tabId: string, action: string, payload?: unknown): Promise<BrowserActionResult> {
    return this.bridge.executeBrowserAction(tabId, action, payload);
  }
}
