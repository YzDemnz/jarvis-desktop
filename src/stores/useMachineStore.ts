import { create } from 'zustand';
import type {
  BenchmarkResult, Capability, FirstRunConfig, FirstRunStep, HardwareChange, LocalAIState,
  MachinePerformanceProfile, ModelRecommendation, OSIdentity, PermissionLevel, SessionPolicy, SystemProfile,
} from '@/types';
import { FirstRunManager, LocalStorageConfigStore } from '@/machine/FirstRunManager';
import { capabilityRegistry, summarizeCapabilities } from '@/machine/CapabilityRegistry';
import { computePerformanceProfile } from '@/machine/performance';
import { computeFingerprint, compareFingerprints } from '@/machine/fingerprint';
import { recommendModels } from '@/machine/ModelRecommendationEngine';
import { fixture } from '@/machine/fixtures/machines';
import { useJarvisStore } from './useJarvisStore';
import { desktopController } from '@/services/desktop/desktopControl';

const bridge = typeof window !== 'undefined' ? window.jarvis?.machine : undefined;
export const hasMachineBridge = Boolean(bridge);

const firstRun = new FirstRunManager(new LocalStorageConfigStore());

type Phase = 'idle' | 'loading' | 'ready' | 'error';

interface MachineState {
  identity: OSIdentity | null;
  profile: SystemProfile | null;
  performance: MachinePerformanceProfile | null;
  localAI: LocalAIState | null;
  recommendation: ModelRecommendation | null;
  benchmark: BenchmarkResult | null;
  capabilities: Capability[];
  hardwareChange: HardwareChange | null;
  phase: Phase;
  error: string | null;

  firstRunActive: boolean;
  firstRunStep: FirstRunStep;
  firstRunConfig: FirstRunConfig;

  bind: () => void;
  analyze: (force?: boolean) => Promise<void>;
  discoverLocalAI: () => Promise<void>;
  recompute: () => void;
  runBenchmark: (runtimeId: string, modelId: string) => Promise<void>;
  cancelBenchmark: () => void;
  openOfficialSource: (url: string) => void;
  /** Testing seam: drives the UI from a fixture when there is no bridge. */
  useFixtureProfile: (id: string) => void;

  nextStep: () => void;
  backStep: () => void;
  setPermissionPreset: (p: PermissionLevel) => void;
  setSessionPolicy: (p: SessionPolicy) => void;
  setLocalAIChoice: (c: FirstRunConfig['localAIChoice']) => void;
  finishFirstRun: () => void;
  reconfigure: () => void;
  dismissHardwareChange: (optimize: boolean) => void;
}

export const useMachineStore = create<MachineState>((set, get) => ({
  identity: null,
  profile: null,
  performance: null,
  localAI: null,
  recommendation: null,
  benchmark: null,
  capabilities: [],
  hardwareChange: null,
  phase: 'idle',
  error: null,

  firstRunActive: firstRun.isActive(),
  firstRunStep: firstRun.currentStep(),
  firstRunConfig: firstRun.currentConfig(),

  bind: () => {
    firstRun.subscribe(({ step, config, active }) =>
      set({ firstRunStep: step, firstRunConfig: config, firstRunActive: active }));
    if (window.jarvis?.authority) {
      const mirror = (v: { accessMode: 'FULL' | 'RESTRICTED' }) => { firstRun.setPermissionPreset(v.accessMode); get().recompute(); };
      void window.jarvis.authority.snapshot().then(mirror);
      window.jarvis.authority.onChanged(mirror);
    }
    void get().analyze();
  },

  /**
   * Reads the machine. Without the bridge it falls back to a fixture so every
   * screen stays navigable — and says so, rather than pretending the numbers
   * came from this computer.
   */
  analyze: async (force = false) => {
    set({ phase: 'loading', error: null });
    try {
      if (bridge) {
        const [identity, full] = await Promise.all([bridge.identity(), bridge.profile(force)]);
        const previous = get().firstRunConfig.fingerprint;
        const change = compareFingerprints(previous, full.fingerprint);
        set({
          identity,
          profile: full.profile,
          performance: full.performance,
          hardwareChange: change.significant ? change : null,
          phase: 'ready',
        });
      } else {
        const profile = fixture('C');
        set({
          identity: null,
          profile,
          performance: computePerformanceProfile(profile),
          phase: 'ready',
        });
      }
      get().recompute();
      await get().discoverLocalAI();
    } catch (error) {
      set({ phase: 'error', error: error instanceof Error ? error.message : String(error) });
    }
  },

  discoverLocalAI: async () => {
    try {
      const state = bridge
        ? await bridge.discoverLocalAI()
        : { status: 'NOT_CONFIGURED' as const, runtimes: [], activeRuntimeId: null, routerModelId: null, generalModelId: null, acceleration: 'unknown' as const, discoveredAt: Date.now() };
      set({ localAI: state });

      const profile = get().profile;
      if (profile) {
        const recommendation = bridge
          ? await bridge.recommend()
          : recommendModels({ profile, runtimes: state.runtimes });
        set({ recommendation });
      }
      get().recompute();
    } catch (error) {
      set({ error: error instanceof Error ? error.message : String(error) });
    }
  },

  recompute: () => {
    const { profile, localAI } = get();
    const desktop = desktopController.status();
    set({
      capabilities: capabilityRegistry.evaluate({
        profile,
        localAI,
        permission: useJarvisStore.getState().permission,
        hasNativeBridge: hasMachineBridge,
        // Desktop capabilities follow the real helper and session, live.
        helperAvailable: desktop.helperAvailable,
        sessionInteractive: desktop.session === 'ACTIVE',
      }),
    });
  },

  runBenchmark: async (runtimeId, modelId) => {
    if (!bridge) return;
    try {
      const benchmark = await bridge.benchmark(runtimeId, modelId);
      set({ benchmark });
      const { profile, localAI } = get();
      if (profile && localAI) {
        set({ recommendation: recommendModels({ profile, runtimes: localAI.runtimes, benchmarks: [benchmark] }) });
      }
    } catch (error) {
      set({ error: error instanceof Error ? error.message : String(error) });
    }
  },

  cancelBenchmark: () => { void bridge?.cancelBenchmark(); },

  openOfficialSource: (url) => { void bridge?.openOfficialSource(url); },

  useFixtureProfile: (id) => {
    const profile = fixture(id);
    const localAI = get().localAI;
    set({
      profile,
      performance: computePerformanceProfile(profile),
      recommendation: recommendModels({ profile, runtimes: localAI?.runtimes ?? [] }),
      phase: 'ready',
    });
    get().recompute();
  },

  nextStep: () => { firstRun.next(); },
  backStep: () => { firstRun.back(); },
  setPermissionPreset: (p) => {
    if (!window.jarvis?.authority) firstRun.setPermissionPreset(p);
    useJarvisStore.getState().setPermission(p);
    get().recompute();
  },
  setSessionPolicy: (p) => { firstRun.setSessionPolicy(p); },
  setLocalAIChoice: (c) => { firstRun.setLocalAIChoice(c); },

  finishFirstRun: () => {
    const profile = get().profile;
    if (profile) firstRun.setFingerprint(computeFingerprint(profile));
    firstRun.complete();
    set({ hardwareChange: null });
  },

  reconfigure: () => { firstRun.reconfigure(); },

  dismissHardwareChange: (optimize) => {
    const profile = get().profile;
    if (profile) firstRun.setFingerprint(computeFingerprint(profile));
    set({ hardwareChange: null });
    if (optimize) void get().discoverLocalAI();
  },
}));

export { firstRun, summarizeCapabilities };
