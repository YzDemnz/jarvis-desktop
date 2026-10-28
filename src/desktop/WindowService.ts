import type { Bounds, MonitorInfo, WindowInfo } from '@/types';
import type { WindowsAutomationAdapter } from './adapter';
import { processNamesFor } from './appIds';

export interface WindowQuery {
  /** Stable app id ("app:vscode"): matched by process name, never by title. */
  appId?: string;
  processName?: string;
  titleContains?: string;
  appName?: string;
  visibleOnly?: boolean;
}

const MIN_SIZE = 200;
const MAX_SIZE = 16384;

/**
 * Windows are addressed by windowId only. Titles are for matching, never for
 * identity — "● app.ts — Vigilia" and "app.ts — Vigilia" are the same window.
 */
export class WindowService {
  constructor(private adapter: WindowsAutomationAdapter) {}
  useAdapter(adapter: WindowsAutomationAdapter): void { this.adapter = adapter; }

  listWindows(): Promise<WindowInfo[]> { return this.adapter.listWindows(); }
  getActiveWindow(): Promise<WindowInfo | null> { return this.adapter.activeWindow(); }
  monitors(): Promise<MonitorInfo[]> { return this.adapter.monitors(); }

  async findWindows(query: WindowQuery): Promise<WindowInfo[]> {
    const all = await this.adapter.listWindows();
    const title = query.titleContains?.toLowerCase();
    const proc = query.processName?.toLowerCase().replace(/\.exe$/, '');
    const app = query.appName?.toLowerCase();
    const procs = query.appId ? processNamesFor(query.appId) : null;
    if (procs && procs.length === 0) return [];
    return all.filter((w) =>
      (!query.visibleOnly || w.visible)
      && (!procs || procs.includes(w.processName.toLowerCase()))
      && (!title || w.title.toLowerCase().includes(title))
      && (!proc || w.processName.toLowerCase().replace(/\.exe$/, '') === proc)
      && (!app || w.title.toLowerCase().includes(app) || w.processName.toLowerCase().includes(app)));
  }

  async require(windowId: string): Promise<WindowInfo> {
    const found = (await this.adapter.listWindows()).find((w) => w.windowId === windowId);
    if (!found) throw new Error(`La ventana ${windowId} ya no existe.`);
    if (found.elevated) {
      throw new Error('La ventana pertenece a un proceso elevado. Windows no permite controlarla sin privilegios de administrador.');
    }
    return found;
  }

  async activateWindow(windowId: string): Promise<void> { await this.require(windowId); await this.adapter.activateWindow(windowId); }
  async minimizeWindow(windowId: string): Promise<void> { await this.require(windowId); await this.adapter.setWindowState(windowId, 'minimized'); }
  async maximizeWindow(windowId: string): Promise<void> { await this.require(windowId); await this.adapter.setWindowState(windowId, 'maximized'); }
  async restoreWindow(windowId: string): Promise<void> { await this.require(windowId); await this.adapter.setWindowState(windowId, 'normal'); }

  /** A window moved off every monitor is lost to the user; refuse that. */
  async moveWindow(windowId: string, x: number, y: number): Promise<void> {
    await this.require(windowId);
    const monitors = await this.adapter.monitors();
    if (!Number.isFinite(x) || !Number.isFinite(y)) throw new Error('Coordenadas inválidas.');
    const onScreen = monitors.some((m) => x >= m.bounds.x - 50 && x < m.bounds.x + m.bounds.width - 50
      && y >= m.bounds.y && y < m.bounds.y + m.bounds.height - 50);
    if (monitors.length && !onScreen) throw new Error('La posición dejaría la ventana fuera de todas las pantallas.');
    await this.adapter.moveWindow(windowId, Math.round(x), Math.round(y));
  }

  async resizeWindow(windowId: string, width: number, height: number): Promise<void> {
    await this.require(windowId);
    if (!Number.isFinite(width) || !Number.isFinite(height)) throw new Error('Tamaño inválido.');
    if (width < MIN_SIZE || height < MIN_SIZE) throw new Error(`El tamaño mínimo es ${MIN_SIZE}×${MIN_SIZE}.`);
    if (width > MAX_SIZE || height > MAX_SIZE) throw new Error('El tamaño excede el máximo permitido.');
    await this.adapter.resizeWindow(windowId, Math.round(width), Math.round(height));
  }

  /**
   * A polite close request. If the app has unsaved work it shows its own
   * dialog, and JARVIS leaves that dialog to the user.
   */
  async closeWindow(windowId: string): Promise<{ closed: boolean; dialogShown: boolean }> {
    await this.require(windowId);
    await this.adapter.closeWindow(windowId);
    const still = (await this.adapter.listWindows()).some((w) => w.windowId === windowId);
    return { closed: !still, dialogShown: still };
  }

  static center(bounds: Bounds): { x: number; y: number } {
    return { x: Math.round(bounds.x + bounds.width / 2), y: Math.round(bounds.y + bounds.height / 2) };
  }
}
