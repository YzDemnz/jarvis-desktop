import { app, ipcMain, shell, dialog } from 'electron';
import type { BrowserWindow } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { authority, authorityHandle, onAuthorityStop } from '../authority';
import { fabricDatabase } from '../fabric/ipcFabric';
import { connectedService } from '../connected/ipcConnected';
import { bootstrapHardwareProfile } from '../machine/ipcMachine';
import { BootstrapController, BOOTSTRAP_TASK, TRUSTED_MODELS, TRUSTED_RUNTIME } from './BootstrapController';
import { ArtifactInstaller, contained } from './ArtifactInstaller';
import { LocalRuntime } from './LocalRuntime';
import type { BootstrapInferencePolicy } from './LocalRuntime';
import { CodexIntelligence } from './CodexIntelligence';
import type { BootstrapSnapshot } from './contracts';
import type { ProviderDescriptor } from '../../src/fabric/types';
import { OllamaProvider } from '../agent/OllamaProvider';
import { boundedJson, loopbackEndpoint } from '../connected/HttpProvider';
let controller: BootstrapController | null = null, codex: CodexIntelligence | null = null, runId = '', unsubscribe: (() => void) | null = null;
let capture: {
    action: string;
    at: number;
} | null = null;
let externalModel = '';
let ready: Promise<unknown> | null = null;
let bootstrapSelection: string | null = null;
const answers = new Map<string, AbortController>();
/** Internal local proposal port; no renderer can choose a runtime, schema or privileges. */
export async function bootstrapPatch(prompt: string, signal: AbortSignal, schema: unknown, policy?: BootstrapInferencePolicy) {
    await ready;
    if (!controller || !controller.snapshot().candidateId || !['OPERATIVE', 'DEGRADED'].includes(controller.snapshot().localHealth)) return null;
    if (!connectedService().snapshot().policy.enabled.includes('bootstrap-local')) throw Error('LOCAL_POLICY_DENIED');
    const model = controller.snapshot().candidateId;
    try {
        const text = await controller.answer(prompt, signal, undefined, schema, policy);
        signal.throwIfAborted();
        return {text, providerId: 'bootstrap-local', model, metrics: controller.inferenceMetrics()};
    } catch (error) {
        // Selected verified candidate is provenance, never a claim of successful inference.
        throw Object.assign(error instanceof Error ? error : Error('LOCAL_PROPOSAL_FAILED'),
            {inferenceIdentity: {providerId: 'bootstrap-local', model}});
    }
}
function executable(): string | null {
    const configured = process.env.JARVIS_CODEX_EXE;
    if (configured) {
        if (!path.isAbsolute(configured))
            throw Error('CODEX_PATH_MUST_BE_ABSOLUTE');
        return configured;
    }
    if (process.env.JARVIS_RUNTIME_ROOT) {
        const portable = path.join(path.dirname(process.env.JARVIS_RUNTIME_ROOT), 'Herramientas/Codex/codex.exe');
        if (fs.existsSync(portable))
            return portable;
    }
    const candidate = path.resolve('node_modules/@openai/codex-win32-x64/vendor/x86_64-pc-windows-msvc/bin/codex.exe');
    return fs.existsSync(candidate) ? candidate : null;
}
function task(id: string, prompt: string) { const db = fabricDatabase(); if (!db.task(id))
    db.saveTask({ taskId: id, conversationId: 'bootstrap-intelligence', goal: prompt, currentTask: prompt, instructions: [], findings: [], decisions: [], artifacts: [], openQuestions: [], pendingSteps: [], updatedAt: Date.now() }); }
