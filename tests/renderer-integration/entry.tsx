import { createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from '@/app/App';
import { ErrorBoundary } from '@/app/ErrorBoundary';
import { useJarvisStore } from '@/stores/useJarvisStore';
import { useUIStore } from '@/stores/useUIStore';
import { useTabsStore } from '@/stores/useTabsStore';
import { useWorkspaceStore } from '@/stores/useWorkspaceStore';
import { useSettingsStore } from '@/stores/useSettingsStore';
import { useMachineStore } from '@/stores/useMachineStore';
import { MACHINE_FIXTURES } from '@/machine/fixtures/machines';
import { machineContextBuilder } from '@/machine/MachineContextBuilder';
import { agentRuntime, toolBroker, approvalEngine, auditService } from '@/services/agent/runtime';
import { useDesktopStore } from '@/stores/useDesktopStore';
import { desktopController, useLocalDesktopAdapter } from '@/services/desktop/desktopControl';
import { FakeWindowsAutomationAdapter, fixtureApps } from '@/desktop/FakeWindowsAutomationAdapter';
import { ManualHumanInputSource } from '@/desktop/HumanOverrideDetector';
import { createDevHarness } from './devHarness';
import { useDevStore } from '@/stores/useDevStore';
import { devController } from '@/services/dev/devController';
import './harness.css';

/**
 * Harness entry. Deliberately mirrors src/main.tsx minus StrictMode: React's
 * double-invoke in StrictMode would make listener-leak assertions ambiguous,
 * and leak detection is one of the things this harness exists to prove.
 *
 * Everything below App is production code, unmodified.
 */
const container = document.getElementById('root');
if (!container) throw new Error('falta #root');

let root = createRoot(container);
root.render(<App />);

// Handles the harness uses to mount/unmount and to reach the real stores.
declare global {
  interface Window {
    __harness: Record<string, unknown>;
  }
}

// Handles for the integration assertions. These reach the SAME singletons the
// UI uses, so a test can observe the real runtime rather than a copy.
window.__harness = {
  unmount: () => root.unmount(),
  // React forbids render() on an unmounted root, so a remount is a fresh root —
  // which is also the harsher test: global listeners must not accumulate.
  remount: () => { root = createRoot(container); root.render(<App />); },
  stores: { useJarvisStore, useUIStore, useTabsStore, useWorkspaceStore, useSettingsStore, useMachineStore, useDesktopStore, useDevStore },
  // Windows-only readings are supplied as fixtures rather than faked: a Linux
  // container pretending to be Windows would make every assertion worthless.
  fixtures: MACHINE_FIXTURES,
  machineContext: machineContextBuilder,
  agent: { agentRuntime, toolBroker, approvalEngine, auditService },
  ErrorBoundary,
  React: { createRoot, createElement },
  // Windows double. Installed on demand: until then the app runs exactly as it
  // would on a machine without the native helper (control UNAVAILABLE).
  // Developer agent over in-memory Windows-flavoured ports. Installed on demand;
  // until then Projects/Coding show the honest "needs the desktop app" state.
  dev: {
    controller: () => devController(),
    install: async () => {
      const h = createDevHarness();
      (window.__harness as Record<string, unknown>).devh = h;
      return h.install();
    },
  },
  desktop: {
    controller: desktopController,
    install: async (apps?: string[]) => {
      const fake = new FakeWindowsAutomationAdapter(apps);
      const human = new ManualHumanInputSource();
      await useLocalDesktopAdapter(fake, fixtureApps(), human);
      (window.__harness.desktop as Record<string, unknown>).fake = fake;
      (window.__harness.desktop as Record<string, unknown>).human = human;
      return true;
    },
  },
};
