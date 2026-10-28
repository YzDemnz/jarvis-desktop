import type { DesktopSnapshot, WindowInfo } from '@/types';
import type { WindowsAutomationAdapter } from './adapter';

/**
 * What is on screen, as data. Enough to answer "VS Code is open on monitor 2"
 * without taking a single screenshot.
 */
export class DesktopSnapshotService {
  constructor(private adapter: WindowsAutomationAdapter) {}
  useAdapter(adapter: WindowsAutomationAdapter): void { this.adapter = adapter; }

  async snapshot(controlAvailable: boolean): Promise<DesktopSnapshot> {
    const [session, windows, active, monitors, cursor] = await Promise.all([
      this.adapter.sessionState().catch(() => 'UNKNOWN' as const),
      this.adapter.listWindows().catch(() => [] as WindowInfo[]),
      this.adapter.activeWindow().catch(() => null),
      this.adapter.monitors().catch(() => []),
      this.adapter.cursor().catch(() => null),
    ]);
    return {
      session,
      activeWindow: active,
      visibleWindows: windows.filter((w) => w.visible && w.state !== 'minimized'),
      monitors,
      cursor,
      controlAvailable,
      capturedAt: Date.now(),
    };
  }

  /** One line per window, for the agent's context. */
  static describe(snapshot: DesktopSnapshot): string[] {
    const lines = snapshot.visibleWindows.map((w) =>
      `${w.title} (${w.processName}) en el monitor ${(w.monitor ?? 0) + 1}${w.focused ? ', con el foco' : ''}`);
    if (!lines.length) lines.push('No hay ventanas visibles.');
    return lines;
  }
}