function descriptor(id: string, label: string, state: ProviderDescriptor['state'], models: string[], observed: boolean, local: boolean): ProviderDescriptor { return { id, label, kind: local ? 'LOCAL_MODEL' : 'GENERAL_AI', state, costClass: local ? 'LOCAL' : 'SUBSCRIPTION', privacyClass: local ? 'LOCAL' : 'REMOTE', capabilities: [{ id: 'chat', available: state === 'AVAILABLE' || state === 'CONNECTED', strength: 1 }], contextLimit: local ? 2048 : null, quality: 0, healthCheckedAt: Date.now(), quota: 'UNKNOWN', surface: { transport: local ? 'LLAMA_CPP_CLI' : 'CODEX_APP_SERVER', destination: local ? 'local:bootstrap' : 'https://chatgpt.com', auth: local ? 'NOT_REQUIRED' : 'PROVIDER_MANAGED', secretRef: null, models, latencyMs: null, successfulRequests: observed ? 1 : 0, lastFailure: observed ? null : 'NOT_VERIFIED: detection/login do not prove inference', verification: observed ? 'INFERENCE_OBSERVED' : 'DISCOVERED', rateLimits: null } }; }
export function registerBootstrapIpc(owner: BrowserWindow) {
    const db = fabricDatabase(), saved = db.checkpointRecord(BOOTSTRAP_TASK) as BootstrapSnapshot | null;
    const defaultRoot = process.env.JARVIS_BOOTSTRAP_ROOT ?? path.join(app.getPath('userData'), 'local-ai');
    let portableRoot = path.resolve(defaultRoot);
    while (path.basename(portableRoot).toUpperCase() !== 'CODEX' && path.dirname(portableRoot) !== portableRoot)
        portableRoot = path.dirname(portableRoot);
    if (path.basename(portableRoot).toUpperCase() !== 'CODEX')
        portableRoot = path.dirname(defaultRoot);
    const root = process.env.JARVIS_ALLOW_FIXTURES==='1'&&process.env.JARVIS_BOOTSTRAP_ROOT?defaultRoot:saved?.installRoot?contained(portableRoot,path.relative(portableRoot,saved.installRoot)):defaultRoot;
    if (!path.isAbsolute(root))
        throw Error('BOOTSTRAP_ROOT_MUST_BE_ABSOLUTE');
    fs.mkdirSync(root, { recursive: true });
    const provision: string[] = [];
    const runtimeRoot = process.env.JARVIS_RUNTIME_ROOT;
    if (runtimeRoot) {
        const prior = path.join(runtimeRoot, 'llama-cpp/b6500');
        provision.push(path.join(prior, 'official.zip'));
        try {
            const data = JSON.parse(fs.readFileSync(path.join(prior, 'qwen-runtime.json'), 'utf8'));
            if (typeof data.model?.file === 'string' && path.isAbsolute(data.model.file))
                provision.push(data.model.file);
        }
        catch { /* optional recovered artifact */ }
        for(const model of TRUSTED_MODELS)provision.push(path.join(path.dirname(runtimeRoot),'BootstrapAssets/cache',model.artifact.sha256+'-'+model.artifact.filename));
    }
    const fixtureSources = process.env.JARVIS_BOOTSTRAP_PROVISION;
    if (fixtureSources && process.env.JARVIS_ALLOW_FIXTURES === '1') {
        const paths = JSON.parse(fixtureSources);
        if (Array.isArray(paths) && paths.every(x => typeof x === 'string' && path.isAbsolute(x)))
            provision.push(...paths);
    }
    controller = new BootstrapController({ read: () => db.checkpointRecord(BOOTSTRAP_TASK) as BootstrapSnapshot | null, write: s => db.writeCheckpointRecord(BOOTSTRAP_TASK, s), operation: (id, value) => db.writeOperationRecord(id, BOOTSTRAP_TASK, value), effect: (id, value) => db.writeEffectRecord(id, BOOTSTRAP_TASK, value), benchmark: (fingerprint, model, value) => db.saveBenchmark({ hardwareFingerprint: fingerprint, runtimeId: model.startsWith('ollama:') ? 'ollama' : TRUSTED_RUNTIME.id, modelId: model, configuration: 'bootstrap-v1/cpu/context2048' }, value) }, new ArtifactInstaller(root, provision), new LocalRuntime(TRUSTED_RUNTIME), bootstrapHardwareProfile, () => { if (runId) {
        authority.gate(runId);
        if (authority.accessMode() !== 'FULL')
            throw Error('BOOTSTRAP_RESTRICTED');
    } });
    codex = new CodexIntelligence(path.join(app.getPath('userData'), 'external/codex'), executable());
    externalModel = controller.snapshot().externalModel ?? '';
    connectedService().setBootstrapSurfaces({ descriptors: () => { const s = controller!.snapshot(); const local = !!s.candidateId && ['OPERATIVE', 'DEGRADED'].includes(s.localHealth); return [descriptor('bootstrap-local', 'IA local · instalada por JARVIS', local ? 'AVAILABLE' : s.localHealth === 'NOT_INSTALLED' ? 'NOT_INSTALLED' : 'DETECTED', s.candidateId ? [s.candidateId] : [], local, true), descriptor('codex-app-server', 'Codex · inteligencia temporal / especialista', codex!.status === 'OPERATIVE' ? 'AVAILABLE' : codex!.status === 'NOT_VERIFIED' ? 'CONNECTED' : codex!.status === 'NOT_INSTALLED' ? 'NOT_INSTALLED' : codex!.status==='BLOCKED'?'ERROR':'AUTH_REQUIRED', codex!.models, codex!.status === 'OPERATIVE', false)]; }, execute: async (id, prompt, signal,context,model) => {
        const text=id==='bootstrap-local'?await controller!.answer(prompt,signal,context):await codex!.answer(prompt,signal,context,model);
        return {text,model:id==='bootstrap-local'?controller!.snapshot().candidateId:codex!.lastModel};
    }, observed: id => { if (bootstrapSelection === id)
            controller!.externalObserved(id); } });
    unsubscribe = onAuthorityStop(async (id) => { answers.get(id)?.abort(); if (id === runId)
        await controller?.cancel(); });
    ipcMain.on('bootstrap:capture', (event, action: unknown) => { if (event.sender === owner.webContents && event.senderFrame === owner.webContents.mainFrame && typeof action === 'string' && action.length <= 300)
        capture = { action, at: Date.now() }; });
    authorityHandle('bootstrap:snapshot', () => ({ state: controller!.snapshot(), candidates: TRUSTED_MODELS, runtime: TRUSTED_RUNTIME, external: codex!.status, externalDiagnostics: { protocolVerified: codex!.protocolVerified, lastError: codex!.lastError } }));
    authorityHandle('bootstrap:diagnostics', () => { if (process.env.JARVIS_ALLOW_FIXTURES !== '1')
        throw Error('FIXTURE_ONLY'); return controller!.diagnostics(); });
    authorityHandle('bootstrap:inspect', async () => { ready ??= controller!.detect().then(() => controller!.plan()).then(async () => { const service = connectedService(); await service.refresh(); const existing = service.snapshot().providers.find(x => x.id === 'ollama-local'); controller!.discoveredExisting(!!existing && ['CONNECTED', 'AVAILABLE'].includes(existing.state), !!existing?.surface?.models.length); if (controller!.snapshot().externalProviderId === 'codex-app-server')
        await codex!.inspect(); }).finally(() => ready = null); await ready; return { state: controller!.snapshot(), candidates: TRUSTED_MODELS, runtime: TRUSTED_RUNTIME, external: codex!.status }; });
    authorityHandle('bootstrap:action', async (_event, action: unknown) => {
        const c = capture;
        capture = null;
        if (typeof action !== 'string' || !c || c.action !== action || Date.now() - c.at > 30000)
            throw Error('BOOTSTRAP_OWNER_GESTURE_REQUIRED');
        if (action === 'cancel') {
            await controller!.cancel();
            return true;
        }
        if (action === 'decline') {
            controller!.decline();
            return true;
        }
        if (action === 'choose-location') {
            if (authority.accessMode() !== 'FULL')
                throw Error('BOOTSTRAP_RESTRICTED');
            if (answers.size)
                throw Error('BOOTSTRAP_BUSY');
            const result = await dialog.showOpenDialog(owner, { title: 'Ubicación de IA local dentro de CODEX', defaultPath: controller!.snapshot().plan?.location ?? root, properties: ['openDirectory', 'createDirectory'] });
            if (result.canceled || !result.filePaths[0])
                return false;
            const selected = contained(portableRoot, path.relative(portableRoot, result.filePaths[0]));
            if (selected === portableRoot)
                throw Error('BOOTSTRAP_LOCATION_REQUIRES_SUBFOLDER');
            controller!.relocate(new ArtifactInstaller(selected, provision));
            await controller!.detect();
            await controller!.plan();
            return true;
        }
        if (action === 'codex-login') {
            const url = await codex!.login();
            await shell.openExternal(url);
            const policy = connectedService().policy.snapshot();
            connectedService().policy.userChange({ enabled: [...new Set([...policy.enabled, 'codex-app-server'])] });
            return true;
        }
        if (action === 'codex-status') {
            await codex!.inspect();
            await connectedService().refresh();
            return true;
        }
        if (action.startsWith('install:')) {
            const candidateId = action.slice(8);
            if (!TRUSTED_MODELS.some(x => x.id === candidateId))
                throw Error('CANDIDATE_NOT_IN_CATALOG');
            if (['PLANNING', 'DOWNLOADING_RUNTIME', 'DOWNLOADING_MODEL', 'VERIFYING', 'STARTING', 'BENCHMARKING'].includes(controller!.snapshot().phase) || answers.size)
                throw Error('BOOTSTRAP_BUSY');
            if (authority.accessMode() !== 'FULL')
                throw Error('BOOTSTRAP_RESTRICTED');
            runId = 'bootstrap-' + randomUUID();
            const original = 'Instalar IA local ' + candidateId;
            authority.admit(runId, createHash('sha256').update(original).digest('hex'), original);
            // The native owner's install click admits use of this local surface.
            // Persist it before publishing completion, so closing the window cannot
            // strand verified artifacts behind an unwritten policy callback.
            const service = connectedService(), policy = service.policy.snapshot();
            service.policy.userChange({ enabled: [...new Set([...policy.enabled, 'bootstrap-local'])] });
            void controller!.install(candidateId).then(async () => { await service.refresh(); }).catch(() => { });
            return true;
        }
        if (action === 'verify-existing') {
            const service = connectedService();
            await service.refresh();
            const local = service.snapshot().providers.find(x => x.id === 'ollama-local');
            const model = local?.surface?.models.find(x => !/(?:^|[-:])cloud(?:$|[-:])/.test(x));
            if (!model)
                throw Error('EXISTING_LOCAL_MODEL_NOT_DETECTED');
            const endpoint = loopbackEndpoint(process.env.OLLAMA_HOST ?? 'http://127.0.0.1:11434');
            const signal = new AbortController();
            runId = 'bootstrap-existing-' + randomUUID();
            authority.admit(runId, createHash('sha256').update(action).digest('hex'), action);
            answers.set(runId, signal);
            try {
                const info = await boundedJson(endpoint + '/api/show', { method: 'POST', signal: signal.signal, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ model }) });
                if (info.remote_host || info.remote_model)
                    throw Error('MODEL_IS_REMOTE');
                const ollama = new OllamaProvider(endpoint), started = Date.now();
                const a = await ollama.generateMeasured({ model, prompt: 'Compute 2+5. Return exactly {"ok":true,"n":7}.', format: 'json', maxTokens: 64, timeoutMs: 90000 }, signal.signal);
                const b = await ollama.generateMeasured({ model, prompt: 'Compute 3+4. Return exactly {"ok":true,"n":7}.', format: 'json', maxTokens: 64, timeoutMs: 90000 }, signal.signal);
                const correct = (x: string) => { try {
                    const r = JSON.parse(x);
                    return r.ok === true && r.n === 7;
                }
                catch {
                    return false;
                } };
                if (!correct(a.text) || !correct(b.text))
                    throw Error('EXISTING_INFERENCE_NOT_VERIFIED');
                authority.gate(runId);
                controller!.adoptExisting(model, { correct: true, stable: true, latencyMs: Date.now() - started, startMs: null, firstTokenMs: null, tokensPerSecond: null, outputTokens: b.outputTokens, ramBytes: null, vramBytes: null, contextTested: 0, at: Date.now(), rating: Date.now() - started > 20000 ? 'SLOW' : 'USABLE', error: null });
            }
            finally {
                answers.delete(runId);
            }
            return true;
        }
        if (action.startsWith('probe:')) {
            const [providerId, model] = action.slice(6).split('|');
            if (!providerId || !['codex-app-server', 'openai-api', 'claude-api', 'gemini-api', 'grok-api'].includes(providerId) || !model || !/^[a-zA-Z0-9._:/-]{1,200}$/.test(model))
                throw Error('INVALID_EXTERNAL_PROBE');
            if (providerId === 'codex-app-server')
                await codex!.inspect();
            await connectedService().refresh();
            const prompt = 'Reply exactly JARVIS_READY. Text only. No tools.';
            const id = 'bootstrap-probe-' + randomUUID();
            authority.admit(id, createHash('sha256').update(prompt).digest('hex'), prompt);
            task(id, prompt);
            bootstrapSelection = providerId;
            try {
                const result = await connectedService().execute(id, prompt, { providerId, model }, true);
                if (!result.ok || result.text?.trim() !== 'JARVIS_READY')
                    throw Error('EXTERNAL_INFERENCE_NOT_VERIFIED');
                externalModel = model;
                controller!.setExternalModel(model);
                return true;
            }
            finally {
                bootstrapSelection = null;
            }
        }
        throw Error('UNKNOWN_BOOTSTRAP_ACTION');
    });
    authorityHandle('bootstrap:answer', async (_event, id: unknown, prompt: unknown) => {
        if (typeof id !== 'string' || typeof prompt !== 'string' || !prompt.trim() || prompt.length > 16000)
            throw Error('INVALID_INTELLIGENCE_REQUEST');
        authority.gate(id);
        const run = authority.run(id)!;
        if (run.originalHash !== createHash('sha256').update(prompt.trim()).digest('hex'))
            throw Error('INTELLIGENCE_ORIGINAL_MISMATCH');
        const state = controller!.snapshot();
        const service = connectedService(), policy = service.policy.snapshot();
        const daily=policy.economyModel&&policy.enabled.includes('ollama-local')?policy.economyModel:null;
        const selected = daily?'ollama-local':state.routing.general;
        if (!selected)
            throw Error('INTELLIGENCE_NOT_CONFIGURED');
        if (!policy.enabled.includes(selected) || policy.dataClass === 'LOCAL_ONLY' && !['bootstrap-local', 'ollama-local'].includes(selected))
            throw Error('INTELLIGENCE_POLICY_DENIED');
        task(id, prompt);
        await service.refresh();
        const result = await service.execute(id, prompt, { providerId: selected, model: selected === 'bootstrap-local' ? state.candidateId ?? '' : selected === 'ollama-local' ? daily??state.existingLocalModel??'' : externalModel }, true);
        if (!result.ok)
            throw Error('INTELLIGENCE_POLICY_OR_PROVIDER_BLOCKED');
        return { text: result.text!, providerId: selected, model: result.model ?? null, messageId: result.messageId!, mainRecorded: true };
    });
}
export function codexBridgeSnapshot(){return {status:codex?.status??'NOT_INSTALLED',protocolVerified:codex?.protocolVerified??false,models:codex?.models??[],lastError:codex?.lastError??null,catalogIsEntitlement:false};}
export function unregisterBootstrapIpc() {
    ['bootstrap:snapshot', 'bootstrap:inspect', 'bootstrap:action', 'bootstrap:answer', 'bootstrap:diagnostics'].forEach(c => ipcMain.removeHandler(c));
    ipcMain.removeAllListeners('bootstrap:capture');capture=null;unsubscribe?.();unsubscribe=null;answers.forEach(x=>x.abort());answers.clear();
    // If the database already closed, the last durable active phase is recovered
    // as INTERRUPTED. Cancellation still closes the owned streams and Job.
    void controller?.dispose().catch(()=>{});void codex?.stop().catch(()=>{});
    controller=null;codex=null;runId='';
}
