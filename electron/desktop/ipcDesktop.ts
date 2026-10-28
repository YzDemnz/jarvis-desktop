import { app, globalShortcut, ipcMain, shell } from 'electron';
import type { BrowserWindow } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { IPC } from '../ipc';
import { DesktopControlService } from '../../src/desktop/DesktopControlService';
import { wireHelper } from './helperLifecycle';
import type { WindowsHelperBridge } from './WindowsHelperBridge';
import { discoverApps, publicApp } from './AppDiscovery';
import { applicationService } from '../agent/ApplicationService';
import { toolRegistry } from '../../src/agent/registry';
import { PermissionEngine } from '../../src/agent/permissions';
import type { DiscoveredApp } from '../../src/types';

import { authority, authorityHandle, effectivePermission, stopAuthorityRuns, onAuthorityStop, allowNavigation } from '../authority';
import { withProcessScope, cancelOwnedRun, assertProcessScope } from '../process/WindowsJobProcess';
import { activateApplication } from '../process/OwnedApplication';

const permissions = new PermissionEngine();

/** Shortcuts Windows reserves or that would be dangerous to hijack. */
const RESERVED_SHORTCUTS = new Set([
  'control+alt+delete', 'ctrl+alt+delete', 'control+shift+escape', 'ctrl+shift+escape',
  'super+l', 'meta+l', 'alt+tab', 'alt+f4', 'control+escape', 'ctrl+escape',
]);
export const DEFAULT_EMERGENCY_SHORTCUT = 'Control+Alt+Escape';

let appCache: { at: number; apps: DiscoveredApp[] } | null = null;
async function apps(): Promise<DiscoveredApp[]> {
  if (appCache && Date.now() - appCache.at < 60_000) return appCache.apps;
  const found = await discoverApps(await applicationService.list());
  appCache = { at: Date.now(), apps: found };
  return found;
}

function helperPath(): string | null {
  const candidates = [
    process.env.JARVIS_AUTOMATION_HELPER,
    path.join(process.resourcesPath ?? '', 'native', 'jarvis-automation-helper.exe'),
    path.join(app.getAppPath(), 'native', 'windows-helper', 'bin', 'Release', 'net8.0-windows', 'win-x64', 'publish', 'jarvis-automation-helper.exe'),
  ].filter((p): p is string => typeof p === 'string' && p.length > 0);
  return candidates.find((p) => fs.existsSync(p)) ?? null;
}

let current: DesktopControlService | null = null;
let currentBridge: WindowsHelperBridge | null = null;
let emergencyAccelerator: string | null = null;

