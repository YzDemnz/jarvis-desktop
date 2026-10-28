import type { FirstRunConfig, FirstRunStep, HardwareFingerprint, PermissionLevel, SessionPolicy } from '@/types';

export const FIRST_RUN_VERSION = 1;

export const FIRST_RUN_STEPS: FirstRunStep[] = [
  'welcome', 'system', 'localAI', 'recommendation', 'access', 'privacy', 'ready',
];

/** Storage is injected so the manager runs in the renderer, in main and in tests. */
export interface ConfigStore {
  read(): FirstRunConfig | null;
  write(config: FirstRunConfig): void;
  clear(): void;
}

export const DEFAULT_CONFIG: FirstRunConfig = {
  completed: false,
  completedAt: null,
  version: FIRST_RUN_VERSION,
  permissionPreset: 'FULL',
  sessionPolicy: 'keep',
  localAIChoice: null,
  fingerprint: null,
};

export class LocalStorageConfigStore implements ConfigStore {
  constructor(private readonly key = 'jarvis.firstRun') {}

  read(): FirstRunConfig | null {
    try {
      const raw = localStorage.getItem(this.key);
      if (!raw) return null;
      const parsed: unknown = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
      // A config from the future or a corrupt one is treated as absent rather
      // than merged, so a bad payload cannot silently grant permissions.
      const value = parsed as Partial<FirstRunConfig>;
      if (typeof value.completed !== 'boolean') return null;
      return { ...DEFAULT_CONFIG, ...value, version: FIRST_RUN_VERSION };
    } catch {
      return null;
    }
  }

  write(config: FirstRunConfig): void {
    try {
      localStorage.setItem(this.key, JSON.stringify(config));
    } catch {
      // A full or blocked storage must not break onboarding.
    }
  }

  clear(): void {
    try { localStorage.removeItem(this.key); } catch { /* nothing to do */ }
  }
}

/**
 * Owns "is this the first time?" and the ordered walk through onboarding.
 * Reconfiguring later is the same walk, so there is only one code path.
 */
const VALID_PRESETS: PermissionLevel[] = ['FULL', 'RESTRICTED'];
const VALID_POLICIES: SessionPolicy[] = ['keep', 'clear_on_exit'];

export function normalizeConfig(raw: FirstRunConfig | null | undefined): FirstRunConfig {
  if (!raw || typeof raw !== 'object') return { ...DEFAULT_CONFIG };
  const preset = VALID_PRESETS.includes(raw.permissionPreset) ? raw.permissionPreset : 'RESTRICTED';
  const policy = VALID_POLICIES.includes(raw.sessionPolicy) ? raw.sessionPolicy : DEFAULT_CONFIG.sessionPolicy;
  return {
    ...DEFAULT_CONFIG,
    ...raw,
    completed: raw.completed === true,
    permissionPreset: preset,
    sessionPolicy: policy,
    version: FIRST_RUN_VERSION,
  };
}

export class FirstRunManager {
  private config: FirstRunConfig;
  private step: FirstRunStep = 'welcome';
  private listeners = new Set<(state: { step: FirstRunStep; config: FirstRunConfig; active: boolean }) => void>();
  private active: boolean;

  constructor(private readonly store: ConfigStore) {
    // Whatever the store hands back is untrusted: a corrupt payload must not be
    // able to leave permissionPreset undefined and have that flow into the
    // permission engine as an unchecked value.
    this.config = normalizeConfig(store.read());
    this.active = !this.config.completed;
  }

  isFirstRun(): boolean {
    return !this.config.completed;
  }

  isActive(): boolean {
    return this.active;
  }

  currentStep(): FirstRunStep {
    return this.step;
  }

  currentConfig(): FirstRunConfig {
    return { ...this.config };
  }

  subscribe(listener: (state: { step: FirstRunStep; config: FirstRunConfig; active: boolean }) => void): () => void {
    this.listeners.add(listener);
    listener(this.snapshot());
    return () => { this.listeners.delete(listener); };
  }

  next(): FirstRunStep {
    const index = FIRST_RUN_STEPS.indexOf(this.step);
    this.step = FIRST_RUN_STEPS[Math.min(index + 1, FIRST_RUN_STEPS.length - 1)]!;
    this.emit();
    return this.step;
  }

  back(): FirstRunStep {
    const index = FIRST_RUN_STEPS.indexOf(this.step);
    this.step = FIRST_RUN_STEPS[Math.max(index - 1, 0)]!;
    this.emit();
    return this.step;
  }

  goTo(step: FirstRunStep): void {
    this.step = step;
    this.emit();
  }

  setPermissionPreset(permissionPreset: PermissionLevel): void {
    this.config = { ...this.config, permissionPreset };
    this.emit();
  }

  setSessionPolicy(sessionPolicy: SessionPolicy): void {
    this.config = { ...this.config, sessionPolicy };
    this.emit();
  }

  setLocalAIChoice(localAIChoice: FirstRunConfig['localAIChoice']): void {
    this.config = { ...this.config, localAIChoice };
    this.emit();
  }

  setFingerprint(fingerprint: HardwareFingerprint | null): void {
    this.config = { ...this.config, fingerprint };
    this.emit();
  }

  complete(): FirstRunConfig {
    this.config = { ...this.config, completed: true, completedAt: Date.now(), version: FIRST_RUN_VERSION };
    this.active = false;
    this.store.write(this.config);
    this.emit();
    return this.currentConfig();
  }

  /** "Reconfigure JARVIS": same walk, keeping what was already chosen. */
  reconfigure(): void {
    this.step = 'welcome';
    this.active = true;
    this.emit();
  }

  /** Only for tests and a genuine factory reset. */
  reset(): void {
    this.store.clear();
    this.config = { ...DEFAULT_CONFIG };
    this.step = 'welcome';
    this.active = true;
    this.emit();
  }

  private snapshot() {
    return { step: this.step, config: this.currentConfig(), active: this.active };
  }

  private emit(): void {
    const snapshot = this.snapshot();
    this.listeners.forEach((l) => l(snapshot));
  }
}
