/**
 * Machine intelligence contract. Crosses the process boundary, so everything
 * here stays serialisable.
 *
 * Convention: a field that could not be read cleanly is `null`. Never a guess,
 * never a zero, never an empty string standing in for a real value. The UI
 * renders `null` as "No disponible" and the recommendation engine treats it as
 * a constraint it must be conservative about.
 */

export type Unavailable = null;

/* ------------------------------------------------------------------ */
/* Identity                                                            */
/* ------------------------------------------------------------------ */

/**
 * JARVIS has no account of its own. Identity is borrowed from the operating
 * system profile that launched it, and never leaves the machine.
 */
export interface OSIdentity {
  displayName: string;
  username: string;
  computerName: string;
  homeDirectory: string;
  /** Per-OS-user data root. Two Windows users never share this. */
  userDataDirectory: string;
  platform: NodeJS.Platform | string;
  architecture: string;
}

/* ------------------------------------------------------------------ */
/* System profile                                                      */
/* ------------------------------------------------------------------ */

export interface OSInfo {
  platform: string;
  /** Marketing-ish name: "Windows 11 Pro", "Ubuntu 24.04". */
  name: string | Unavailable;
  version: string | Unavailable;
  build: string | Unavailable;
  architecture: string;
}

export interface CPUInfo {
  manufacturer: string | Unavailable;
  model: string | Unavailable;
  physicalCores: number | Unavailable;
  logicalThreads: number | Unavailable;
  baseClockMHz: number | Unavailable;
  maxClockMHz: number | Unavailable;
  architecture: string;
  /** Instruction-set features worth knowing for inference (avx2, avx512, neon). */
  features: string[];
}

export interface MemoryInfo {
  totalBytes: number | Unavailable;
  availableBytes: number | Unavailable;
  usedBytes: number | Unavailable;
}

export type GPUVendor = 'nvidia' | 'amd' | 'intel' | 'apple' | 'other' | 'unknown';

export interface GPUInfo {
  vendor: GPUVendor;
  model: string | Unavailable;
  /** null when the OS will not say. Never inferred from the model name alone. */
  dedicated: boolean | Unavailable;
  vramBytes: number | Unavailable;
  driverVersion: string | Unavailable;
}

export type DriveKind = 'ssd' | 'hdd' | 'nvme' | 'unknown';

export interface StorageInfo {
  path: string;
  label: string | Unavailable;
  totalBytes: number | Unavailable;
  freeBytes: number | Unavailable;
  filesystem: string | Unavailable;
  kind: DriveKind;
}

export interface DisplayInfo {
  id: string;
  width: number;
  height: number;
  scaleFactor: number;
  primary: boolean;
}

export interface PowerInfo {
  batteryPresent: boolean | Unavailable;
  onAC: boolean | Unavailable;
  batteryPercent: number | Unavailable;
}

export interface SystemProfile {
  os: OSInfo;
  cpu: CPUInfo;
  memory: MemoryInfo;
  gpus: GPUInfo[];
  storage: StorageInfo[];
  displays: DisplayInfo[];
  power: PowerInfo;
  /** How the numbers were obtained, so the UI can be honest about confidence. */
  source: 'windows' | 'linux' | 'darwin' | 'mock' | 'partial';
  collectedAt: number;
  /** Fields the adapter could not read, for diagnostics. */
  unavailable: string[];
}

/* ------------------------------------------------------------------ */
/* Performance and fingerprint                                         */
/* ------------------------------------------------------------------ */

export type MachinePerformanceTier = 'VERY_LOW' | 'LOW' | 'BALANCED' | 'HIGH' | 'EXTREME';

export interface MachinePerformanceProfile {
  tier: MachinePerformanceTier;
  /** 0–100. Internal only — never shown as a grade to the user. */
  score: number;
  breakdown: {
    cpu: number;
    memory: number;
    gpu: number;
    vram: number;
    storage: number;
    architecture: number;
  };
  /** Plain-language notes for Details, not a verdict on the machine. */
  notes: string[];
}

