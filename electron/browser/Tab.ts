import { WebContentsView } from 'electron';
import type { WebContents } from 'electron';
import type { BrowserProfileId, BrowserTab } from '../../src/types/browser';
import { sessionFor } from './profiles';
import { safeExternalUrl } from '../security';

export interface TabEvents {
  /** Any change worth mirroring in the renderer. */
  onChange(): void;
  /** A committed main-frame navigation, for the history log. */
  onNavigated(tab: Tab, url: string, title: string): void;
  /** The page asked for a new window; we turn it into a tab instead. */
  onOpenUrl(url: string, profileId: BrowserProfileId, background: boolean): void;
  /** A shell shortcut typed while the page had focus. */
  onShortcut(combo: string): void;
}

export interface TabInit {
  id: string;
  workspaceId: string;
  profileId: BrowserProfileId;
  url: string;
  events: TabEvents;
  allowNavigation?: (url: string) => Promise<boolean>;
  navigationAuthorized?: (url: string) => boolean;
}

/** Combos the shell owns even while a page has keyboard focus. */
const FORWARDED_COMBOS = new Set([
  'ctrl+l', 'ctrl+t', 'ctrl+w', 'ctrl+tab', 'ctrl+shift+tab',
  'ctrl+shift+j', 'ctrl+shift+f', 'ctrl+shift+m', 'ctrl+shift+a', 'ctrl+shift+t',
  'alt+space', 'escape',
]);

/** Electron 30+ moved these onto navigationHistory; keep both paths working. */
function canGoBack(wc: WebContents): boolean {
  const nav = (wc as Partial<WebContents>).navigationHistory;
  if (nav && typeof nav.canGoBack === 'function') return nav.canGoBack();
  return typeof wc.canGoBack === 'function' ? wc.canGoBack() : false;
}

function canGoForward(wc: WebContents): boolean {
  const nav = (wc as Partial<WebContents>).navigationHistory;
  if (nav && typeof nav.canGoForward === 'function') return nav.canGoForward();
  return typeof wc.canGoForward === 'function' ? wc.canGoForward() : false;
}

function goBack(wc: WebContents): void {
  const nav = (wc as Partial<WebContents>).navigationHistory;
  if (nav && typeof nav.goBack === 'function') nav.goBack();
  else wc.goBack();
}

function goForward(wc: WebContents): void {
  const nav = (wc as Partial<WebContents>).navigationHistory;
  if (nav && typeof nav.goForward === 'function') nav.goForward();
  else wc.goForward();
}

/**
 * One tab = one WebContentsView. This is the modern replacement for the
 * removed BrowserView and for the legacy <webview> tag: the page lives in its
 * own process, owned by main, and is composited over the renderer's UI.
 */
export class Tab {
  readonly id: string;
  readonly view: WebContentsView;
  readonly workspaceId: string;

  profileId: BrowserProfileId;
  title: string;
  url: string;
  favicon: string | undefined;
  loading = false;
  pinned = false;
  error: { code: number; description: string } | null = null;
  destroyed = false;

  private readonly events: TabEvents;
  private readonly allowNavigation?: TabInit['allowNavigation'];
  private readonly navigationAuthorized?: TabInit['navigationAuthorized'];

  constructor(init: TabInit) {
    this.id = init.id;
    this.workspaceId = init.workspaceId;
    this.profileId = init.profileId;
    this.url = init.url;
    this.title = init.url === 'about:blank' ? 'Nueva pestaña' : init.url;
    this.events = init.events;
    this.allowNavigation = init.allowNavigation;
    this.navigationAuthorized = init.navigationAuthorized;

    this.view = new WebContentsView({
      webPreferences: {
        session: sessionFor(init.profileId),
        // Remote content gets zero privileges. No preload, no Node, sandboxed.
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        webviewTag: false,
        spellcheck: true,
        backgroundThrottling: true,
      },
    });
    this.view.setBackgroundColor('#0F1113');
    this.wire();
    if (init.url && init.url !== 'about:blank') void this.load(init.url);
  }

  get webContents(): WebContents {
    return this.view.webContents;
  }

  private get alive(): boolean {
    return !this.destroyed && !this.webContents.isDestroyed();
  }

  /* -------------------------------------------------------------- */
  /* Events                                                          */
  /* -------------------------------------------------------------- */

