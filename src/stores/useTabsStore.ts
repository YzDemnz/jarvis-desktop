import { create } from 'zustand';
import type { BrowserProfileId, BrowserTab, ViewportRect } from '@/types';
import { browserService, hasRealBrowser } from '@/services/browser';

/**
 * A mirror, not a source of truth. The main process owns every tab; this store
 * holds the last snapshot it pushed and forwards commands back. That is what
 * keeps the UI honest: what you see is what Chromium actually has.
 */
interface TabsState {
  tabs: BrowserTab[];
  activeId: string | null;
  ready: boolean;
  profileId: BrowserProfileId;
  bound: boolean;

  /** Subscribes to main and pulls the first snapshot. Idempotent. */
  bind: () => void;
  apply: (tabs: BrowserTab[], activeId: string | null) => void;

  open: (url: string, workspaceId: string, profileId?: BrowserProfileId) => void;
  close: (id: string) => void;
  activate: (id: string) => void;
  navigate: (id: string, input: string) => void;
  reload: (id: string) => void;
  stop: (id: string) => void;
  back: (id: string) => void;
  forward: (id: string) => void;
  togglePin: (id: string) => void;
  setProfile: (id: string, profileId: BrowserProfileId) => void;
  setDefaultProfile: (profileId: BrowserProfileId) => void;
  cycle: (dir: 1 | -1) => void;
  active: () => BrowserTab | undefined;

  setBounds: (rect: ViewportRect) => void;
  setVisible: (visible: boolean) => void;
}

export const useTabsStore = create<TabsState>((set, get) => ({
  tabs: [],
  activeId: null,
  ready: false,
  profileId: 'personal',
  bound: false,

  bind: () => {
    if (get().bound) return;
    set({ bound: true });
    browserService.subscribe((snapshot) => {
      set({ tabs: snapshot.tabs, activeId: snapshot.activeId, ready: true });
    });
    void browserService.snapshot().then((snapshot) => {
      set({ tabs: snapshot.tabs, activeId: snapshot.activeId, ready: true });
    });
  },

  apply: (tabs, activeId) => set({ tabs, activeId, ready: true }),

  open: (url, workspaceId, profileId) => {
    void browserService.create(url, workspaceId, profileId ?? get().profileId);
  },
  close: (id) => { void browserService.close(id); },
  activate: (id) => { void browserService.activate(id); },
  navigate: (id, input) => { void browserService.navigate(id, input); },
  reload: (id) => { void browserService.reload(id); },
  stop: (id) => { void browserService.stop(id); },
  back: (id) => { void browserService.back(id); },
  forward: (id) => { void browserService.forward(id); },

  togglePin: (id) => {
    const tab = get().tabs.find((t) => t.id === id);
    if (!tab) return;
    void browserService.setPinned(id, !tab.pinned);
  },

  setProfile: (id, profileId) => { void browserService.setProfile(id, profileId); },
  setDefaultProfile: (profileId) => set({ profileId }),

  cycle: (dir) => {
    const { tabs, activeId } = get();
    if (!tabs.length) return;
    const index = tabs.findIndex((t) => t.id === activeId);
    const next = tabs[(index + dir + tabs.length) % tabs.length];
    if (next) void browserService.activate(next.id);
  },

  active: () => {
    const { tabs, activeId } = get();
    return tabs.find((t) => t.id === activeId);
  },

  setBounds: (rect) => { void browserService.setBounds(rect); },
  setVisible: (visible) => { void browserService.setVisible(visible); },
}));

export { hasRealBrowser };
