import path from 'node:path';
import fs from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import { ConnectedAIRegistry } from '../../src/fabric/ConnectedAIRegistry';
import { FabricEngine } from '../../src/fabric/FabricEngine';
import { UsageLedger } from '../../src/fabric/UsageLedger';
import { safeContextText } from '../../src/fabric/ContinuityState';
import type { AuthorityState } from '../../src/authority/AuthorityState';
import type { ProviderDescriptor, IntelligenceProvider } from '../../src/fabric/types';
import type { FabricDatabase } from '../fabric/FabricDatabase';
import type { CredentialStore } from './CredentialStore';
import { ConnectedPolicyStore } from './ConnectedPolicy';
import { boundedJson, loopbackEndpoint, ResponsesProvider, usageRecord } from './HttpProvider';
import { OllamaProvider } from '../agent/OllamaProvider';
import { NodeProcessPort } from '../dev/nodePorts';
import { spawnWindowsJob } from '../process/WindowsJobProcess';
import type { SpawnedProcess } from '../../src/dev/ports';
import { TaskContinuity, continuityHash } from './TaskContinuity';
import {followupFormat} from './FollowupFormat';
import type { ContinuationChoice } from './TaskContinuity';
import { executeLlama, discoveredLlamaRuntime, LLAMA_MODEL } from './LlamaCppProvider';
import { VerificationService, checkedContract } from './VerificationService';
import { API_ROUTES, ChatCompletionsProvider } from './ChatCompletionsProvider';
import { SovereignMemory } from './SovereignMemory';
import type { MemoryReference } from './SovereignMemory';
import { evidenceRoute } from './OutcomeRouting';
import { ConciliusCoordinator, validateConciliusPlan } from './ConciliusCoordinator';
import type { ConciliusGraph } from './ConciliusCoordinator';
import {organizeWork,organizationRequest} from './WorkOrganization';
import { originalStrongRequirement } from '../../src/authority/AuthorityState';
import {analysisFormat} from '../../src/workbench/contracts';
import {releaseDocumentModelMemory} from '../workbench/DocumentModelMemory';

