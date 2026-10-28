import { app, BrowserWindow, globalShortcut, ipcMain, shell } from 'electron';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { safeExternalUrl, shellNavigationAllowed } from './security';
import { IPC } from './ipc';
import { registerBrowserIpc, unregisterBrowserIpc } from './browser/ipcBrowser';
import { registerAgentIpc, unregisterAgentIpc } from './agent/ipcAgent';
import { registerMachineIpc, unregisterMachineIpc } from './machine/ipcMachine';
import { registerDesktopIpc, unregisterDesktopIpc } from './desktop/ipcDesktop';
import { registerDevIpc, unregisterDevIpc } from './dev/ipcDev';
import { registerFabricIpc, unregisterFabricIpc } from './fabric/ipcFabric';
import { registerConnectedIpc, unregisterConnectedIpc } from './connected/ipcConnected';
import { registerBootstrapIpc, unregisterBootstrapIpc } from './bootstrap/ipcBootstrap';
import {registerIntelligenceIpc,unregisterIntelligenceIpc} from './bridge/ipcIntelligence';
import {registerWorkbenchIpc,unregisterWorkbenchIpc} from './workbench/ipcWorkbench';
import type { TabManager } from './browser/TabManager';
import { registerAuthority, unregisterAuthority, allowNavigation } from './authority';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEV_URL = process.env.VITE_DEV_SERVER_URL;
const APP_INDEX = path.join(__dirname, '../dist/index.html');

// The recovered Windows/Radeon setup can stall GPU/network startup before a
// window appears. Software UI rendering passed the isolated startup comparison.
// This affects Chromium composition only; external Vulkan inference is separate.
if (process.platform === 'win32') app.disableHardwareAcceleration();

// Explicit test-only profile isolation. A renderer cannot set process.env.
const fixtureData = process.env.JARVIS_TEST_USER_DATA;
// An owner-configured portable installation can keep its persistent profile on
// the external disk. Renderer input cannot select this directory.
let portableCodex:string|null=null;
if(app.isPackaged){let ancestor=path.dirname(process.execPath);while(path.dirname(ancestor)!==ancestor){if(path.basename(ancestor).toUpperCase()==='CODEX'){portableCodex=ancestor;break;}ancestor=path.dirname(ancestor);}}
const externalProfile = process.env.JARVIS_USER_DATA??(portableCodex?path.join(portableCodex,'DatosApps/JARVIS'):undefined);
if(portableCodex){
  let appRoot=path.dirname(process.execPath);while(path.basename(appRoot).toUpperCase()!=='JARVIS'&&path.dirname(appRoot)!==appRoot)appRoot=path.dirname(appRoot);
  const dependencies=process.env.JARVIS_RUNTIME_ROOT?path.dirname(process.env.JARVIS_RUNTIME_ROOT):path.join(path.basename(appRoot).toUpperCase()==='JARVIS'?appRoot:path.dirname(path.dirname(process.execPath)),'Dependencias'),caches=path.join(dependencies,'Caches');
  process.env.JARVIS_RUNTIME_ROOT??=path.join(dependencies,'Runtimes');process.env.JARVIS_CODEX_EXE??=path.join(dependencies,'Herramientas/Codex/codex.exe');
  const temporary=process.env.TEMP&&path.resolve(process.env.TEMP).toLowerCase().startsWith((portableCodex+path.sep).toLowerCase())?process.env.TEMP:path.join(caches,'temp');
  process.env.TEMP=temporary;process.env.TMP=temporary;
  process.env.DOTNET_BUNDLE_EXTRACT_BASE_DIR??=path.join(caches,'dotnet-bundles');fs.mkdirSync(temporary,{recursive:true});
}
if (externalProfile && !(process.env.JARVIS_ALLOW_FIXTURES === '1' && fixtureData)) {
  if (!path.isAbsolute(externalProfile)) throw Error('JARVIS_USER_DATA_MUST_BE_ABSOLUTE');
  fs.mkdirSync(externalProfile, { recursive: true });
  app.setPath('userData', path.resolve(externalProfile));
}
if (process.env.JARVIS_ALLOW_FIXTURES === '1' && fixtureData) {
  const resolved = path.resolve(fixtureData);
  const tempRoot = path.resolve(os.tmpdir()) + path.sep;
  if (resolved.startsWith(tempRoot) && path.basename(resolved).startsWith('jarvis-fabric-native-')) {
    fs.mkdirSync(resolved, { recursive: true });
    app.setPath('userData', resolved);
  }else throw Error('JARVIS_FIXTURE_PROFILE_INVALID');
}

