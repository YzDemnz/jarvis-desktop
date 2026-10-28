import type { SystemProfile } from '../../src/types';
export type BootstrapPhase = 'DETECTING' | 'CONNECT_INTELLIGENCE' | 'OFFER_LOCAL' | 'EXTERNAL_ONLY' | 'PLANNING' | 'DOWNLOADING_RUNTIME' | 'DOWNLOADING_MODEL' | 'VERIFYING' | 'STARTING' | 'BENCHMARKING' | 'OPERATIVE' | 'DEGRADED' | 'INTERRUPTED' | 'CANCELLED' | 'FAILED';
export type LocalHealth = 'NOT_INSTALLED' | 'RUNTIME_ONLY' | 'MODEL_ONLY' | 'NOT_VERIFIED' | 'OPERATIVE' | 'DEGRADED' | 'BROKEN' | 'INCOMPATIBLE';
export interface TrustedArtifact {
    url: string;
    size: number;
    sha256: string;
    filename: string;
}
export interface LocalCandidate {
    id: string;
    label: string;
    artifact: TrustedArtifact;
    license: string;
    source: string;
    ramBytes: number;
    context: number;
    capabilities: string[];
    priority: number;
    limitations: string[];
}
export interface RuntimeCatalog {
    id: string;
    release: string;
    os: string;
    arch: string;
    acceleration: 'cpu';
    license: string;
    artifact: TrustedArtifact;
    assets: {
        file: string;
        sha256: string;
    }[];
}
export interface LocalPlan {
    catalogVersion: number;
    candidateId: string;
    runtimeId: string;
    location: string;
    requiredDiskBytes: number;
    reason: string;
    acceleration: 'cpu';
    alternatives: string[];
}
export interface Probe {
    correct: boolean;
    stable: boolean;
    latencyMs: number;
    startMs: number | null;
    firstTokenMs: number | null;
    tokensPerSecond: number | null;
    outputTokens: number | null;
    ramBytes: number | null;
    vramBytes: number | null;
    contextTested: number;
    at: number;
    rating: 'USABLE' | 'SLOW' | 'FAILED';
    error: string | null;
}
export interface BootstrapSnapshot {
    kind: 'JARVIS_BOOTSTRAP';
    version: 1;
    taskId: string;
    revision: number;
    phase: BootstrapPhase;
    localHealth: LocalHealth;
    intelligenceRole: 'BOOTSTRAP_INTELLIGENCE' | 'SPECIALIST' | null;
    externalProviderId: string | null;
    externalModel?: string | null;
    localChoice: 'accepted' | 'declined' | null;
    candidateId: string | null;
    plan: LocalPlan | null;
    existingLocalModel?: string | null;
    installRoot?: string;
    hardware: SystemProfile | null;
    benchmark: Probe | null;
    progress: {
        artifact: string;
        received: number;
        total: number;
    } | null;
    receipts: {
        effectId: string;
        kind: string;
        sha256: string;
        at: number;
    }[];
    failure: string | null;
    // A preference, never an authority/policy grant. Specialists remain connected.
    routing: {
        general: string | null;
        coding: string | null;
        reasoning: string | null;
    };
    updatedAt: number;
}
export interface BootstrapJournal {
    read(): BootstrapSnapshot | null;
    write(state: BootstrapSnapshot): void;
    operation(id: string, value: unknown): void;
    effect(id: string, value: unknown): void;
    benchmark(fingerprint: string, model: string, value: Probe): void;
}
export const ACTIVE_PHASES: BootstrapPhase[] = ['DETECTING', 'PLANNING', 'DOWNLOADING_RUNTIME', 'DOWNLOADING_MODEL', 'VERIFYING', 'STARTING', 'BENCHMARKING'];
