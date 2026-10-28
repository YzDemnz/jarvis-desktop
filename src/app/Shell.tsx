import { useEffect } from 'react';
import type { RefObject } from 'react';
import { Sidebar } from '@/components/Sidebar';
import { TopBar } from '@/components/TopBar';
import { TabStrip } from '@/components/TabStrip';
import { ApprovalDialog } from '@/components/ApprovalDialog';
import { JarvisDock, JarvisPanel } from '@/features/jarvis/JarvisPanel';
import { CommandPalette } from '@/features/commandPalette/CommandPalette';
import { UniversalSearch } from '@/features/search/UniversalSearch';
import { useUIStore } from '@/stores/useUIStore';
import { useTabsStore } from '@/stores/useTabsStore';
import { useJarvisStore } from '@/stores/useJarvisStore';
import { MODULES } from './moduleRegistry';
import { ErrorBoundary } from './ErrorBoundary';
import { FirstRunOverlay, HardwareChangeBanner } from '@/features/firstRun/FirstRunOverlay';
import { useMachineStore } from '@/stores/useMachineStore';
import { useDesktopStore } from '@/stores/useDesktopStore';
import { ComputerControlIndicator } from '@/features/desktop/ComputerControlIndicator';

export function Shell({ omniboxRef }: { omniboxRef: RefObject<HTMLInputElement> }) {
  const module = useUIStore((s) => s.module);
  const bindBrowser = useTabsStore((s) => s.bind);
  const bindAgent = useJarvisStore((s) => s.bind);
  const bindMachine = useMachineStore((s) => s.bind);
  const bindDesktop = useDesktopStore((s) => s.bind);
  // Persisted state can name a module that no longer exists; falling back to
  // Home beats rendering nothing at all.
  const entry = MODULES[module] ?? MODULES.home;
  const View = entry.component;

  // Mirror the main process's tab state from the first frame, so the tab strip
  // and JARVIS know what is open even before the browser module is visited.
  useEffect(() => { bindBrowser(); }, [bindBrowser]);

  // Subscribing at mount is what makes approvals and the audit trail live from
  // the first frame, not only once the first prompt is sent.
  useEffect(() => { bindAgent(); }, [bindAgent]);

  // Machine analysis runs once at mount; onboarding needs it to be ready.
  useEffect(() => { bindMachine(); }, [bindMachine]);

  // Desktop control status must be live before the agent can ever act, so
  // the indicator is never behind the input layer.
  useEffect(() => { bindDesktop(); }, [bindDesktop]);

  return (
    <div className="h-full flex overflow-hidden">
      <Sidebar />

      <div className="flex-1 min-w-0 flex flex-col">
        <HardwareChangeBanner />
        <ErrorBoundary label="Indicador de control"><ComputerControlIndicator /></ErrorBoundary>
        <TopBar omniboxRef={omniboxRef} />
        {entry.showTabs && <TabStrip />}

        <div className="flex-1 min-h-0 flex">
          <main className="flex-1 min-w-0 bg-panel/40">
            <ErrorBoundary label={entry.label} key={module}><View /></ErrorBoundary>
          </main>
          <ErrorBoundary label="El panel de JARVIS"><JarvisPanel /></ErrorBoundary>
        </div>
      </div>

      <JarvisDock />
      <ErrorBoundary label="La paleta de comandos"><CommandPalette /></ErrorBoundary>
      <ErrorBoundary label="La búsqueda universal"><UniversalSearch /></ErrorBoundary>
      <ApprovalDialog />
      <ErrorBoundary label="La configuración inicial"><FirstRunOverlay /></ErrorBoundary>
    </div>
  );
}
