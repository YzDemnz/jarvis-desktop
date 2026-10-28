import { create } from 'zustand';
import type { ControlStatus } from '@/types';
import { desktopController } from '@/services/desktop/desktopControl';

interface DesktopState {
  status: ControlStatus;
  emergencyShortcut: string;
  emergencyError: string | null;
  bound: boolean;
  bind: () => void;
  setEmergencyShortcut: (accelerator: string) => Promise<void>;
}

export const DEFAULT_EMERGENCY_SHORTCUT = 'Control+Alt+Escape';

export const useDesktopStore = create<DesktopState>((set, get) => ({
  status: desktopController.status(),
  emergencyShortcut: DEFAULT_EMERGENCY_SHORTCUT,
  emergencyError: null,
  bound: false,

  bind: () => {
    if (get().bound) return;
    set({ bound: true });
    let last = '';
    desktopController.subscribe((status) => {
      set({ status });
      // Capabilities depend on helper and session; recompute only when those change.
      const key = `${status.helperAvailable}:${status.session}`;
      if (key !== last) {
        last = key;
        void import('./useMachineStore').then(({ useMachineStore }) => useMachineStore.getState().recompute());
      }
    });
    void desktopController.refresh();

    // The emergency shortcut fires in main even when JARVIS is not focused;
    // the renderer only has to make the run agree with what already happened.
    window.jarvis?.desktop?.onEmergencyStop(() => {
      void import('./useJarvisStore').then(({ useJarvisStore }) => useJarvisStore.getState().stop());
    });
  },

  setEmergencyShortcut: async (accelerator) => {
    const bridge = window.jarvis?.desktop;
    if (!bridge) { set({ emergencyError: 'Sólo disponible dentro de la aplicación de escritorio.' }); return; }
    const result = await bridge.setEmergencyShortcut(accelerator);
    set({
      emergencyShortcut: result.accelerator ?? get().emergencyShortcut,
      emergencyError: result.ok ? null : result.error ?? 'No se pudo registrar el atajo.',
    });
  },
}));
