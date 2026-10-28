import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import catalogData from './trusted-catalog.json';
import type { BootstrapJournal, BootstrapSnapshot, BootstrapPhase, LocalCandidate, RuntimeCatalog, Probe } from './contracts';
import { ACTIVE_PHASES } from './contracts';
import type { SystemProfile } from '../../src/types';
import { ArtifactInstaller, contained, sha256 } from './ArtifactInstaller';
import { adviseLocal } from './LocalAdvisor';
import { validateBootstrapInferencePolicy } from './LocalRuntime';
import type { BootstrapRuntime, BootstrapInferencePolicy, BootstrapInferenceMetrics } from './LocalRuntime';
export const BOOTSTRAP_TASK = 'jarvis:bootstrap:v1';
export const TRUSTED_RUNTIME = catalogData.runtime as RuntimeCatalog;
export const TRUSTED_MODELS = catalogData.models as LocalCandidate[];
export class BootstrapController {
    private state: BootstrapSnapshot;
    private active: AbortController | null = null;
    private work: Promise<BootstrapSnapshot> | null = null;
    private answering = false;
    constructor(private readonly journal: BootstrapJournal, private installer: ArtifactInstaller, private readonly runtime: BootstrapRuntime, private readonly profile: () => Promise<SystemProfile>, private readonly gate: () => void = () => { }) {
        this.state = journal.read() ?? { kind: 'JARVIS_BOOTSTRAP', version: 1, taskId: BOOTSTRAP_TASK, revision: 0, phase: 'DETECTING', localHealth: 'NOT_INSTALLED', intelligenceRole: null, externalProviderId: null, localChoice: null, candidateId: null, plan: null, hardware: null, benchmark: null, progress: null, receipts: [], failure: null, routing: { general: null, coding: null, reasoning: null }, updatedAt: Date.now() };
        if (this.state.kind !== 'JARVIS_BOOTSTRAP' || this.state.version !== 1)
            throw Error('BOOTSTRAP_STATE_INVALID');
        if (ACTIVE_PHASES.includes(this.state.phase) && this.state.revision > 0)
            this.update({ phase: 'INTERRUPTED', failure: 'RESTART_REQUIRES_EXPLICIT_RESUME', progress: null });
    }
    snapshot(): BootstrapSnapshot { return structuredClone(this.state); }
    diagnostics() { return this.runtime.diagnostics?.() ?? { pid: null, ownership: null }; }
    relocate(installer: ArtifactInstaller) {
        if (this.work || this.answering)
            throw Error('BOOTSTRAP_BUSY');
        if (installer.root === this.installer.root)
            return;
        this.installer = installer;
        this.update({ installRoot: installer.root, candidateId: null, existingLocalModel: null, benchmark: null, plan: null, localHealth: 'NOT_INSTALLED', phase: 'CONNECT_INTELLIGENCE', failure: null, routing: { ...this.state.routing, general: this.state.externalProviderId } });
        this.journal.operation(randomUUID(), { kind: 'BOOTSTRAP_LOCATION', root: installer.root, status: 'OWNER_SELECTED', at: Date.now() });
    }
    discoveredExisting(runtime: boolean, model: boolean) {
        if (this.work || this.state.candidateId || ['OPERATIVE', 'DEGRADED'].includes(this.state.localHealth))
            return;
        if (runtime)
            this.update({ localHealth: model ? 'NOT_VERIFIED' : 'RUNTIME_ONLY' });
    }
    setExternalModel(model: string) { this.update({ externalModel: model }); }
    adoptExisting(model: string, benchmark: Probe) {
        this.journal.benchmark(JSON.stringify({ cpu: this.state.hardware?.cpu.model, ram: this.state.hardware?.memory.totalBytes }), 'ollama:' + model, benchmark);
        this.journal.operation(randomUUID(), { kind: 'BOOTSTRAP_EXISTING_LOCAL', model, status: 'INFERENCE_VERIFIED', at: Date.now() });
        this.update({ candidateId: null, existingLocalModel: model, benchmark, localHealth: benchmark.rating === 'SLOW' ? 'DEGRADED' : 'OPERATIVE', phase: benchmark.rating === 'SLOW' ? 'DEGRADED' : 'OPERATIVE', routing: { ...this.state.routing, general: 'ollama-local' }, intelligenceRole: this.state.externalProviderId ? 'SPECIALIST' : null });
    }
    private update(change: Partial<BootstrapSnapshot>) { this.state = { ...this.state, ...change, revision: this.state.revision + 1, updatedAt: Date.now() }; this.journal.write(this.snapshot()); }
    private phase(phase: BootstrapPhase) { this.guard(); this.update({ phase, progress: null }); }
    private guard() { this.active?.signal.throwIfAborted(); this.gate(); }
    externalObserved(providerId: string) {
        // Main calls this only after an observed inference, never a model statement
        // or an authentication/detection event. No policy or authority mutation.
        if (!['codex-app-server', 'openai-api', 'claude-api', 'gemini-api', 'grok-api', 'groq-api', 'openrouter-api'].includes(providerId))
            throw Error('BOOTSTRAP_PROVIDER_UNKNOWN');
        const local = this.state.localHealth === 'OPERATIVE' || this.state.localHealth === 'DEGRADED';
        this.update({ externalProviderId: providerId, intelligenceRole: local ? 'SPECIALIST' : 'BOOTSTRAP_INTELLIGENCE', phase: local ? this.state.phase : 'OFFER_LOCAL', routing: { ...this.state.routing, general: local ? this.state.routing.general : providerId, coding: providerId, reasoning: providerId } });
    }
    externalDisconnected(providerId: string) { if (this.state.externalProviderId === providerId) {
        const routing = { ...this.state.routing };
        for (const key of ['general', 'coding', 'reasoning'] as const)
            if (routing[key] === providerId)
                routing[key] = null;
        this.update({ externalProviderId: null, intelligenceRole: null, routing, phase: this.state.localHealth === 'OPERATIVE' ? 'OPERATIVE' : this.state.localHealth === 'DEGRADED' ? 'DEGRADED' : this.state.localChoice === 'declined' ? 'EXTERNAL_ONLY' : 'CONNECT_INTELLIGENCE' });
    } }
    decline() { if (this.work)
        throw Error('BOOTSTRAP_BUSY'); this.update({ localChoice: 'declined', phase: 'EXTERNAL_ONLY', failure: null }); return this.snapshot(); }
    async plan(): Promise<BootstrapSnapshot> {
        if (this.work)
            throw Error('BOOTSTRAP_BUSY');
        const hardware = await this.profile();
        const free = fs.statfsSync(this.installer.root);
        const plan = adviseLocal(hardware, TRUSTED_MODELS, TRUSTED_RUNTIME, this.installer.root, free.bavail * free.bsize);
        this.update({ hardware, plan, installRoot:this.installer.root, failure: plan ? null : 'NO_COMPATIBLE_CANDIDATE' });
        return this.snapshot();
    }
    async detect(): Promise<BootstrapSnapshot> {
        if (this.work)
            return this.snapshot();
        const currentHardware = await this.profile();
        if (currentHardware.os.platform !== TRUSTED_RUNTIME.os || currentHardware.os.architecture !== TRUSTED_RUNTIME.arch) {
            this.update({ hardware: currentHardware, localHealth: 'INCOMPATIBLE', phase: 'CONNECT_INTELLIGENCE' });
            return this.snapshot();
        }
        if (this.state.hardware && (this.state.hardware.cpu.model !== currentHardware.cpu.model || this.state.hardware.memory.totalBytes !== currentHardware.memory.totalBytes))
            this.update({ localHealth: 'NOT_VERIFIED', benchmark: null, failure: 'HARDWARE_CHANGED_REQUIRES_PROBE' });
        this.update({ hardware: currentHardware });
        if (this.state.routing.general === 'ollama-local') {
            this.update({ localHealth: 'NOT_VERIFIED', phase: 'CONNECT_INTELLIGENCE', failure: 'EXISTING_RUNTIME_REQUIRES_FRESH_PROBE' });
            return this.snapshot();
        }
        const bin = contained(this.installer.root, 'runtimes/' + TRUSTED_RUNTIME.id), selected = TRUSTED_MODELS.find(c => c.id === this.state.candidateId) ?? TRUSTED_MODELS.find(c => fs.existsSync(contained(this.installer.root, 'cache/' + c.artifact.sha256 + '-' + c.artifact.filename)));
        if (selected && this.state.candidateId !== selected.id)
            this.update({ candidateId: selected.id });
        const model = selected ? contained(this.installer.root, 'cache/' + selected.artifact.sha256 + '-' + selected.artifact.filename) : null;
        if (selected && selected.ramBytes > Math.min((currentHardware.memory.availableBytes ?? 0) - 2 * 1024 ** 3, (currentHardware.memory.totalBytes ?? 0) * 0.65)) {
            this.update({ localHealth: 'INCOMPATIBLE', phase: 'CONNECT_INTELLIGENCE', failure: 'MEMORY_BUDGET_CHANGED' });
            return this.snapshot();
        }
        const runtimeExists = fs.existsSync(path.join(bin, 'llama-server.exe')), modelExists = !!model && fs.existsSync(model);
        if (this.state.hardware && (this.state.hardware.os.platform !== TRUSTED_RUNTIME.os || this.state.hardware.os.architecture !== TRUSTED_RUNTIME.arch)) {
            this.update({ localHealth: 'INCOMPATIBLE', phase: 'CONNECT_INTELLIGENCE' });
            return this.snapshot();
        }
        if (runtimeExists && modelExists && selected && model) {
            if (this.state.benchmark?.correct && this.state.benchmark.stable && ['OPERATIVE', 'DEGRADED'].includes(this.state.localHealth)) {
                // Recheck artifacts on restart; don't replay the completed installer,
                // benchmark or inference. Starting a server is a separate recoverable act.
                const signal = new AbortController().signal;
                try {
                    for (const a of TRUSTED_RUNTIME.assets)
                        if (await sha256(contained(bin, a.file), signal) !== a.sha256)
                            throw Error('RUNTIME_CHANGED');
                    if (await sha256(model, signal) !== selected.artifact.sha256)
                        throw Error('MODEL_CHANGED');
                    return this.snapshot();
                }
                catch {
                    this.update({ localHealth: 'BROKEN', phase: 'FAILED', failure: 'INSTALLED_INTEGRITY_CHANGED' });
                    return this.snapshot();
                }
            }
            this.update({ localHealth: 'NOT_VERIFIED', phase: this.state.phase === 'INTERRUPTED' ? 'INTERRUPTED' : 'CONNECT_INTELLIGENCE' });
        }
        else
            this.update({ localHealth: runtimeExists ? 'RUNTIME_ONLY' : modelExists ? 'MODEL_ONLY' : 'NOT_INSTALLED', phase: this.state.localChoice === 'declined' ? 'EXTERNAL_ONLY' : this.state.phase === 'INTERRUPTED' ? 'INTERRUPTED' : 'CONNECT_INTELLIGENCE' });
        return this.snapshot();
    }
    install(candidateId?: string): Promise<BootstrapSnapshot> {
        if (this.work || this.answering)
            throw Error('BOOTSTRAP_BUSY');
        this.active = new AbortController();
        this.work = this.perform(candidateId).finally(() => { this.work = null; this.active = null; });
        return this.work;
    }
    private async perform(candidateId?: string): Promise<BootstrapSnapshot> {
        const op = randomUUID(), signal = this.active!.signal, previous = this.snapshot();
        try {
            this.phase('PLANNING');
            const hardware = await this.profile();
            this.guard();
            const free = fs.statfsSync(this.installer.root);
            const plan = adviseLocal(hardware, TRUSTED_MODELS, TRUSTED_RUNTIME, this.installer.root, free.bavail * free.bsize);
            const selected = TRUSTED_MODELS.find(c => c.id === (candidateId ?? this.state.candidateId ?? plan?.candidateId));
            if (!selected || !plan || selected.ramBytes > Math.min((hardware.memory.availableBytes ?? 0) - 2 * 1024 ** 3, (hardware.memory.totalBytes ?? 0) * 0.65) || selected.artifact.size * 2 + 512 * 1024 ** 2 > free.bavail * free.bsize)
                throw Error('CANDIDATE_INCOMPATIBLE_OR_DISK_FULL');
            this.update({ localChoice: 'accepted', hardware, plan: { ...plan, candidateId: selected.id }, candidateId: selected.id, failure: null });
            this.journal.operation(op, { kind: 'BOOTSTRAP_INSTALL', taskId: BOOTSTRAP_TASK, candidateId: selected.id, status: 'STARTED', at: Date.now() });
            const progress = (artifact: string, total: number) => (received: number) => { this.guard(); const now = Date.now(); if (received === total || !this.state.progress || now - this.state.updatedAt > 500)
                this.update({ progress: { artifact, received, total } }); };
            this.phase('DOWNLOADING_RUNTIME');
            const archive = await this.installer.obtain(TRUSTED_RUNTIME.artifact, signal, progress('Runtime', TRUSTED_RUNTIME.artifact.size));
            this.guard();
            this.record('runtime-archive', TRUSTED_RUNTIME.artifact.sha256);
            this.phase('VERIFYING');
            const bin = await this.installer.runtime(TRUSTED_RUNTIME, archive, signal);
            this.guard();
            this.record('runtime-assets', TRUSTED_RUNTIME.artifact.sha256);
            this.phase('DOWNLOADING_MODEL');
            const model = await this.installer.obtain(selected.artifact, signal, progress(selected.label, selected.artifact.size));
            this.guard();
            this.record('model', selected.artifact.sha256);
            this.phase('STARTING');
            await this.runtime.start(bin, model, selected, signal);
            this.guard();
            this.phase('BENCHMARKING');
            const benchmark = await this.runtime.probe(signal);
            this.guard();
            this.journal.benchmark(JSON.stringify({ cpu: hardware.cpu.model, ram: hardware.memory.totalBytes }), selected.id, benchmark);
            if (!benchmark.correct || !benchmark.stable)
                throw Error('INFERENCE_VERIFICATION_FAILED');
            // Completion includes cleanup of the temporary verifier process. A
            // visible OPERATIVE state must survive an immediate window close.
            await this.runtime.stop();
            this.guard();
            this.record('inference', selected.artifact.sha256);
            this.update({ benchmark, localHealth: benchmark.rating === 'SLOW' ? 'DEGRADED' : 'OPERATIVE', phase: benchmark.rating === 'SLOW' ? 'DEGRADED' : 'OPERATIVE', progress: null, intelligenceRole: this.state.externalProviderId ? 'SPECIALIST' : null, routing: { ...this.state.routing, general: 'bootstrap-local' }, failure: null });
            this.journal.operation(op, { kind: 'BOOTSTRAP_INSTALL', taskId: BOOTSTRAP_TASK, candidateId: selected.id, status: 'VERIFIED', at: Date.now() });
            // The install cancellation signal owns the temporary validation process.
            // A later normal inference starts a new bounded Job; no background replay.
            return this.snapshot();
        }
        catch (e) {
            await this.runtime.stop();
            const stopped = signal.aborted;
            const code = stopped ? 'STOPPED' : e instanceof Error ? e.message : 'BOOTSTRAP_FAILED';
            const failure = /^[A-Z0-9_: -]{1,160}$/.test(code) ? code : 'INSTALL_OR_RUNTIME_FAILED';
            const preserved = stopped && ['OPERATIVE', 'DEGRADED'].includes(previous.localHealth);
            this.update({ ...(preserved ? { candidateId: previous.candidateId, benchmark: previous.benchmark, routing: previous.routing } : {}), phase: stopped ? 'CANCELLED' : 'FAILED', localHealth: preserved ? previous.localHealth : 'BROKEN', failure, progress: null });
            this.journal.operation(op, { kind: 'BOOTSTRAP_INSTALL', status: stopped ? 'CANCELLED' : 'FAILED', reason: failure, at: Date.now() });
            return this.snapshot();
        }
    }
    private record(kind: string, hash: string) {
        this.guard();
        const effectId = 'bootstrap:' + kind + ':' + hash;
        if (this.state.receipts.some(r => r.effectId === effectId))
            return;
        const receipt = { effectId, kind, sha256: hash, at: Date.now() };
        this.journal.effect(effectId, { ...receipt, status: 'VERIFIED', taskId: BOOTSTRAP_TASK });
        this.update({ receipts: [...this.state.receipts, receipt] });
    }
    inferenceMetrics(): BootstrapInferenceMetrics | null { return this.runtime.inferenceMetrics?.() ?? null; }
    async answer(prompt: string, signal: AbortSignal, context?:string, schema?: unknown, policy?: BootstrapInferencePolicy): Promise<string> {
        if (this.work || this.answering)
            throw Error('BOOTSTRAP_BUSY');
        if (!['OPERATIVE', 'DEGRADED'].includes(this.state.localHealth))
            throw Error('LOCAL_INTELLIGENCE_NOT_VERIFIED');
        validateBootstrapInferencePolicy(policy);
        if (policy && !schema) throw Error('STRUCTURED_INFERENCE_POLICY_ONLY');
        const candidate = TRUSTED_MODELS.find(c => c.id === this.state.candidateId)!;
        const bin = contained(this.installer.root, 'runtimes/' + TRUSTED_RUNTIME.id), model = contained(this.installer.root, 'cache/' + candidate.artifact.sha256 + '-' + candidate.artifact.filename);
        this.answering = true;
        try {
            if (!this.runtime.alive() || policy?.contextTokens !== undefined) {
                if (this.runtime.alive()) await this.runtime.stop();
                await this.runtime.start(bin, model, policy?.contextTokens === undefined ? candidate : { ...candidate, context: policy.contextTokens }, signal);
            }
            if (schema && !this.runtime.generateJson) throw Error('STRUCTURED_PROPOSAL_UNAVAILABLE');
            return schema ? await this.runtime.generateJson!(prompt, signal, schema, policy) : await this.runtime.generate(prompt, signal,context);
        }
        finally {
            await this.runtime.stop();
            this.answering = false;
        }
    }
    async cancel(): Promise<void> { this.active?.abort(); await this.runtime.stop(); await this.work; }
    async dispose(): Promise<void> { await this.cancel(); }
}
