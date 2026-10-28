declare module 'electron' {
  export interface Rectangle { x: number; y: number; width: number; height: number }
  export interface Event { preventDefault(): void; defaultPrevented?: boolean }

  export interface WebPreferences {
    preload?: string; contextIsolation?: boolean; nodeIntegration?: boolean; sandbox?: boolean;
    webviewTag?: boolean; devTools?: boolean; partition?: string; session?: Session;
    backgroundThrottling?: boolean; spellcheck?: boolean; scrollBounce?: boolean; safeDialogs?: boolean;
    enableBlinkFeatures?: string; disableBlinkFeatures?: string; transparent?: boolean;
  }

  export interface NavigationEntry { url: string; title: string }

  export interface WebContents {
    id: number;
    session: Session;
    loadURL(url: string, options?: any): Promise<void>;
    loadFile(path: string, options?: any): Promise<void>;
    getURL(): string;
    getTitle(): string;
    isLoading(): boolean;
    isDestroyed(): boolean;
    stop(): void;
    reload(): void;
    reloadIgnoringCache(): void;
    goBack(): void;
    goForward(): void;
    canGoBack(): boolean;
    canGoForward(): boolean;
    navigationHistory: {
      canGoBack(): boolean; canGoForward(): boolean; goBack(): void; goForward(): void;
      getActiveIndex(): number; length(): number; getAllEntries(): NavigationEntry[];
    };
    setWindowOpenHandler(handler: (details: { url: string; frameName: string; disposition: string }) =>
      { action: 'allow'; overrideBrowserWindowOptions?: any } | { action: 'deny' }): void;
    openDevTools(options?: { mode?: string }): void;
    closeDevTools(): void;
    isDevToolsOpened(): boolean;
    send(channel: string, ...args: any[]): void;
    executeJavaScript(code: string, userGesture?: boolean): Promise<any>;
    capturePage(rect?: Rectangle): Promise<NativeImage>;
    setAudioMuted(muted: boolean): void;
    isAudioMuted(): boolean;
    setZoomLevel(level: number): void;
    getZoomLevel(): number;
    focus(): void;
    close(): void;
    downloadURL(url: string): void;
    insertCSS(css: string): Promise<string>;
    on(event: string, listener: (...args: any[]) => void): this;
    once(event: string, listener: (...args: any[]) => void): this;
    removeAllListeners(event?: string): this;
    setUserAgent(ua: string): void;
    getUserAgent(): string;
  }

  export interface NativeImage {
    toDataURL(): string; toPNG(): Buffer; isEmpty(): boolean;
    resize(opts: { width?: number; height?: number }): NativeImage;
  }

  export interface DownloadItem {
    getURL(): string; getFilename(): string; getTotalBytes(): number; getReceivedBytes(): number;
    getState(): 'progressing' | 'completed' | 'cancelled' | 'interrupted';
    getSavePath(): string; setSavePath(p: string): void; getMimeType(): string;
    pause(): void; resume(): void; cancel(): void; isPaused(): boolean;
    on(event: string, listener: (...args: any[]) => void): this;
    once(event: string, listener: (...args: any[]) => void): this;
  }

  export interface Cookies {
    get(filter: any): Promise<any[]>;
    set(details: any): Promise<void>;
    remove(url: string, name: string): Promise<void>;
  }

  export interface Session {
    cookies: Cookies;
    setPermissionRequestHandler(handler: ((wc: WebContents, permission: string, callback: (granted: boolean) => void, details: any) => void) | null): void;
    setPermissionCheckHandler(handler: ((wc: WebContents | null, permission: string, origin: string, details: any) => boolean) | null): void;
    clearStorageData(options?: any): Promise<void>;
    clearCache(): Promise<void>;
    setUserAgent(ua: string): void;
    getUserAgent(): string;
    on(event: string, listener: (...args: any[]) => void): this;
    removeAllListeners(event?: string): this;
    protocol: any;
    webRequest: any;
    setSpellCheckerEnabled(enabled: boolean): void;
  }

  export const session: {
    fromPartition(partition: string, options?: { cache?: boolean }): Session;
    defaultSession: Session;
  };

  export class View {
    constructor(options?: any);
    addChildView(view: View, index?: number): void;
    removeChildView(view: View): void;
    setBounds(bounds: Rectangle): void;
    getBounds(): Rectangle;
    setBackgroundColor(color: string): void;
    setVisible(visible: boolean): void;
    getVisible?(): boolean;
    children: View[];
  }

  export class WebContentsView extends View {
    constructor(options?: { webPreferences?: WebPreferences; webContents?: WebContents });
    webContents: WebContents;
  }

  export class BaseWindow {
    constructor(options?: any);
    contentView: View;
    setBounds(b: Rectangle): void;
    getBounds(): Rectangle;
    getContentBounds(): Rectangle;
    isDestroyed(): boolean;
    on(event: string, listener: (...args: any[]) => void): this;
  }

  export class BrowserWindow extends BaseWindow {
    constructor(options?: any);
    webContents: WebContents;
    id: number;
    loadURL(url: string, options?: any): Promise<void>;
    loadFile(path: string, options?: any): Promise<void>;
    show(): void; hide(): void; focus(): void; close(): void; destroy(): void;
    minimize(): void; maximize(): void; unmaximize(): void;
    isMaximized(): boolean; isMinimized(): boolean; isVisible(): boolean; isFocused(): boolean;
    setMenuBarVisibility(v: boolean): void;
    once(event: string, listener: (...args: any[]) => void): this;
    static getAllWindows(): BrowserWindow[];
    static fromWebContents(wc: WebContents): BrowserWindow | null;
  }

  export interface IpcMainInvokeEvent { sender: WebContents; frameId: number }
  export interface IpcMainEvent { sender: WebContents; reply(channel: string, ...args: any[]): void }

  export const ipcMain: {
    handle(channel: string, listener: (event: IpcMainInvokeEvent, ...args: any[]) => any): void;
    on(channel: string, listener: (event: IpcMainEvent, ...args: any[]) => void): void;
    removeHandler(channel: string): void;
  };

  export const ipcRenderer: {
    invoke(channel: string, ...args: any[]): Promise<any>;
    send(channel: string, ...args: any[]): void;
    on(channel: string, listener: (event: any, ...args: any[]) => void): void;
    off(channel: string, listener: (event: any, ...args: any[]) => void): void;
    removeListener(channel: string, listener: (event: any, ...args: any[]) => void): void;
  };

  export const contextBridge: {
    exposeInMainWorld(key: string, api: any): void;
  };

  export const app: {
    getAppPath(): string;
    whenReady(): Promise<void>;
    quit(): void;
    getPath(name: string): string;
    getVersion(): string;
    getName(): string;
    isPackaged: boolean;
    on(event: string, listener: (...args: any[]) => void): void;
    setAppUserModelId(id: string): void;
    requestSingleInstanceLock(): boolean;
  };

  export const globalShortcut: {
    register(accelerator: string, callback: () => void): boolean;
    unregister(accelerator: string): void;
    unregisterAll(): void;
    isRegistered(accelerator: string): boolean;
  };

  export const shell: {
    openExternal(url: string): Promise<void>;
    showItemInFolder(path: string): void;
    openPath(path: string): Promise<string>;
  };

  export const dialog: {
    showSaveDialog(window: any, options: any): Promise<{ canceled: boolean; filePath?: string }>;
    showOpenDialog(window: any, options: any): Promise<{ canceled: boolean; filePaths: string[] }>;
    showMessageBox(window: any, options: any): Promise<{ response: number }>;
  };

  export const nativeImage: {
    createFromDataURL(url: string): NativeImage;
    createEmpty(): NativeImage;
  };

  export interface Display {
    id: number;
    bounds: Rectangle;
    size: { width: number; height: number };
    workAreaSize: { width: number; height: number };
    scaleFactor: number;
    rotation: number;
  }
  export const screen: {
    getPrimaryDisplay(): Display;
    getAllDisplays(): Display[];
    getDisplayNearestPoint(point: { x: number; y: number }): Display;
  };
}

declare namespace NodeJS {
  interface Process {
    /** Added by Electron: path to the packaged resources directory. */
    resourcesPath: string;
  }
}
