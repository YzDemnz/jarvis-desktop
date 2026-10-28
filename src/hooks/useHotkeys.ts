import { useEffect, useRef } from 'react';
import { useUIStore } from '@/stores/useUIStore';
import { useTabsStore } from '@/stores/useTabsStore';
import { useJarvisStore } from '@/stores/useJarvisStore';
import { useWorkspaceStore } from '@/stores/useWorkspaceStore';

function inEditable(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el) return false;
  return el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable;
}

/**
 * Renderer-side shortcut layer. Combos come from the settings store so the
 * customisation screen can rebind them without touching this file.
 */
export function useHotkeys(onFocusOmnibox: () => void) {
  const lastEscape = useRef(0);

  useEffect(() => {
    function handler(e: KeyboardEvent) {
      const ui = useUIStore.getState();
      const tabs = useTabsStore.getState();
      const jarvis = useJarvisStore.getState();
      const ws = useWorkspaceStore.getState();
      const mod = e.ctrlKey || e.metaKey;

      // Double Escape halts the agent from anywhere, including inside inputs.
      if (e.key === 'Escape') {
        const now = Date.now();
        if (now - lastEscape.current < 500) {
          jarvis.stop();
          lastEscape.current = 0;
          return;
        }
        lastEscape.current = now;
        if (ui.paletteOpen) ui.setPalette(false);
        else if (ui.searchOpen) ui.setSearch(false);
        else if (ui.shortcutsOpen) ui.setShortcuts(false);
        return;
      }

      if (e.altKey && e.code === 'Space') {
        e.preventDefault();
        ui.setPalette(!ui.paletteOpen);
        return;
      }

      if (mod && e.shiftKey) {
        const key = e.key.toLowerCase();
        if (key === 'j') { e.preventDefault(); ui.toggleJarvis(); return; }
        if (key === 'f') { e.preventDefault(); ui.setSearch(true); return; }
        if (key === 'm') { e.preventDefault(); ui.setModule('markets'); return; }
        if (key === 't') { e.preventDefault(); ui.setModule('coding'); return; }
        if (key === 'a') {
          e.preventDefault();
          ui.setJarvisOpen(true);
          jarvis.submit('Analiza lo que hay en pantalla');
          return;
        }
      }

      if (mod && !e.shiftKey) {
        const key = e.key.toLowerCase();
        if (key === 'l') { e.preventDefault(); onFocusOmnibox(); return; }
        if (key === 't') {
          e.preventDefault();
          ui.setModule('browser');
          tabs.open('about:blank', ws.activeId);
          return;
        }
        if (key === 'w' && tabs.activeId) { e.preventDefault(); tabs.close(tabs.activeId); return; }
      }

      if (mod && e.key === 'Tab') {
        e.preventDefault();
        tabs.cycle(e.shiftKey ? -1 : 1);
        return;
      }

      if (inEditable(e.target)) return;
    }

    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onFocusOmnibox]);

  // Alt+Space registered as an OS-level shortcut in the main process.
  useEffect(() => {
    return window.jarvis?.hotkeys.onCommandPalette(() => {
      useUIStore.getState().setPalette(true);
    });
  }, []);

  /**
   * While a real page holds keyboard focus the renderer never sees a keydown:
   * the event belongs to Chromium's process. Main intercepts the shell's combos
   * per tab and hands them back here, so the shortcuts keep working over a page.
   */
  useEffect(() => {
    const bridge = window.jarvis?.hotkeys;
    if (!bridge?.onForwarded) return;
    return bridge.onForwarded((combo) => runCombo(combo, onFocusOmnibox, lastEscape));
  }, [onFocusOmnibox]);
}

function runCombo(combo: string, onFocusOmnibox: () => void, lastEscape: { current: number }) {
  const ui = useUIStore.getState();
  const tabs = useTabsStore.getState();
  const jarvis = useJarvisStore.getState();
  const ws = useWorkspaceStore.getState();

  switch (combo) {
    case 'escape': {
      const now = Date.now();
      if (now - lastEscape.current < 500) {
        jarvis.stop();
        lastEscape.current = 0;
      } else {
        lastEscape.current = now;
      }
      return;
    }
    case 'alt+space':
      ui.setPalette(!ui.paletteOpen);
      return;
    case 'ctrl+l':
      onFocusOmnibox();
      return;
    case 'ctrl+t':
      ui.setModule('browser');
      tabs.open('about:blank', ws.activeId);
      return;
    case 'ctrl+w':
      if (tabs.activeId) tabs.close(tabs.activeId);
      return;
    case 'ctrl+tab':
      tabs.cycle(1);
      return;
    case 'ctrl+shift+tab':
      tabs.cycle(-1);
      return;
    case 'ctrl+shift+j':
      ui.toggleJarvis();
      return;
    case 'ctrl+shift+f':
      ui.setSearch(true);
      return;
    case 'ctrl+shift+m':
      ui.setModule('markets');
      return;
    case 'ctrl+shift+t':
      ui.setModule('coding');
      return;
    case 'ctrl+shift+a':
      ui.setJarvisOpen(true);
      jarvis.submit('Analiza lo que hay en pantalla');
      return;
    default:
      return;
  }
}