let win: BrowserWindow | null = null;
let tabs: TabManager | null = null;

function createWindow() {
  win = new BrowserWindow({
    width: 1560,
    height: 960,
    minWidth: 1100,
    minHeight: 680,
    show: false,
    frame: false,
    backgroundColor: '#08090A',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      // Security posture: the shell renderer gets zero Node access, and every
      // web page lives in its own sandboxed WebContentsView with no preload.
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webviewTag: false,
    },
  });

  win.once('ready-to-show', () => win?.show());
  win.on('maximize', () => win?.webContents.send(IPC.window.maximizedChanged, true));
  win.on('unmaximize', () => win?.webContents.send(IPC.window.maximizedChanged, false));

  // The shell itself never opens windows; page popups are handled per tab and
  // turned into tabs. Anything reaching here goes to the system browser.
  win.webContents.setWindowOpenHandler(({ url }) => {
    const external = safeExternalUrl(url);
    if (external) void allowNavigation(external).then(allowed => { if (allowed) void shell.openExternal(external); });
    return { action: 'deny' };
  });

  // The renderer is the shell UI; it must never navigate away from itself.
  win.webContents.on('will-navigate', (event: { preventDefault(): void }, url: string) => {
    if (!shellNavigationAllowed(url, APP_INDEX, DEV_URL)) {
      event.preventDefault();
      const external = safeExternalUrl(url);
      if (external) void allowNavigation(external).then(allowed => { if (allowed) void shell.openExternal(external); });
    }
  });

  registerAuthority(win);
  tabs = registerBrowserIpc(win);
  registerAgentIpc(win);
  registerMachineIpc();
  registerDesktopIpc(win);
  registerDevIpc(win);
  registerFabricIpc(win);
  registerConnectedIpc(win);
  registerBootstrapIpc(win);
  registerIntelligenceIpc(win);
  registerWorkbenchIpc();

  win.on('closed', () => {
    tabs?.dispose();
    tabs = null;
    unregisterBrowserIpc();
    unregisterAgentIpc();
    unregisterMachineIpc();
    unregisterDesktopIpc();
    unregisterDevIpc();
    unregisterWorkbenchIpc();
    unregisterIntelligenceIpc();
    unregisterBootstrapIpc();
    unregisterConnectedIpc();
    unregisterFabricIpc();
    unregisterAuthority();
    win = null;
  });

  if (DEV_URL) {
    void win.loadURL(DEV_URL);
    win.webContents.openDevTools({ mode: 'detach' });
  } else {
    void win.loadFile(APP_INDEX);
  }
}

function registerIpc() {
  ipcMain.on(IPC.window.minimize, () => win?.minimize());
  ipcMain.on(IPC.window.toggleMaximize, () => {
    if (!win) return;
    if (win.isMaximized()) win.unmaximize();
    else win.maximize();
  });
  ipcMain.on(IPC.window.close, () => win?.close());
  ipcMain.handle(IPC.window.isMaximized, () => win?.isMaximized() ?? false);
  ipcMain.handle(IPC.app.platform, () => process.platform);
  ipcMain.handle(IPC.app.version, () => app.getVersion());
}

function registerGlobalShortcuts() {
  // Alt+Space is the system-wide summon. Every other shortcut is renderer-local,
  // with page-focus cases forwarded from each tab's before-input-event.
  globalShortcut.register('Alt+Space', () => {
    if (!win) return;
    if (!win.isVisible()) win.show();
    win.focus();
    win.webContents.send(IPC.hotkeys.commandPalette);
  });
}

app.whenReady().then(() => {
  registerIpc();
  createWindow();
  registerGlobalShortcuts();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
  tabs?.dispose();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
