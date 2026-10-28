/* Doble de prueba de Electron: superficie mínima para ejecutar el código real
   del proceso principal bajo Node, sin Chromium. */
import { EventEmitter } from 'node:events';
import os from 'node:os';
import path from 'node:path';

let wcSeq = 0;

class FakeWebContents extends EventEmitter {
  constructor(session) {
    super();
    this.id = ++wcSeq;
    this.session = session;
    this._url = '';
    this._title = '';
    this._loading = false;
    this._destroyed = false;
    this._back = [];
    this._forward = [];
    this.openHandler = null;
    this.navigationHistory = {
      canGoBack: () => this._back.length > 0,
      canGoForward: () => this._forward.length > 0,
      goBack: () => {
        const prev = this._back.pop();
        if (prev === undefined) return;
        this._forward.push(this._url);
        this._commit(prev, false);
      },
      goForward: () => {
        const next = this._forward.pop();
        if (next === undefined) return;
        this._back.push(this._url);
        this._commit(next, false);
      },
      getActiveIndex: () => this._back.length,
      length: () => this._back.length + this._forward.length + 1,
      getAllEntries: () => [],
    };
  }
  _commit(url, pushHistory = true) {
    if (pushHistory && this._url) this._back.push(this._url);
    this._url = url;
    this._title = url;
    this._loading = true;
    this.emit('did-start-loading');
    this.emit('did-navigate', {}, url);
    this._loading = false;
    this.emit('did-stop-loading');
  }
  async loadURL(url) { this._commit(url); }
  getURL() { return this._url; }
  getTitle() { return this._title; }
  isLoading() { return this._loading; }
  isDestroyed() { return this._destroyed; }
  stop() { this._loading = false; this.emit('did-stop-loading'); }
  reload() { this._commit(this._url, false); }
  setWindowOpenHandler(fn) { this.openHandler = fn; }
  close() { this._destroyed = true; }
  async executeJavaScript() { return 'texto simulado de la página'; }
  async capturePage() { return { isEmpty: () => false, toDataURL: () => 'data:image/png;base64,AAAA' }; }
  send() {}
  setAudioMuted() {}
  focus() {}
  openDevTools() {}
}

export class View {
  constructor() { this.children = []; this._bounds = null; this._visible = true; }
  addChildView(v) { if (!this.children.includes(v)) this.children.push(v); }
  removeChildView(v) {
    const i = this.children.indexOf(v);
    if (i === -1) throw new Error('view no adjunta');
    this.children.splice(i, 1);
  }
  setBounds(b) { this._bounds = b; }
  getBounds() { return this._bounds; }
  setBackgroundColor() {}
  setVisible(v) { this._visible = v; }
}

export class WebContentsView extends View {
  constructor(options = {}) {
    super();
    this.webContents = new FakeWebContents(options.webPreferences?.session ?? null);
  }
}

class FakeSession extends EventEmitter {
  constructor(partition) {
    super();
    this.partition = partition;
    this.permissionRequestHandler = null;
    this.permissionCheckHandler = null;
    this.cookies = { get: async () => [], set: async () => {}, remove: async () => {} };
  }
  setPermissionRequestHandler(fn) { this.permissionRequestHandler = fn; }
  setPermissionCheckHandler(fn) { this.permissionCheckHandler = fn; }
  async clearStorageData() {}
  async clearCache() {}
  setSpellCheckerEnabled() {}
}

const sessions = new Map();
export const session = {
  fromPartition(partition) {
    if (!sessions.has(partition)) sessions.set(partition, new FakeSession(partition));
    return sessions.get(partition);
  },
  get defaultSession() { return session.fromPartition('default'); },
};

const dataDir = path.join(os.tmpdir(), 'jarvis-test-userdata');
export const app = {
  getPath: (name) => {
    if (name === 'downloads') return path.join(dataDir, 'Downloads');
    if (name === 'documents') return path.join(dataDir, 'Documents');
    if (name === 'desktop') return path.join(dataDir, 'Desktop');
    return dataDir;
  },
  getVersion: () => '0.1.0-test',
  getName: () => 'JARVIS Desktop',
  isPackaged: false,
  whenReady: async () => {},
  on() {}, quit() {}, setAppUserModelId() {}, requestSingleInstanceLock: () => true,
};

export const shell = { openExternal: async () => {}, showItemInFolder() {}, openPath: async () => '' };
export const ipcMain = { handle() {}, on() {}, removeHandler() {} };
export const ipcRenderer = { invoke: async () => {}, send() {}, on() {}, off() {} };
export const contextBridge = { exposeInMainWorld() {} };
export const globalShortcut = { register: () => true, unregisterAll() {}, isRegistered: () => false };
export const dialog = {};
export const nativeImage = { createEmpty: () => ({ isEmpty: () => true, toDataURL: () => '' }) };
export const screen = {};
export class BaseWindow {}
export class BrowserWindow extends BaseWindow {}
export default { app, session, shell, ipcMain, contextBridge, globalShortcut };
