/**
 * Canonical browser types. These cross the process boundary, so everything
 * here must stay serialisable — no WebContents, no handles, no functions.
 * The main process imports this file type-only; nothing is bundled twice.
 */

export type BrowserProfileId = 'personal' | 'work' | 'trading' | 'development';

export interface BrowserProfile {
  id: BrowserProfileId;
  label: string;
  accent: string;
  description: string;
}

export interface BrowserTab {
  id: string;
  workspaceId: string;
  profileId: BrowserProfileId;
  title: string;
  url: string;
  favicon?: string;
  loading: boolean;
  pinned: boolean;
  canGoBack: boolean;
  canGoForward: boolean;
  /** Set when the last navigation failed; cleared on the next success. */
  error?: { code: number; description: string } | null;
}

/** The whole browser state in one object — the renderer mirrors this. */
export interface BrowserSnapshot {
  tabs: BrowserTab[];
  activeId: string | null;
}

export interface HistoryEntry {
  id: string;
  title: string;
  url: string;
  visitedAt: number;
  profileId: BrowserProfileId;
}

export interface Bookmark {
  id: string;
  title: string;
  url: string;
  folder: string;
  profileId: BrowserProfileId;
  createdAt: number;
}

export interface DownloadItem {
  id: string;
  filename: string;
  url: string;
  savePath: string;
  bytes: number;
  received: number;
  state: 'in_progress' | 'completed' | 'cancelled' | 'failed';
  startedAt: number;
}

export type SitePermission =
  | 'geolocation'
  | 'notifications'
  | 'media'
  | 'clipboard-read'
  | 'display-capture'
  | 'midi'
  | 'pointerLock'
  | 'fullscreen';

export interface PermissionRecord {
  origin: string;
  permission: SitePermission | string;
  allowed: boolean;
  profileId: BrowserProfileId;
  decidedAt: number;
}

/** Geometry of the viewport the page is painted into, in CSS pixels. */
export interface ViewportRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/* ------------------------------------------------------------------ */
/* Page inspection                                                     */
/* ------------------------------------------------------------------ */

export interface DomNode {
  tag: string;
  role?: string;
  name?: string;
  text?: string;
  attributes?: Record<string, string>;
  children?: DomNode[];
}

export interface FoundElement {
  /** Opaque handle; only meaningful to the process that produced it. */
  ref: string;
  tag: string;
  text: string;
  rect: ViewportRect;
}

export interface BrowserActionResult {
  ok: boolean;
  detail?: string;
}

/**
 * Read-only page inspection is available now. The mutating half is declared so
 * the agent layer can be written against a stable shape, but it deliberately
 * refuses until the permission model covers it — see ToolDefinition/CONTROL.
 */
export interface BrowserAutomation {
  getPageText(tabId: string): Promise<string>;
  getDOMSnapshot(tabId: string, maxDepth?: number): Promise<DomNode>;
  getScreenshot(tabId: string): Promise<string>;
  findElements(tabId: string, query: string): Promise<FoundElement[]>;
  clickElement(tabId: string, ref: string): Promise<BrowserActionResult>;
  typeIntoElement(tabId: string, ref: string, text: string): Promise<BrowserActionResult>;
  executeBrowserAction(tabId: string, action: string, payload?: unknown): Promise<BrowserActionResult>;
}

/**
 * The UI is written against this interface only — never against Electron.
 * Two implementations exist: the real one over IPC, and a mock used when the
 * renderer runs in a plain browser (vite dev without the shell).
 */
export interface BrowserService extends BrowserAutomation {
  /** Push-based mirror of main's state. Returns an unsubscribe function. */
  subscribe(listener: (snapshot: BrowserSnapshot) => void): () => void;
  snapshot(): Promise<BrowserSnapshot>;

  create(url: string, workspaceId: string, profileId?: BrowserProfileId): Promise<BrowserTab>;
  close(tabId: string): Promise<void>;
  activate(tabId: string): Promise<void>;
  setPinned(tabId: string, pinned: boolean): Promise<void>;
  setProfile(tabId: string, profileId: BrowserProfileId): Promise<void>;

  navigate(tabId: string, input: string): Promise<void>;
  back(tabId: string): Promise<void>;
  forward(tabId: string): Promise<void>;
  reload(tabId: string): Promise<void>;
  stop(tabId: string): Promise<void>;

  /** Layout is owned by the renderer; main just paints where it is told. */
  setBounds(rect: ViewportRect): Promise<void>;
  setVisible(visible: boolean): Promise<void>;

  profiles(): Promise<BrowserProfile[]>;
  history(query?: string): Promise<HistoryEntry[]>;
  clearHistory(profileId?: BrowserProfileId): Promise<void>;
  bookmarks(): Promise<Bookmark[]>;
  addBookmark(tabId: string, folder?: string): Promise<void>;
  removeBookmark(id: string): Promise<void>;
  downloads(): Promise<DownloadItem[]>;
  onDownloads(listener: (items: DownloadItem[]) => void): () => void;
  cancelDownload(id: string): Promise<void>;
  permissions(): Promise<PermissionRecord[]>;
  setPermission(origin: string, permission: string, allowed: boolean, profileId: BrowserProfileId): Promise<void>;
}