/**
 * Deliberately coarse and non-identifying: model names and bucketed sizes only.
 * No serials, no MACs, no UUIDs, nothing that could single out a machine.
 * Its only job is answering "did the important hardware change?".
 */
export interface HardwareFingerprint {
  version: 1;
  cpuModel: string;
  ramBucketGB: number;
  gpuModels: string[];
  vramBucketGB: number;
  architecture: string;
  hash: string;
}

export interface HardwareChange {
  changed: boolean;
  significant: boolean;
  fields: string[];
}

/* ------------------------------------------------------------------ */
/* Local AI                                                            */
/* ------------------------------------------------------------------ */

export type LocalRuntimeId = 'ollama' | 'llamacpp' | 'lmstudio' | 'openai-compatible';

export type LocalAIStatus = 'READY' | 'NO_MODELS' | 'OFFLINE' | 'NOT_CONFIGURED' | 'ERROR';

export type Acceleration = 'cpu' | 'nvidia' | 'amd' | 'intel' | 'metal' | 'unknown';

export interface LocalRuntimeCapabilities {
  structuredOutput: boolean;
  streaming: boolean;
  embeddings: boolean;
  acceleration: Acceleration[];
}

export interface InstalledModel {
  id: string;
  runtimeId: LocalRuntimeId;
  name: string;
  family: string | Unavailable;
  parameterSize: string | Unavailable;
  quantization: string | Unavailable;
  diskBytes: number | Unavailable;
}

export interface RuntimeDetection {
  runtimeId: LocalRuntimeId;
  name: string;
  detected: boolean;
  status: LocalAIStatus;
  endpoint: string | Unavailable;
  version: string | Unavailable;
  models: InstalledModel[];
  capabilities: LocalRuntimeCapabilities;
  error: string | Unavailable;
  checkedAt: number;
}

export interface LocalAIState {
  status: LocalAIStatus;
  runtimes: RuntimeDetection[];
  /** The runtime currently in use, when one is. */
  activeRuntimeId: LocalRuntimeId | Unavailable;
  routerModelId: string | Unavailable;
  generalModelId: string | Unavailable;
  acceleration: Acceleration;
  discoveredAt: number;
}

/* ------------------------------------------------------------------ */
/* Catalog and recommendation                                          */
/* ------------------------------------------------------------------ */

export type LocalModelTier = 'MICRO' | 'LIGHT' | 'STANDARD' | 'POWER' | 'MAX_LOCAL';

export interface LocalModelEntry {
  id: string;
  displayName: string;
  family: string;
  provider: string;
  runtimes: LocalRuntimeId[];
  tier: LocalModelTier;
  parametersB: number;
  quantization: string;
  diskBytes: number;
  estimatedRamBytes: number;
  /** Bytes needed to run fully on GPU. 0 means it is not worth offloading. */
  estimatedVramBytes: number;
  contextWindow: number;
  /** 0–1 aptitudes. Used for selection, never shown as a score. */
  structuredOutput: number;
  toolRouting: number;
  reasoning: number;
  coding: number;
  vision: boolean;
  /** 0–100, how good a default router this is. */
  routerScore: number;
  supportedOS: string[];
  supportedArchitecture: string[];
  supportedAcceleration: Acceleration[];
  officialSource: string;
  downloadPage: string;
  pullCommand: string | Unavailable;
}

export type CompatibilityVerdict = 'compatible' | 'tight' | 'incompatible';

export interface ModelCompatibility {
  modelId: string;
  verdict: CompatibilityVerdict;
  fitsRam: boolean;
  fitsVram: boolean;
  fitsDisk: boolean;
  acceleration: Acceleration;
  reasons: string[];
}