export const API_DESTINATION = 'https://api.openai.com/v1';
async function installedBinary(name: 'ollama' | 'codex') {
  const found = await new NodeProcessPort().which(name); if (found) return found;
  const base = process.env.LOCALAPPDATA ?? '';
  if (!base) return null;
  if (name === 'ollama') { const file = path.join(base, 'Programs', 'Ollama', 'ollama.exe'); return fs.existsSync(file) ? file : null; }
  const dir = path.join(base, 'OpenAI', 'Codex', 'bin');
  try { return fs.readdirSync(dir, { withFileTypes: true }).filter(d => d.isDirectory()).map(d => path.join(dir, d.name, 'codex.exe')).find(f => fs.existsSync(f)) ?? null; } catch { return null; }
}
export class ConnectedAIService {
  readonly registry = new ConnectedAIRegistry();
  readonly policy: ConnectedPolicyStore;
  readonly continuity: TaskContinuity;
  private readonly active = new Map<string, AbortController>();
  private readonly operationOwners = new Map<string, string>();
  private readonly graphs = new Map<string, ConciliusCoordinator>();
  private readonly consumed = new Set<string>();
  private localServer: SpawnedProcess | null = null;
  private starting: Promise<unknown> | null = null;
  private refreshing: Promise<ReturnType<ConnectedAIService['snapshot']>> | null = null;
  private disposed = false;
  private lastDocumentModel:string|null=null;
  private bootstrapSurfaces: { descriptors: () => ProviderDescriptor[]; execute: (id: string, prompt: string, signal: AbortSignal, context?:string, model?:string) => Promise<{text:string;model:string|null}>; observed: (id: string) => void } | null = null;
  setBootstrapSurfaces(surfaces: NonNullable<ConnectedAIService['bootstrapSurfaces']>) { this.bootstrapSurfaces = surfaces; }
  private readonly endpoint: string;
  private readonly ollama: OllamaProvider;
  readonly apiDestination: string;
  constructor(private readonly db: FabricDatabase, private readonly authority: AuthorityState,
    readonly vault: CredentialStore | null, directory: string, endpoint = 'http://127.0.0.1:11434', apiDestination = API_DESTINATION) {
    this.endpoint = loopbackEndpoint(endpoint); this.apiDestination = apiDestination;
    this.ollama = new OllamaProvider(this.endpoint);
    this.policy = new ConnectedPolicyStore(path.join(directory, 'connected-policy.json'), () => this.cancelAll());
    this.continuity = new TaskContinuity(db, path.join(directory, 'task-artifacts'));
    for (const item of db.graphRecords() as ConciliusGraph[]) if (item.state === 'STARTED') {
      item.state = 'INTERRUPTED'; item.reason = 'Restart: explicit new graph required; no replay';
      item.nodes.forEach(node => { if (node.state === 'STARTED') node.state = 'INTERRUPTED'; }); db.writeGraphRecord(item.graphId, item);
    }
    this.registry.register(this.descriptor('ollama-local', 'IA local · Ollama', 'LOCAL_MODEL', 'OFFLINE', 'LOCAL', 'LOCAL', 'OLLAMA_HTTP', this.endpoint));
    this.registry.register(this.descriptor('openai-api', 'OpenAI Responses API', 'GENERAL_AI', 'AUTH_REQUIRED', 'PAID_API', 'REMOTE', 'RESPONSES_API', apiDestination));
    this.registry.register(this.descriptor('codex-app-server', 'Codex AppServer · investigación', 'CODING_AGENT', 'NOT_CONNECTED', 'UNKNOWN', 'REMOTE', 'CODEX_APP_SERVER', null));
    this.registry.register(this.descriptor('llama-cpp-local', 'llama.cpp · runtime independiente CPU', 'LOCAL_MODEL', 'NOT_INSTALLED', 'LOCAL', 'LOCAL', 'LLAMA_CPP_CLI', 'local:llama.cpp'));
    for (const route of Object.values(API_ROUTES)) this.registry.register(this.descriptor(route.id, route.label, 'GENERAL_AI', 'AUTH_REQUIRED', 'PAID_API', 'REMOTE', route.transport, route.destination));
  }
  private descriptor(id: string, label: string, kind: ProviderDescriptor['kind'], state: ProviderDescriptor['state'], costClass: ProviderDescriptor['costClass'], privacyClass: ProviderDescriptor['privacyClass'], transport: NonNullable<ProviderDescriptor['surface']>['transport'], destination: string | null): ProviderDescriptor {
    return { id, label, kind, state, costClass, privacyClass, contextLimit: null, quality: 0, healthCheckedAt: null, quota: 'UNKNOWN', capabilities: [],
      surface: { transport, destination, auth: ['ollama-local', 'llama-cpp-local'].includes(id) ? 'NOT_REQUIRED' : 'UNKNOWN', secretRef: null, models: [], latencyMs: null, successfulRequests: 0, lastFailure: null, verification: 'DISCOVERED', rateLimits: null } };
  }
  snapshot() { return { providers: this.registry.list(), policy: this.policy.snapshot(), credentialAvailable: !!this.vault, revision: this.policy.revision }; }
  cancel(runId: string) { this.active.forEach((c, id) => { if (id === runId || this.operationOwners.get(id) === runId) c.abort(); }); this.graphs.get(runId)?.stop(runId); }
  cancelAll() { this.active.forEach(c => c.abort()); for (const [id, graph] of this.graphs) graph.stop(id); }
  async dispose() { this.disposed = true; this.cancelAll(); await this.localServer?.killTree(); this.localServer = null; }
  async refresh() {
    if (this.refreshing) return this.refreshing;
    this.refreshing = this.doRefresh();
    try { return await this.refreshing; } finally { this.refreshing = null; }
  }
  private async doRefresh() {
    const start = Date.now(), health = await this.ollama.health(true), local = this.registry.get('ollama-local')!;
    local.state = health.online ? (health.models.length ? 'AVAILABLE' : 'CONNECTED') : 'OFFLINE'; local.healthCheckedAt = Date.now(); local.surface!.latencyMs = Date.now() - start;
    local.surface!.models = health.models.map(m => safeContextText(m.name)).slice(0, 100);
    local.capabilities = [{ id: 'chat', strength: 1, available: health.online && health.models.length > 0 }];
    this.registry.register(local);
    const api = this.registry.get('openai-api')!, ref = this.vault?.references().find(r => r.providerId === 'openai-api' && r.destination === this.apiDestination);
    api.surface!.auth = ref ? 'SECRET_REF' : 'MISSING'; api.surface!.secretRef = ref?.id ?? null;
    api.state = ref ? (api.surface!.lastFailure ? 'DEGRADED' : api.surface!.successfulRequests ? 'AVAILABLE' : 'NOT_CONNECTED') : 'AUTH_REQUIRED';
    api.capabilities = [{ id: 'chat', strength: 1, available: !!ref }]; this.registry.register(api);
    for (const route of Object.values(API_ROUTES)) {
      const d = this.registry.get(route.id)!, r = this.vault?.references().find(r => r.providerId === route.id && r.destination === route.destination);
      d.surface!.auth = r ? 'SECRET_REF' : 'MISSING'; d.surface!.secretRef = r?.id ?? null;
      d.state = r ? (d.surface!.lastFailure ? 'DEGRADED' : d.surface!.successfulRequests ? 'AVAILABLE' : 'NOT_CONNECTED') : 'AUTH_REQUIRED';
      d.capabilities = [{ id: 'chat', strength: 1, available: !!r }]; this.registry.register(d);
    }
    const codex = this.registry.get('codex-app-server')!;
    codex.state = await installedBinary('codex') ? 'DETECTED' : 'NOT_INSTALLED';
    codex.surface!.lastFailure = 'Protocol documented; authentication, catalog and inference not probed by this adapter.';
    // Detection is not connection, entitlement, or permission to run native tools.
    this.registry.register(codex);
    const llama = this.registry.get('llama-cpp-local')!;
    try { discoveredLlamaRuntime(); llama.state = llama.surface!.successfulRequests ? (llama.surface!.lastFailure ? 'DEGRADED' : 'AVAILABLE') : 'DETECTED'; llama.surface!.models = [LLAMA_MODEL]; llama.capabilities = [{ id: 'chat', strength: 1, available: true }]; if (!llama.surface!.successfulRequests && !llama.surface!.lastFailure) llama.surface!.lastFailure = 'Provisioned files detected; integrity and inference require an explicit operation.'; }
    catch { llama.state = 'NOT_CONNECTED'; llama.capabilities = []; llama.surface!.lastFailure = 'Official runtime or pinned model missing/unverified; no download or inference attempted.'; }
    this.registry.register(llama);
    for (const descriptor of this.bootstrapSurfaces?.descriptors() ?? []) this.registry.register(descriptor);
    return this.snapshot();
  }
  async startLocal() {
    if (this.starting) return this.starting;
    this.starting = this.doStartLocal();
    try { return await this.starting; } finally { this.starting = null; }
  }
  private async doStartLocal() {
    if (this.disposed) throw Error('CONNECTED_CLOSED');
    if ((await this.ollama.health(true)).online) return this.refresh();
    const port = new NodeProcessPort(), exe = await installedBinary('ollama'); if (!exe) throw Error('OLLAMA_NOT_INSTALLED');
    if (this.disposed) throw Error('CONNECTED_CLOSED');
    const ollamaProfile = process.env.JARVIS_OLLAMA_USER_PROFILE;
    if (ollamaProfile && !path.isAbsolute(ollamaProfile)) throw Error('OLLAMA_USER_PROFILE_MUST_BE_ABSOLUTE');
    const env = { ...port.baseEnv(), OLLAMA_HOST: this.endpoint, OLLAMA_NO_CLOUD: '1', OLLAMA_NOPRUNE: '1', ...(process.env.OLLAMA_MODELS ? { OLLAMA_MODELS: process.env.OLLAMA_MODELS } : {}), ...(ollamaProfile ? { USERPROFILE: ollamaProfile, HOME: ollamaProfile } : {}) };
    const proc = spawnWindowsJob({ file: exe, args: ['serve'], cwd: path.dirname(exe), env });
    this.localServer = proc;
    try {
      await proc.ready;
      // Version can respond before the installed runtime finishes GPU discovery.
      // Its observed Windows watchdog is ~180s. Keep a bounded async startup,
      // not a fake empty catalog, paid fallback, or driver/config mutation.
      const until = Date.now() + 240000;
      while (Date.now() < until) {
        if (this.disposed) throw Error('CONNECTED_CLOSED');
        const h = await this.ollama.health(true);
        if (h.online && h.models.length) return this.refresh();
        await new Promise(r => setTimeout(r, 300));
      }
      if ((await this.ollama.health(true)).online) return this.refresh();
      throw Error('OLLAMA_START_TIMEOUT');
    } catch { await proc.killTree(); this.localServer = null; throw Error('OLLAMA_START_FAILED'); }
  }
  async execute(runId: string, prompt: string, selection: { providerId?: string; model?: string; continuation?: ContinuationChoice }, manualPaidChoice = false) {
    return this.executeOperation(runId, prompt, selection, manualPaidChoice);
  }
  /** Main-owned document delegate; provider and schema cannot be chosen by the document/model. */
  async analyzeDocuments(rootId:string,original:string,prompt:string,attempt:0|1=0){
    this.authority.gate(rootId);const admitted=this.authority.run(rootId)!;
    if(admitted.source!=='USER_INPUT_GESTURE'||admitted.originalHash!==continuityHash(original.trim()))throw Error('DOCUMENT_ORIGINAL_MISMATCH');
    await this.refresh();this.authority.gate(rootId);
    const model=this.policy.snapshot().documentModel??this.policy.snapshot().economyModel;
    if(!model||!this.policy.snapshot().enabled.includes('ollama-local')||!this.registry.get('ollama-local')?.surface?.models.includes(model))throw Error('DOCUMENT_LOCAL_MODEL_UNAVAILABLE');
    if(attempt!==0&&attempt!==1)throw Error('DOCUMENT_REPAIR_BUDGET');const id=rootId+'-document-analysis'+(attempt===1?'-repair':'');
    if(this.db.task(id))throw Error('DOCUMENT_ANALYSIS_ALREADY_USED');
    this.db.saveTask({taskId:id,conversationId:rootId,goal:'Comprender documentos seleccionados',currentTask:'Análisis local con fuentes',instructions:[],findings:[],decisions:[],artifacts:[],openQuestions:[],pendingSteps:[],updatedAt:Date.now()});
    const result=await this.executeOperation(id,prompt,{providerId:'ollama-local',model,maxOutputTokens:512,documentFormat:true},false,rootId);
    if(result.ok)this.lastDocumentModel=model;return result;
  }
  async releaseDocumentMemory(rootId:string,signal?:AbortSignal){
    const gate=()=>{this.authority.gate(rootId);if(this.authority.accessMode()!=='FULL'||this.disposed)throw Error('MEMORY_AUTHORITY_REQUIRED');signal?.throwIfAborted();};
    const result=await releaseDocumentModelMemory(this.lastDocumentModel,this.endpoint,()=>this.active.size,gate,signal);
    if(result.state==='RELEASED'||result.reason==='ALREADY_NOT_RESIDENT')this.lastDocumentModel=null;return result;
  }
  private async executeOperation(runId: string, prompt: string, selection: { providerId?: string; model?: string; continuation?: ContinuationChoice;maxOutputTokens?:number;followupFormat?:true;documentFormat?:true }, manualPaidChoice = false, rootId?: string, dependencyOperations?:string[]) {
    if (this.disposed) throw Error('CONNECTED_CLOSED');
    if (typeof prompt !== 'string' || !prompt.trim() || prompt.length > 16000) throw Error('INVALID_CONNECTED_PROMPT');
    const authorityId = rootId ?? runId;
    this.authority.gate(authorityId);
    const admission = this.authority.run(authorityId)!;
    if (!rootId && (admission.source !== 'USER_INPUT_GESTURE' || admission.originalHash !== createHash('sha256').update(prompt.trim()).digest('hex'))) throw Error('CONNECTED_ORIGINAL_MISMATCH');
    if (this.consumed.has(runId)) throw Error('CONNECTED_RUN_ALREADY_USED');
    const taskId = selection.continuation?.taskId ?? runId;
    const state = this.db.task(taskId); if (!state) throw Error('CONNECTED_TASK_NOT_FOUND');
    if (!selection.continuation && state.evidence?.some(e => e.source === 'MAIN_PROCESS' && e.id.startsWith('connected:'))) throw Error('CONNECTED_CHECKPOINT_REQUIRES_NEW_RUN');
    // Validate before the durable journal: rejected selectors must not persist a
    // credential accidentally typed into the model/provider field.
    if (selection.providerId !== undefined && !['ollama-local', 'openai-api', 'llama-cpp-local', 'bootstrap-local', 'codex-app-server', ...Object.keys(API_ROUTES)].includes(selection.providerId)) throw Error('CONNECTED_SURFACE_NOT_OPERATIVE');
    if (selection.model !== undefined && (typeof selection.model !== 'string' || (selection.model && (!/^[a-zA-Z0-9._:/-]{1,200}$/.test(selection.model) || safeContextText(selection.model) !== selection.model)))) throw Error('INVALID_CONNECTED_MODEL');
    const policy = this.policy.snapshot(), revision = this.policy.revision, epoch = this.authority.revision();
    if (rootId) policy.dataClass = 'LOCAL_ONLY';
    const checkpoint = this.continuity.checkpoint(taskId);
    if (checkpoint?.dataClass === 'LOCAL_ONLY') policy.dataClass = 'LOCAL_ONLY';
    else if (checkpoint?.dataClass === 'CLIENT_DATA' && policy.dataClass === 'GENERIC') policy.dataClass = 'CLIENT_DATA';
    const operation = this.continuity.begin(runId, prompt, selection.providerId ?? null, selection.model ?? null, policy.dataClass, selection.continuation,'INFERENCE',dependencyOperations);
    const controller = new AbortController(); this.active.set(runId, controller); this.consumed.add(runId);
    this.operationOwners.set(runId, authorityId);
    let failure: string | null = null;
    // Observed pinned CPU runtime cold load is ~109s before any tokens. This is
    // an explicit per-surface ceiling, not unbounded retry/general run budgets.
    const timer = setTimeout(() => controller.abort(), ['llama-cpp-local','bootstrap-local'].includes(selection.providerId??'') ? 420000 : selection.providerId==='ollama-local'?180000:90000), started = Date.now();
    const guard = (id: string) => {
      this.authority.gate(authorityId);
      if (controller.signal.aborted || epoch !== this.authority.revision() || revision !== this.policy.revision) throw Error('CONNECTED_RUN_REVOKED');
      const d = this.registry.get(id)!;
      if (!policy.enabled.includes(id) || (d.costClass === 'PAID_API' && (!policy.allowPaidApi || (!manualPaidChoice && !policy.allowPaidFallback)))
        || (policy.dataClass === 'LOCAL_ONLY' && d.privacyClass !== 'LOCAL')
        || (id === 'openrouter-api' && policy.dataClass !== 'GENERIC')
        || (policy.dataClass === 'CLIENT_DATA' && d.privacyClass !== 'LOCAL' && !policy.clientDestinations.includes(d.surface!.destination!))) throw Error('CONNECTED_POLICY_DENIED');
    };
    try {
      this.receipt(taskId, 'STARTED', null, policy.dataClass, revision, 0);
      const requested = selection?.providerId;
      if (requested && !['ollama-local', 'openai-api', 'llama-cpp-local', 'bootstrap-local', 'codex-app-server', ...Object.keys(API_ROUTES)].includes(requested)) throw Error('CONNECTED_SURFACE_NOT_OPERATIVE');
      const model = typeof selection?.model === 'string' && /^[a-zA-Z0-9._:/-]{1,200}$/.test(selection.model) ? selection.model : '';
      if (model && safeContextText(model) !== model) throw Error('INVALID_CONNECTED_MODEL');
      const engine = new FabricEngine(this.registry, new UsageLedger(this.db), this.db);
      const localModel = model || this.registry.get('ollama-local')!.surface!.models[0];
      const local: IntelligenceProvider = {
        identity: () => ({ id: 'ollama-local', label: 'Ollama', kind: 'LOCAL_MODEL' }), capabilities: async () => [],
        connectionState: async () => this.registry.get('ollama-local')!.state, entitlement: async () => ({ paid: false, details: null }),
        health: async () => ({ ok: (await this.ollama.health()).online, message: null }), usage: async () => [], estimate: async () => ({ amount: null, currency: null }),
        execute: async request => {
          guard('ollama-local'); if (!localModel) throw Error('LOCAL_MODEL_NOT_AVAILABLE');
          const info = await boundedJson(this.endpoint + '/api/show', { method: 'POST', signal: request.signal, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ model: localModel }) });
          // Cloud-backed tags cannot inherit LOCAL privacy from their loopback URL.
          if (info.remote_host || info.remote_model || /(?:^|[-:])cloud(?:$|[-:])/.test(localModel)) throw Error('LOCAL_MODEL_IS_REMOTE');
          guard('ollama-local');
          let response;
          const outputTokens=selection.maxOutputTokens??128;if(!Number.isSafeInteger(outputTokens)||outputTokens<64||outputTokens>512)throw Error('LOCAL_OUTPUT_BUDGET_INVALID');
          try { response = await this.ollama.generateMeasured({ model: localModel, prompt: request.prompt, system: request.context, maxTokens: outputTokens,contextTokens:4096,...(selection.followupFormat?{format:followupFormat()}:{}),...(selection.documentFormat?{format:analysisFormat()}:{}),...(info.capabilities?.includes('thinking')?{think:false}:{}), timeoutMs: 175000 }, request.signal); }
          catch (error) { failure = error instanceof Error && /respondió 429/.test(error.message) ? 'RATE_LIMITED' : 'PROVIDER_FAILED'; throw Error('LOCAL_PROVIDER_FAILED'); }
          guard('ollama-local'); return { text: safeContextText(response.text), model: localModel, usage: [usageRecord('ollama-local', localModel, taskId, response.inputTokens, response.outputTokens)] };
        },
      };
      engine.attach(local);
      if (this.bootstrapSurfaces && (requested === 'bootstrap-local' || requested === 'codex-app-server')) {
        const surface = requested;
        engine.attach({ ...local, identity: () => ({ id: surface, label: surface, kind: surface === 'bootstrap-local' ? 'LOCAL_MODEL' : 'GENERAL_AI' }),
          connectionState: async () => this.registry.get(surface)!.state,
          entitlement: async () => ({ paid: false, details: surface === 'codex-app-server' ? 'Official ChatGPT login only; API-key accounts rejected; quota UNKNOWN' : 'Local verified inference' }),
          execute: async request => { guard(surface); const response = await this.bootstrapSurfaces!.execute(surface, request.prompt, request.signal!,request.context,model); guard(surface); return { text: safeContextText(response.text), model: response.model, usage: [usageRecord(surface, response.model, taskId, null, null)] }; } });
      }
      // A change of intelligence surface always requires a new, explicitly
      // selected operation. It is NOT a transport retry inside FabricEngine.
      if (requested === 'llama-cpp-local') engine.attach({ ...local,
        identity: () => ({ id: 'llama-cpp-local', label: 'llama.cpp', kind: 'LOCAL_MODEL' }),
        connectionState: async () => this.registry.get('llama-cpp-local')!.state,
        execute: async request => {
          try { return await executeLlama(request, runId, model || LLAMA_MODEL, () => guard('llama-cpp-local')); }
          catch (error) {
            const code = error instanceof Error ? error.message : '';
            failure = controller.signal.aborted ? 'REVOKED' : /MODEL_NOT_PROVISIONED/.test(code) ? 'MODEL_NOT_PROVISIONED'
              : /MANIFEST|ASSET|ARCHIVE|MODEL_OR_BINARY/.test(code) ? 'RUNTIME_INTEGRITY_DENIED' : 'NATIVE_INFERENCE_FAILED';
            const d = this.registry.get('llama-cpp-local')!; d.surface!.lastFailure = failure; this.registry.register(d);
            throw Error('NATIVE_PROVIDER_FAILED');
          }
        } });
      if (this.vault && model) {
        for (const route of Object.values(API_ROUTES)) {
          if (requested === route.id) engine.attach(new ChatCompletionsProvider(route.id, this.vault, model, () => guard(route.id)));
        }
        const api = new ResponsesProvider(this.apiDestination, this.vault, model, () => guard('openai-api'));
        engine.attach({ ...local, identity: () => api.identity(), connectionState: () => api.connectionState(), entitlement: () => api.entitlement(), health: () => api.health(),
          execute: async request => { try { return await api.execute(request); } catch { const d = this.registry.get('openai-api')!; d.surface!.lastFailure = 'Provider request failed or revoked; raw response suppressed.'; this.registry.register(d); throw Error('PROVIDER_REQUEST_FAILED'); } } });
      }
      const existingUser=this.db.messagePage(state.conversationId,100).find(({message})=>message.taskId===taskId&&message.role==='user'&&message.content===safeContextText(prompt));
      const userMessageId = existingUser?.message.messageId??randomUUID();
      if(!existingUser)this.db.appendMessage({ conversationId: state.conversationId, messageId: userMessageId, parentId: null, role: 'user', content: safeContextText(prompt), timestamp: started, providerId: null, modelId: null, taskId, channel: 'connected-ai', tools: [], artifacts: [], usageIds: [], contextRefs: [runId], routingDecisionId: null });
      this.continuity.message(runId, userMessageId);
      const result = await engine.execute({ taskId, taskType: 'CONNECTED_CHAT', required: ['chat'], policy: 'LOCAL_FIRST', allowPaidApi: policy.allowPaidApi && (manualPaidChoice || policy.allowPaidFallback),
        maxPrivacy: policy.dataClass === 'LOCAL_ONLY' ? 'LOCAL' : undefined, dataClass: policy.dataClass,
        allowedProviderIds: requested ? policy.enabled.filter(id => id === requested) : policy.enabled.filter(id => id !== 'llama-cpp-local' && (id !== 'openai-api' || !!model)), authorizedDestinations: policy.clientDestinations },
      { taskId, prompt: safeContextText(prompt), context: operation.handoff, signal: controller.signal });
      const selected = result.audit.at(-1)?.selectedProviderId ?? null;
      if (!result.response || !selected) {
        const status = controller.signal.aborted ? 'STOPPED' : 'BLOCKED';
        this.receipt(taskId, status, selected, policy.dataClass, revision, Date.now() - started); this.continuity.finish(runId, status, null, selected, selection.model ?? null, failure);
        return { ok: false, status, taskId, operationId: runId, error: 'No compatible authorized provider completed the request.', audits: result.audit };
      }
      guard(selected);
      const text = safeContextText(result.response.text), d = this.registry.get(selected)!;
      d.state = 'AVAILABLE'; d.surface!.successfulRequests++; d.surface!.verification = 'INFERENCE_OBSERVED'; d.surface!.latencyMs = Date.now() - started; d.surface!.lastFailure = null; this.registry.register(d);
      if (d.privacyClass === 'REMOTE') this.bootstrapSurfaces?.observed(d.id);
      const assistantMessageId = randomUUID();
      this.db.appendMessage({ conversationId: state.conversationId, messageId: assistantMessageId, parentId: null, role: 'assistant', content: text, timestamp: Date.now(), providerId: selected, modelId: result.response.model, taskId, channel: 'connected-ai', tools: [], artifacts: [], usageIds: (result.response.usage ?? []).map(u => u.id), contextRefs: [runId], routingDecisionId: result.audit.at(-1)?.id ?? null });
      this.continuity.message(runId, assistantMessageId);
      this.receipt(taskId, 'SUCCESS', selected, policy.dataClass, revision, Date.now() - started); this.continuity.finish(runId, 'SUCCESS', text, selected, result.response.model, null, result.response.provenance);
      new SovereignMemory(this.db).ingestOperation(runId, () => guard(selected));
      return { ok: true, status: 'SUCCESS', resultState: 'PRODUCED', taskId, operationId: runId, text, providerId: selected, model: result.response.model, messageId:assistantMessageId, handoffHash: operation.handoffHash, contextUsage:operation.contextUsage,audits: result.audit };
    } catch {
      const status = controller.signal.aborted ? 'STOPPED' : 'BLOCKED';
      this.receipt(taskId, status, null, policy.dataClass, revision, Date.now() - started); this.continuity.finish(runId, status, null, null, selection.model ?? null);
      return { ok: false, status, taskId, operationId: runId, error: 'Connected request revoked, unsupported, or denied; no raw provider error is exposed.' };
    } finally { clearTimeout(timer); this.active.delete(runId); this.operationOwners.delete(runId); }
  }
  commitArtifact(runId: string, choice: ContinuationChoice, sourceOperationId: string) {
    this.authority.gate(runId);
    const prompt = JSON.stringify({ ...choice, sourceOperationId }), run = this.authority.run(runId)!;
    if (run.source !== 'USER_INPUT_GESTURE' || run.originalHash !== continuityHash(prompt)) throw Error('CONTINUITY_ARTIFACT_GESTURE_REQUIRED');
    if (this.disposed || this.consumed.has(runId)) throw Error('CONTINUITY_OPERATION_ALREADY_USED');
    this.consumed.add(runId);
    const revision = this.policy.revision, epoch = this.authority.revision();
    return this.continuity.commitArtifact(runId, choice, sourceOperationId, this.policy.snapshot().dataClass, () => {
      this.authority.gate(runId); if (this.disposed || revision !== this.policy.revision || epoch !== this.authority.revision()) throw Error('CONTINUITY_OPERATION_REVOKED');
    });
  }
  verify(runId: string, choice: ContinuationChoice, sourceOperationId: string, input: unknown) {
    const contract = checkedContract(input), prompt = JSON.stringify({ ...choice, sourceOperationId, contract });
    this.authority.gate(runId); const run = this.authority.run(runId)!;
    if (run.source !== 'USER_INPUT_GESTURE' || run.originalHash !== continuityHash(prompt) || this.consumed.has(runId)) throw Error('VERIFICATION_GESTURE_REQUIRED');
    const source = this.continuity.checkpoint(choice.taskId)?.operations.find(op => op.operationId === sourceOperationId);
    if (!source) throw Error('VERIFICATION_SUBJECT_NOT_FOUND');
    const revision = this.policy.revision, epoch = this.authority.revision();
    const gate = () => { this.authority.gate(runId); if (this.disposed || revision !== this.policy.revision || epoch !== this.authority.revision()) throw Error('VERIFICATION_REVOKED'); };
    const operation = this.continuity.begin(runId, prompt, null, null, this.policy.snapshot().dataClass, choice, 'VERIFICATION');
    this.consumed.add(runId);
    try {
      const receipt = new VerificationService(this.db).verify(sourceOperationId, contract, revision, epoch, gate);
      new SovereignMemory(this.db).ingestOperation(sourceOperationId, gate);
      this.continuity.finish(operation.operationId, 'SUCCESS', receipt.state + ': ' + receipt.scope, null, null);
      return receipt;
    } catch { this.continuity.finish(operation.operationId, 'BLOCKED', null, null, null, 'VERIFICATION_REVOKED_OR_INVALID'); throw Error('VERIFICATION_NOT_COMMITTED'); }
  }
  memory(taskId: string, query: string) {
    return new SovereignMemory(this.db).retrieve({ taskId, query, destination: { locality: 'LOCAL' }, maxChars: 2400 });
  }
  expandMemory(taskId: string, reference: MemoryReference) {
    if (typeof taskId !== 'string' || taskId.length > 200 || !reference || typeof reference.id !== 'string' || reference.id.length !== 64) throw Error('INVALID_MEMORY_REFERENCE');
    return new SovereignMemory(this.db).expand(reference, { taskId, destination: { locality: 'LOCAL' }, maxChars: 12000 });
  }
  recommend(taskId: string, contract: unknown) {
    const policy = this.policy.snapshot(), cp = this.continuity.checkpoint(taskId);
    if (cp?.dataClass === 'LOCAL_ONLY') policy.dataClass = 'LOCAL_ONLY';
    else if (cp?.dataClass === 'CLIENT_DATA' && policy.dataClass === 'GENERIC') policy.dataClass = 'CLIENT_DATA';
    return evidenceRoute(this.db, this.registry.list(), { taskId, taskType: 'SCOPED_RESULT', required: ['chat'], policy: 'LOCAL_FIRST',
      dataClass: policy.dataClass, maxPrivacy: policy.dataClass === 'LOCAL_ONLY' ? 'LOCAL' : undefined,
      allowPaidApi: policy.allowPaidApi && policy.allowPaidFallback, allowedProviderIds: policy.enabled, authorizedDestinations: policy.clientDestinations }, contract);
  }
  graph(taskId: string) {
    const record = this.db.graphRecord(taskId) as ConciliusGraph | null;
    if (record?.state === 'STARTED' && !this.graphs.has(taskId)) {
      record.nodes.forEach(n => { if (n.state === 'STARTED') n.state = 'INTERRUPTED'; });
      this.db.writeGraphRecord(taskId, { ...record, state: 'INTERRUPTED', reason: 'Restart does not replay graph operations' });
      return this.db.graphRecord(taskId);
    }
    if (record?.state === 'VERIFIED' && record.nodes.some(node => {
      if (node.state !== 'VERIFIED') return false;
      const op = this.continuity.checkpoint(taskId)?.operations.find(op => op.operationId === node.operationId);
      return !op || op.resultVerification?.state !== 'VERIFIED' || op.resultVerification.id !== node.verification?.id;
    })) return { ...record, state: 'REVIEW_REQUIRED' as const, reason: 'Historical graph proof is preserved, but a required current verification changed or expired' };
    return record;
  }
  async runOrganization(rootId:string,input:unknown) {
    const original=JSON.stringify(input),request=organizationRequest(input);
    this.authority.gate(rootId);const admission=this.authority.run(rootId)!;
    if(admission.originalHash!==continuityHash(original)||admission.source!=='USER_INPUT_GESTURE')throw Error('ORGANIZATION_ORIGINAL_MISMATCH');
    if(originalStrongRequirement(request.text))throw Error('STRONG_REQUIRED_NO_ATTESTED_BACKEND');
    await this.refresh();this.authority.gate(rootId);
    const prepared=organizeWork(request,this.registry.list(),this.policy.snapshot().enabled,this.policy.snapshot().economyModel);
    const result={...await this.runGraph(rootId,prepared.plan,original),organization:prepared.organization};
    this.db.writeGraphRecord(rootId,result);return result;
  }
  async runGraph(rootId: string, input: unknown, admittedOriginal?:string) {
    const original = admittedOriginal??JSON.stringify(input), plan = validateConciliusPlan(input);
    plan.nodes.forEach(node => { if (node.verification) checkedContract(node.verification); });
    if (plan.nodes.some(node => originalStrongRequirement(node.prompt))) throw Error('STRONG_REQUIRED_NO_ATTESTED_BACKEND');
    this.authority.gate(rootId); const admission = this.authority.run(rootId)!;
    if (admission.source !== 'USER_INPUT_GESTURE' || admission.originalHash !== continuityHash(original) || this.consumed.has(rootId) || this.db.task(rootId)) throw Error('GRAPH_GESTURE_OR_IDENTITY_DENIED');
    const policyRevision = this.policy.revision, epoch = this.authority.revision();
    const gate = () => { this.authority.gate(rootId); if (this.disposed || policyRevision !== this.policy.revision || epoch !== this.authority.revision()) throw Error('GRAPH_REVOKED'); };
    if (plan.nodes.some(node => !this.policy.snapshot().enabled.includes(node.providerId))) throw Error('GRAPH_PROVIDER_DISABLED');
    this.db.saveTask({ taskId: rootId, conversationId: rootId, goal: 'Concilius: ' + safeContextText(plan.nodes[0]!.prompt), currentTask: 'Bounded graph', instructions: [], findings: [], decisions: [], artifacts: [], openQuestions: [], pendingSteps: [], updatedAt: Date.now() });
    const coordinator = new ConciliusCoordinator(this.db, {
      gate, checkpoint: taskId => this.continuity.checkpoint(taskId),
      execute: (id, prompt, selection) => this.executeOperation(id, prompt, selection, false, rootId,selection.dependencyOperations),
      verify: (id, contract, check) => {
        const receipt = new VerificationService(this.db).verify(id, contract, policyRevision, epoch, () => { gate(); check(); });
        new SovereignMemory(this.db).ingestOperation(id, gate); return receipt;
      },
      stop: () => { this.authority.stop(rootId); this.active.forEach((c, id) => { if (this.operationOwners.get(id) === rootId) c.abort(); }); },
    });
    this.graphs.set(rootId, coordinator);
    try { return await coordinator.execute(rootId, plan); } finally { this.graphs.delete(rootId); }
  }
  private receipt(runId: string, status: string, provider: string | null, dataClass: string, revision: number, latency: number) {
    if (this.disposed) return;
    const task = this.db.task(runId)!;
    const destination = provider ? this.registry.get(provider)?.surface?.destination : null;
    const summary = safeContextText(`Connected AI ${status}; provider=${provider ?? 'NONE'}; destination=${destination ?? 'UNKNOWN'}; data=${dataClass}; policy=${revision}; latencyMs=${latency}; cost=UNKNOWN; OS tools=NONE`);
    task.evidence = [...(task.evidence ?? []), { id: 'connected:' + randomUUID(), source: 'MAIN_PROCESS', kind: 'step', status, summary, at: Date.now(), contentHash: createHash('sha256').update(summary).digest('hex') }];
    if (status === 'SUCCESS') task.completedWork = [...(task.completedWork ?? []), summary];
    task.updatedAt = Date.now(); this.db.saveTask(task);
  }
}
