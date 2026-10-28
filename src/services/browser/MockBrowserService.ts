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
import { mockBookmarks, mockDownloads, mockHistory, mockProfiles } from '@/mocks/browser';
import { normalizeInput, titleFromUrl } from './omnibox';
import { uid } from '@/lib/id';

export { normalizeInput, titleFromUrl, searchUrl } from './omnibox';

/**
 * Used when the renderer runs outside the Electron shell — `vite dev` in a
 * plain browser, or any environment without the bridge. Same interface, no
 * engine: the browser module degrades to a readable placeholder instead of
 * crashing, and every other module keeps working.
 */
export class MockBrowserService implements BrowserService {
  private tabs: BrowserTab[] = [];
  private activeId: string | null = null;
  private listeners = new Set<(s: BrowserSnapshot) => void>();
  private downloadListeners = new Set<(items: DownloadItem[]) => void>();

  private emit(): void {
    const snapshot = this.snapshotSync();
    this.listeners.forEach((l) => l(snapshot));
  }

  private snapshotSync(): BrowserSnapshot {
    return { tabs: this.tabs.map((t) => ({ ...t })), activeId: this.activeId };
  }

  private find(id: string): BrowserTab | undefined {
    return this.tabs.find((t) => t.id === id);
  }

  subscribe(listener: (snapshot: BrowserSnapshot) => void): () => void {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  async snapshot(): Promise<BrowserSnapshot> { return this.snapshotSync(); }

  async create(url: string, workspaceId: string, profileId: BrowserProfileId = 'personal'): Promise<BrowserTab> {
    const target = url && url !== 'about:blank' ? normalizeInput(url).url : 'about:blank';
    const tab: BrowserTab = {
      id: uid('tab'),
      workspaceId,
      profileId,
      url: target,
      title: titleFromUrl(target),
      loading: target !== 'about:blank',
      pinned: false,
      canGoBack: false,
      canGoForward: false,
      error: null,
    };
    this.tabs.push(tab);
    this.activeId = tab.id;
    this.emit();
    if (tab.loading) window.setTimeout(() => this.settle(tab.id), 600);
    return { ...tab };
  }

  private settle(id: string): void {
    const tab = this.find(id);
    if (!tab) return;
    tab.loading = false;
    this.emit();
  }

  async close(tabId: string): Promise<void> {
    const index = this.tabs.findIndex((t) => t.id === tabId);
    if (index === -1) return;
    this.tabs.splice(index, 1);
    if (this.activeId === tabId) {
      const fallback = this.tabs[index] ?? this.tabs[index - 1] ?? this.tabs[0];
      this.activeId = fallback ? fallback.id : null;
    }
    this.emit();
  }

  async activate(tabId: string): Promise<void> {
    if (!this.find(tabId)) return;
    this.activeId = tabId;
    this.emit();
  }

  async setPinned(tabId: string, pinned: boolean): Promise<void> {
    const tab = this.find(tabId);
    if (!tab) return;
    tab.pinned = pinned;
    this.emit();
  }

  async setProfile(tabId: string, profileId: BrowserProfileId): Promise<void> {
    const tab = this.find(tabId);
    if (!tab) return;
    tab.profileId = profileId;
    this.emit();
  }

  async navigate(tabId: string, input: string): Promise<void> {
    const tab = this.find(tabId);
    if (!tab) return;
    const { url } = normalizeInput(input);
    tab.url = url;
    tab.title = titleFromUrl(url);
    tab.loading = true;
    tab.canGoBack = true;
    tab.error = null;
    this.emit();
    window.setTimeout(() => this.settle(tabId), 600);
  }

  async back(tabId: string): Promise<void> {
    const tab = this.find(tabId);
    if (!tab) return;
    tab.canGoForward = true;
    tab.canGoBack = false;
    this.emit();
  }

  async forward(tabId: string): Promise<void> {
    const tab = this.find(tabId);
    if (!tab) return;
    tab.canGoBack = true;
    tab.canGoForward = false;
    this.emit();
  }

  async reload(tabId: string): Promise<void> {
    const tab = this.find(tabId);
    if (!tab) return;
    tab.loading = true;
    this.emit();
    window.setTimeout(() => this.settle(tabId), 500);
  }

  async stop(tabId: string): Promise<void> { this.settle(tabId); }

  async setBounds(_rect: ViewportRect): Promise<void> { /* no surface to place */ }
  async setVisible(_visible: boolean): Promise<void> { /* nothing to show */ }

  async profiles(): Promise<BrowserProfile[]> { return mockProfiles; }
  async history(query?: string): Promise<HistoryEntry[]> {
    if (!query) return mockHistory;
    const needle = query.toLowerCase();
    return mockHistory.filter((h) => h.title.toLowerCase().includes(needle) || h.url.toLowerCase().includes(needle));
  }
  async clearHistory(): Promise<void> { /* mock data is read-only */ }
  async bookmarks(): Promise<Bookmark[]> { return mockBookmarks; }
  async addBookmark(): Promise<void> { /* mock data is read-only */ }
  async removeBookmark(): Promise<void> { /* mock data is read-only */ }
  async downloads(): Promise<DownloadItem[]> { return mockDownloads; }
  onDownloads(listener: (items: DownloadItem[]) => void): () => void {
    this.downloadListeners.add(listener);
    return () => { this.downloadListeners.delete(listener); };
  }
  async cancelDownload(): Promise<void> { /* nothing is actually downloading */ }
  async permissions(): Promise<PermissionRecord[]> { return []; }
  async setPermission(): Promise<void> { /* nothing to decide without a page */ }

  async getPageText(tabId: string): Promise<string> {
    const tab = this.find(tabId);
    return tab ? `Contenido simulado de ${tab.url}` : '';
  }
  async getDOMSnapshot(): Promise<DomNode> { return { tag: 'body', children: [] }; }
  async getScreenshot(): Promise<string> { return ''; }
  async findElements(): Promise<FoundElement[]> { return []; }
  async clickElement(): Promise<BrowserActionResult> { return { ok: false, detail: 'Sin motor de navegación.' }; }
  async typeIntoElement(): Promise<BrowserActionResult> { return { ok: false, detail: 'Sin motor de navegación.' }; }
  async executeBrowserAction(): Promise<BrowserActionResult> { return { ok: false, detail: 'Sin motor de navegación.' }; }
}
