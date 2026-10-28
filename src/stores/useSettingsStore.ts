import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { ModelTier, PermissionLevel, ProviderId } from '@/types';

export interface ShortcutBinding {
  id: string;
  label: string;
  combo: string;
  scope: 'global' | 'app';
  editable: boolean;
}

export const DEFAULT_SHORTCUTS: ShortcutBinding[] = [
  { id: 'palette', label: 'Command Palette', combo: 'Alt+Space', scope: 'global', editable: true },
  { id: 'omnibox', label: 'Enfocar la barra', combo: 'Ctrl+L', scope: 'app', editable: true },
  { id: 'newTab', label: 'Nueva pestaña', combo: 'Ctrl+T', scope: 'app', editable: true },
  { id: 'closeTab', label: 'Cerrar pestaña', combo: 'Ctrl+W', scope: 'app', editable: true },
  { id: 'nextTab', label: 'Siguiente pestaña', combo: 'Ctrl+Tab', scope: 'app', editable: false },
  { id: 'jarvis', label: 'Abrir o cerrar JARVIS', combo: 'Ctrl+Shift+J', scope: 'app', editable: true },
  { id: 'search', label: 'Búsqueda universal', combo: 'Ctrl+Shift+F', scope: 'app', editable: true },
  { id: 'analyze', label: 'Analizar la pantalla', combo: 'Ctrl+Shift+A', scope: 'app', editable: true },
  { id: 'terminal', label: 'Terminal con IA', combo: 'Ctrl+Shift+T', scope: 'app', editable: true },
  { id: 'markets', label: 'Ir a Markets', combo: 'Ctrl+Shift+M', scope: 'app', editable: true },
  { id: 'stop', label: 'Detener el agente', combo: 'Esc Esc', scope: 'app', editable: false },
];

export type SettingsSection =
  | 'general' | 'system' | 'localai' | 'appearance' | 'providers' | 'models' | 'routing'
  | 'permissions' | 'shortcuts' | 'browser' | 'storage' | 'vault'
  | 'privacy' | 'updates' | 'developer';

interface SettingsState {
  section: SettingsSection;
  density: 'compact' | 'comfortable';
  accent: string;
  reduceMotion: boolean;
  startModule: string;
  defaultPermission: PermissionLevel;
  routerEnabled: boolean;
  routerModel: string;
  tierOverrides: Record<ModelTier, ProviderId | 'auto'>;
  telemetry: boolean;
  searchEngine: string;
  blockTrackers: boolean;
  shortcuts: ShortcutBinding[];
  devMode: boolean;

  setSection: (s: SettingsSection) => void;
  patch: (p: Partial<Omit<SettingsState, 'patch' | 'setSection' | 'setShortcut'>>) => void;
  setShortcut: (id: string, combo: string) => void;
}

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      section: 'general',
      density: 'comfortable',
      accent: '#79A9FF',
      reduceMotion: false,
      startModule: 'home',
      defaultPermission: 'ASSIST',
      routerEnabled: true,
      routerModel: 'local/router',
      tierOverrides: { LOCAL: 'local', FAST: 'auto', STANDARD: 'auto', REASONING: 'anthropic', MAX: 'auto' },
      telemetry: false,
      searchEngine: 'DuckDuckGo',
      blockTrackers: true,
      shortcuts: DEFAULT_SHORTCUTS,
      devMode: false,

      setSection: (section) => set({ section }),
      patch: (p) => set(p as never),
      setShortcut: (id, combo) =>
        set((s) => ({ shortcuts: s.shortcuts.map((x) => (x.id === id ? { ...x, combo } : x)) })),
    }),
    { name: 'jarvis.settings' },
  ),
);