export interface ResourceBudget {
  totalRamBytes: number | Unavailable;
  systemReserveBytes: number;
  appReserveBytes: number;
  safeAIRamBytes: number;
  totalVramBytes: number | Unavailable;
  vramReserveBytes: number;
  safeAIVramBytes: number;
  freeDiskBytes: number | Unavailable;
  safeDiskBytes: number;
  notes: string[];
}

export type ExpectedPerformance = 'EXCELLENT' | 'GOOD' | 'USABLE' | 'SLOW' | 'NOT_RECOMMENDED';

export interface ModelRecommendation {
  /** null when nothing in the catalog fits this machine. */
  router: LocalModelEntry | Unavailable;
  generalModel: LocalModelEntry | Unavailable;
  runtimeId: LocalRuntimeId | Unavailable;
  acceleration: Acceleration;
  expectedPerformance: ExpectedPerformance;
  alternatives: LocalModelEntry[];
  compatibility: ModelCompatibility[];
  budget: ResourceBudget;
  /** Already installed, so nothing needs downloading. */
  alreadyInstalled: boolean;
  reason: string;
}

/* ------------------------------------------------------------------ */
/* Benchmark                                                           */
/* ------------------------------------------------------------------ */

export type BenchmarkRating = 'EXCELLENT' | 'GOOD' | 'USABLE' | 'SLOW' | 'NOT_RECOMMENDED';

export interface BenchmarkResult {
  modelId: string;
  runtimeId: LocalRuntimeId;
  available: boolean;
  timeToFirstTokenMs: number | Unavailable;
  tokensPerSecond: number | Unavailable;
  structuredOutputSuccess: boolean;
  completionSuccess: boolean;
  ramDeltaBytes: number | Unavailable;
  vramDeltaBytes: number | Unavailable;
  rating: BenchmarkRating;
  cancelled: boolean;
  error: string | Unavailable;
  ranAt: number;
}

/* ------------------------------------------------------------------ */
/* Capabilities                                                        */
/* ------------------------------------------------------------------ */

export type CapabilityId =
  | 'filesystem.read' | 'filesystem.search' | 'filesystem.write' | 'filesystem.delete'
  | 'browser.navigate' | 'browser.inspect' | 'browser.automate'
  | 'applications.discover' | 'applications.launch'
  | 'screen.capture' | 'uiAutomation'
  | 'mouse.control' | 'keyboard.control'
  | 'clipboard.read' | 'clipboard.write'
  | 'terminal.execute'
  | 'git'
  | 'localAI' | 'localAI.gpuAcceleration';

export type CapabilityState = 'AVAILABLE' | 'RESTRICTED' | 'DISABLED' | 'UNAVAILABLE';

export interface Capability {
  id: CapabilityId;
  label: string;
  description: string;
  state: CapabilityState;
  /** Why it is not simply AVAILABLE. */
  reason: string | Unavailable;
  /** Permission level the user must grant for this to become usable. */
  requiredPermission: import('./agent').PermissionLevel;
}

/* ------------------------------------------------------------------ */
/* First run                                                           */
/* ------------------------------------------------------------------ */

export type FirstRunStep =
  | 'welcome' | 'system' | 'localAI' | 'recommendation'
  | 'access' | 'privacy' | 'ready';

export type SessionPolicy = 'keep' | 'clear_on_exit';

export interface FirstRunConfig {
  completed: boolean;
  completedAt: number | Unavailable;
  version: number;
  permissionPreset: import('./agent').PermissionLevel;
  sessionPolicy: SessionPolicy;
  localAIChoice: 'configured' | 'skipped' | Unavailable;
  fingerprint: HardwareFingerprint | Unavailable;
}

/* ------------------------------------------------------------------ */
/* Machine context for the agent                                       */
/* ------------------------------------------------------------------ */

export type ContextTopic = 'hardware' | 'localAI' | 'filesystem' | 'browser' | 'none';

export interface MachineContext {
  topics: ContextTopic[];
  /** Compact, human-readable lines. What actually reaches a prompt. */
  lines: string[];
  /** Rough token cost, so callers can see the saving. */
  approxTokens: number;
}
