import type { ControlStatus, DiscoveredApp, ToolId } from '@/types';
import type { AdapterMap } from '@/agent/adapters/types';
import type { ToolPolicy } from '@/agent/ToolBroker';
import { DesktopControlService } from '@/desktop/DesktopControlService';
import { UnavailableAutomationAdapter } from '@/desktop/adapter';
import type { WindowsAutomationAdapter } from '@/desktop/adapter';
import type { HumanInputSource } from '@/desktop/HumanOverrideDetector';

/**
 * What the renderer needs from desktop control, whichever process hosts it.
 * Production talks to main over IPC; the harness runs the same service
 * in-process against the fake adapter. Nothing above this seam can tell.
 */
export interface DesktopController {
  readonly mode: 'ipc' | 'local';
  status(): ControlStatus;
  subscribe(listener: (s: ControlStatus) => void): () => void;
  onHumanOverride(listener: () => void): () => void;
  bindRun(runId: string): void;
  releaseRun(runId: string): void;
  stop(): void;
  pause(): void;
  resume(): void;
  adapters(getLevel: () => string, getRunId: () => string): AdapterMap;
  policy(): ToolPolicy | null;
  apps(): Promise<DiscoveredApp[]>;
  refresh(): Promise<ControlStatus>;
  /** In-process service, when there is one. The UI Inspector reads it. */
  readonly local: DesktopControlService | null;
}

const INITIAL: ControlStatus = {
  mode: 'idle', runId: null, currentAction: null, blockedReason: null,
  humanOverride: false, session: 'UNKNOWN', helperAvailable: false,
};

/* ------------------------------------------------------------------ */

class LocalDesktopController implements DesktopController {
  readonly mode = 'local' as const;
  readonly local: DesktopControlService;
  private appSource: () => Promise<DiscoveredApp[]> = async () => [];
  private overrideListeners = new Set<() => void>();

  constructor(adapter: WindowsAutomationAdapter) {
    this.local = new DesktopControlService({
      adapter,
      apps: () => this.appSource(),
      onHumanOverride: () => this.overrideListeners.forEach((l) => l()),
    });
    void this.local.refresh();
  }

  async useAdapter(adapter: WindowsAutomationAdapter, apps: DiscoveredApp[] = [], human: HumanInputSource | null = null): Promise<void> {
    this.appSource = async () => apps;
    this.local.human.useSource(human);
    await this.local.useAdapter(adapter);
  }

  status() { return this.local.status(); }
  subscribe(listener: (s: ControlStatus) => void) { return this.local.gate.subscribe(listener); }
  onHumanOverride(listener: () => void) { this.overrideListeners.add(listener); return () => { this.overrideListeners.delete(listener); }; }
  bindRun(runId: string) { this.local.bindRun(runId); }
  releaseRun(runId: string) { this.local.releaseRun(runId); }
  stop() { this.local.stop('Detenido por el usuario'); }
  pause() { this.local.pause(); }
  resume() { this.local.resume(); }
  adapters() { return this.local.adapters(); }
  policy() { return this.local.policy(); }
  apps() { return this.appSource(); }
  refresh() { return this.local.refresh(); }
}

/* ------------------------------------------------------------------ */

type Bridge = NonNullable<Window['jarvis']>;

class IpcDesktopController implements DesktopController {
  readonly mode = 'ipc' as const;
  readonly local = null;
  private current: ControlStatus = INITIAL;
  private listeners = new Set<(s: ControlStatus) => void>();

  constructor(private readonly bridge: Bridge) {
    bridge.desktop.onStatus((s) => { this.current = s; this.listeners.forEach((l) => l(s)); });
    void this.refresh();
  }

  status() { return this.current; }
  subscribe(listener: (s: ControlStatus) => void) {
    this.listeners.add(listener);
    listener(this.current);
    return () => { this.listeners.delete(listener); };
  }
  onHumanOverride(listener: () => void) { return this.bridge.desktop.onHumanOverride(() => listener()); }
  bindRun(runId: string) { void this.bridge.desktop.bindRun(runId); }
  releaseRun(runId: string) { void this.bridge.desktop.releaseRun(runId); }
  stop() { void this.bridge.desktop.stop(); }
  pause() { void this.bridge.desktop.pause(); }
  resume() { void this.bridge.desktop.resume(); }
  apps() { return this.bridge.desktop.apps(); }
  async refresh() { this.current = await this.bridge.desktop.status(); this.listeners.forEach((l) => l(this.current)); return this.current; }

  /** Main is the authority for desktop tools; the renderer has no local policy. */
  policy() { return null; }

  adapters(getLevel: () => string, getRunId: () => string): AdapterMap {
    const tools = this.bridge.desktopTools;
    const map: AdapterMap = {};
    for (const toolId of Object.keys(tools) as (keyof typeof tools)[]) {
      map[toolId as ToolId] = async (args: never) => {
        const result = await tools[toolId](getLevel(), getRunId(), args);
        if (!result.ok) throw new Error(result.error ?? 'El proceso principal rechazó la acción.');
        return result.data;
      };
    }
    return map;
  }
}

/* ------------------------------------------------------------------ */

const bridge = typeof window !== 'undefined' ? window.jarvis : undefined;

export const desktopController: DesktopController = bridge?.desktop && bridge.desktopTools
  ? new IpcDesktopController(bridge)
  : new LocalDesktopController(new UnavailableAutomationAdapter());

/** Harness seam. Only the in-process controller accepts a different adapter. */
export async function useLocalDesktopAdapter(adapter: WindowsAutomationAdapter, apps: DiscoveredApp[] = [], human: HumanInputSource | null = null): Promise<boolean> {
  if (!(desktopController instanceof LocalDesktopController)) return false;
  await desktopController.useAdapter(adapter, apps, human);
  return true;
}
