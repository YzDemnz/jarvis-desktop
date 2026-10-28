import type { DesktopControlService } from '../../src/desktop/DesktopControlService';
import { UnavailableAutomationAdapter } from '../../src/desktop/adapter';
import { WindowsHelperBridge } from './WindowsHelperBridge';
import type { BridgeOptions } from './WindowsHelperBridge';

/**
 * Connects the native helper to desktop control and keeps them in step for the
 * whole session: helper up → the bridge is the adapter and the human-input
 * source; helper down → the unavailable adapter, so every capability reports
 * UNAVAILABLE instead of failing call by call; helper restarted → the bridge
 * again.
 *
 * Kept free of Electron imports so the lifecycle is testable against a real
 * helper process.
 */
export function wireHelper(desktop: DesktopControlService, options: BridgeOptions): WindowsHelperBridge {
  const bridge: WindowsHelperBridge = new WindowsHelperBridge({
    ...options,
    onStateChange: (alive) => {
      void desktop.useAdapter(alive ? bridge : new UnavailableAutomationAdapter('El helper de automatización se detuvo.'));
      desktop.human.useSource(alive ? bridge : null);
      options.onStateChange?.(alive);
    },
  });
  void bridge.start();
  return bridge;
}