export function registerDesktopIpc(win: BrowserWindow): DesktopControlService {
  const send = (channel: string, payload: unknown) => { if (!win.isDestroyed()) win.webContents.send(channel, payload); };

  const desktop = new DesktopControlService({
    apps,
    onHumanOverride: () => send(IPC.desktop.humanOverride, { at: Date.now() }),
  });
  current = desktop;
  onAuthorityStop(runId => {
    const bound = desktop.status().runId === runId;
    if (bound) desktop.stop('Detenido por el usuario');
    return Promise.all([cancelOwnedRun(runId), bound ? currentBridge?.quiesceInput() : undefined]);
  });
  desktop.gate.subscribe((status) => send(IPC.desktop.statusChanged, status));

  // Windows only, and only if the helper binary is actually present. Anything
  // else leaves UI Automation reported as UNAVAILABLE — never faked.
  const exe = process.platform === 'win32' ? helperPath() : null;
  if (exe) {
    currentBridge = wireHelper(desktop, {
      executable: exe,
      launchFn: async (target, options) => {
        // Only a path that came from local discovery reaches the owned launcher.
        const known = (await apps()).find((a) => a.id === target.id);
        if (!known) throw new Error('Aplicación no reconocida.');
        return activateApplication(known.launchTarget, file => shell.readShortcutLink(file), async file => {
          // URL shortcuts retain External Link Guard, not a local-activation bypass.
          let url: string | undefined;
          if (/\.url$/i.test(file)) url = /^URL=(https?:\/\/[^\r\n]+)$/im.exec(fs.readFileSync(file, 'utf8').slice(0, 16384))?.[1];
          if (/\.lnk$/i.test(file)) { const to = shell.readShortcutLink(file).target; if (/^https?:\/\//i.test(to)) url = to; }
          if (/\.url$/i.test(file) && !url) throw Error('INVALID_URL_SHORTCUT');
          if (url && !await allowNavigation(url)) throw Error('EXTERNAL_LINK_DENIED');
          assertProcessScope();
          return shell.openPath(file);
        }, options?.requireOwnership === true);
      },
    });
  } else {
    void desktop.refresh();
  }

  const adapters = desktop.adapters();

  /**
   * One handler per tool id, each on its own named channel. Main is the
   * authority: it re-checks the permission level against the registry and runs
   * the same control-gate policy before the adapter executes anything.
   */
  for (const [toolId, channel] of Object.entries(IPC.desktopTools)) {
    authorityHandle(channel, async (_e, _sessionLevel: unknown, runId: unknown, args: unknown) => {
      const tool = toolRegistry.get(toolId);
      const verdict = permissions.check(tool, effectivePermission());
      if (!tool || !verdict.allowed) {
        return { ok: false, reason: 'permission_denied', error: verdict.allowed ? 'Herramienta desconocida.' : verdict.reason };
      }
      try { authority.gate(String(runId)); } catch (error) { return { ok: false, error: String(error) }; }
      const decision = await desktop.authorize(tool, args, typeof runId === 'string' ? runId : '');
      if (!decision.ok) return { ok: false, reason: 'policy_blocked', error: decision.reason };
      try {
        authority.gate(String(runId));
        if (!permissions.check(tool, effectivePermission()).allowed) throw Error('AUTHORITY_CHANGED');
      } catch (error) { return { ok: false, reason: 'authority_denied', error: String(error) }; }

      const adapter = adapters[toolId as keyof typeof adapters];
      if (!adapter) return { ok: false, reason: 'not_implemented', error: 'Sin implementación.' };
      try {
        const data = await withProcessScope(String(runId), desktop.gate.signal, () => adapter(args as never, { runId: String(runId), token: desktop.gate.cancellation, signal: desktop.gate.signal }), () => authority.gate(String(runId)));
        // Capture pixels never cross IPC; only the metadata does.
        return { ok: true, data };
      } catch (error) {
        return { ok: false, reason: 'adapter_error', error: error instanceof Error ? error.message : String(error) };
      }
    });
  }

  const D = IPC.desktop;
  authorityHandle(D.status, async () => desktop.refresh());
  authorityHandle(D.bindRun, (_e, runId: unknown) => { if (typeof runId === 'string') { authority.gate(runId); desktop.bindRun(runId); } return desktop.status(); });
  authorityHandle(D.releaseRun, (_e, runId: unknown) => { if (typeof runId === 'string') desktop.releaseRun(runId); return desktop.status(); });
  authorityHandle(D.stop, async () => { desktop.stop('Detenido por el usuario'); await stopAuthorityRuns(); await currentBridge?.quiesceInput(); return desktop.status(); });
  authorityHandle(D.pause, () => { desktop.pause(); return desktop.status(); });
  authorityHandle(D.resume, () => { desktop.resume(); return desktop.status(); });
  authorityHandle(D.apps, async () => (await apps()).map(publicApp));
  authorityHandle(D.setEmergencyShortcut, (_e, accelerator: unknown) => setEmergencyShortcut(String(accelerator ?? ''), send));

  setEmergencyShortcut(DEFAULT_EMERGENCY_SHORTCUT, send);
  return desktop;
}

/**
 * CANCEL ALL COMPUTER CONTROL, from anywhere in Windows. Registered globally so
 * it works even when JARVIS is not focused — which is exactly when it matters.
 */
export function setEmergencyShortcut(accelerator: string, send: (c: string, p: unknown) => void): { ok: boolean; accelerator: string | null; error?: string } {
  const normalized = accelerator.trim();
  if (!normalized || RESERVED_SHORTCUTS.has(normalized.toLowerCase())) {
    return { ok: false, accelerator: emergencyAccelerator, error: 'Esa combinación está reservada por Windows o no es válida.' };
  }
  if (emergencyAccelerator) globalShortcut.unregister?.(emergencyAccelerator);
  const ok = globalShortcut.register(normalized, () => {
    current?.stop('Atajo de emergencia'); void stopAuthorityRuns().catch(() => { /* authority publishes incomplete STOP */ });
    send(IPC.desktop.emergencyStop, { at: Date.now() });
  });
  if (!ok) {
    // Another app owns it: keep the previous one rather than end up with none.
    if (emergencyAccelerator) globalShortcut.register(emergencyAccelerator, () => current?.stop('Atajo de emergencia'));
    return { ok: false, accelerator: emergencyAccelerator, error: 'Otra aplicación ya usa esa combinación.' };
  }
  emergencyAccelerator = normalized;
  return { ok: true, accelerator: normalized };
}

export function unregisterDesktopIpc(): void {
  [...Object.values(IPC.desktopTools), ...Object.values(IPC.desktop)].forEach((c) => {
    try { ipcMain.removeHandler(c); } catch { /* sin handler */ }
  });
  current?.dispose();
  currentBridge?.kill();
  currentBridge = null;
  current = null;
}