  private wire(): void {
    const wc = this.webContents;

    wc.on('page-title-updated', (_e: unknown, title: string) => {
      this.title = title || this.title;
      this.events.onChange();
    });

    wc.on('page-favicon-updated', (_e: unknown, icons: string[]) => {
      this.favicon = icons[0];
      this.events.onChange();
    });

    wc.on('did-start-loading', () => {
      this.loading = true;
      this.events.onChange();
    });

    wc.on('did-stop-loading', () => {
      this.loading = false;
      this.sync();
      this.events.onChange();
    });

    wc.on('did-navigate', (_e: unknown, url: string) => {
      this.url = url;
      this.error = null;
      this.sync();
      this.events.onNavigated(this, url, this.title);
      this.events.onChange();
    });

    wc.on('did-navigate-in-page', (_e: unknown, url: string, isMainFrame: boolean) => {
      if (!isMainFrame) return;
      this.url = url;
      this.sync();
      this.events.onChange();
    });

    wc.on('did-fail-load', (
      _e: unknown,
      code: number,
      description: string,
      validatedURL: string,
      isMainFrame: boolean,
    ) => {
      // -3 is ERR_ABORTED, which is what a user-initiated stop looks like.
      if (!isMainFrame || code === -3) return;
      this.error = { code, description };
      this.loading = false;
      if (validatedURL) this.url = validatedURL;
      this.events.onChange();
    });

    wc.on('render-process-gone', (_e: unknown, details: { reason?: string }) => {
      this.error = { code: -1, description: `El proceso de la página terminó (${details?.reason ?? 'desconocido'})` };
      this.loading = false;
      this.events.onChange();
    });

    // Popups become tabs. No page gets to open a real window.
    wc.setWindowOpenHandler(({ url, disposition }) => {
      const target = safeExternalUrl(url);
      if (target) {
        this.events.onOpenUrl(target, this.profileId, disposition === 'background-tab');
      }
      return { action: 'deny' };
    });

    const guard = (event: { preventDefault(): void }, url: string) => {
      if (!safeExternalUrl(url) && url !== 'about:blank') { event.preventDefault(); return; }
      // External HTTP frame/navigation authorization is enforced by the owning
      // session's navigation-only request gate. Never turn a POST/iframe into a
      // new top-level GET here.
    };
    wc.on('will-navigate', guard);
    wc.on('will-redirect', (event, url) => { guard(event, url); });
    // Includes frame navigations; no subresource/API request interception.
    wc.on('will-frame-navigate', event => { if (!event.isMainFrame) guard(event, event.url); });

    // Shell shortcuts keep working while the page holds keyboard focus.
    wc.on('before-input-event', (event: { preventDefault(): void }, input: {
      type: string; key: string; control: boolean; shift: boolean; alt: boolean; meta: boolean;
    }) => {
      if (input.type !== 'keyDown') return;
      const combo = [
        input.control ? 'ctrl' : '',
        input.shift ? 'shift' : '',
        input.alt ? 'alt' : '',
        (input.key || '').toLowerCase(),
      ].filter(Boolean).join('+');
      if (!FORWARDED_COMBOS.has(combo)) return;
      // Escape must still reach the page (it cancels a load, closes dialogs).
      if (combo !== 'escape') event.preventDefault();
      this.events.onShortcut(combo);
    });
  }

  /** Re-read the values Chromium owns. */
  private sync(): void {
    if (!this.alive) return;
    const wc = this.webContents;
    this.url = wc.getURL() || this.url;
    const title = wc.getTitle();
    if (title) this.title = title;
    this.loading = wc.isLoading();
  }

  /* -------------------------------------------------------------- */
  /* Commands                                                        */
  /* -------------------------------------------------------------- */

  async load(url: string): Promise<void> {
    if (!this.alive) return;
    if (!safeExternalUrl(url) && url !== 'about:blank') return;
    if (this.allowNavigation && !await this.allowNavigation(url)) { this.error = { code: -1, description: 'Destino externo no autorizado' }; this.events.onChange(); return; }
    if (!this.alive) return;
    this.error = null;
    try {
      await this.webContents.loadURL(url);
    } catch {
      // loadURL rejects on an aborted navigation; did-fail-load already
      // carries the useful detail, so there is nothing to add here.
    }
  }

  back(): void { void this.historyStep(-1); }
  forward(): void { void this.historyStep(1); }
  private async historyStep(delta: -1 | 1): Promise<void> {
    if (!this.alive || !(delta === -1 ? canGoBack(this.webContents) : canGoForward(this.webContents))) return;
    const move = () => delta === -1 ? goBack(this.webContents) : goForward(this.webContents);
    if (!this.allowNavigation) { move(); return; }
    const nav = this.webContents.navigationHistory, index = nav.getActiveIndex();
    const target = nav.getEntryAtIndex(index + delta)?.url;
    if (!target || !await this.allowNavigation(target)) return;
    if (this.alive && nav.getActiveIndex() === index) move();
  }
  reload(): void { if (this.alive) { if (!this.allowNavigation || this.navigationAuthorized?.(this.webContents.getURL())) this.webContents.reload(); else void this.load(this.webContents.getURL()); } }
  stop(): void { if (this.alive) this.webContents.stop(); }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    const wc = this.webContents;
    if (!wc.isDestroyed()) {
      wc.removeAllListeners();
      wc.close();
    }
  }

  toState(): BrowserTab {
    return {
      id: this.id,
      workspaceId: this.workspaceId,
      profileId: this.profileId,
      title: this.title,
      url: this.url,
      favicon: this.favicon,
      loading: this.loading,
      pinned: this.pinned,
      canGoBack: this.alive ? canGoBack(this.webContents) : false,
      canGoForward: this.alive ? canGoForward(this.webContents) : false,
      error: this.error,
    };
  }
}
