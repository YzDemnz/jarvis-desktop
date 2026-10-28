import { app, BrowserWindow, ipcMain, Menu, safeStorage } from 'electron';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { authority, authorityHandle, onAuthorityStop } from '../authority';
import { fabricDatabase } from '../fabric/ipcFabric';
import { CredentialStore } from './CredentialStore';
import { API_DESTINATION, ConnectedAIService } from './ConnectedAIService';
import type { DataClass } from './ConnectedPolicy';
import type { ConnectedPolicy } from './ConnectedPolicy';
import { API_ROUTES } from './ChatCompletionsProvider';

let service: ConnectedAIService | null = null, credentials: BrowserWindow | null = null, unsubscribe: (() => void) | null = null;
let selectionCapture: { prompt: string; providerId: string; model: string; taskId: string; revision: number; at: number } | null = null;
let artifactCapture: { taskId: string; revision: number; sourceOperationId: string; at: number } | null = null;
let advancedCapture: { payload: string; at: number } | null = null;
let credentialProvider = 'openai-api', credentialDestination = API_DESTINATION;
export function connectedService(): ConnectedAIService { if (!service) throw Error('CONNECTED_NOT_INITIALIZED'); return service; }
const operative = ['ollama-local', 'openai-api', 'llama-cpp-local', 'bootstrap-local', 'codex-app-server', ...Object.keys(API_ROUTES)];
const channels = ['connected:snapshot', 'connected:refresh', 'connected:choose', 'connected:credential', 'connected:start-local', 'connected:execute', 'connected:checkpoint', 'connected:artifact', 'connected:verify', 'connected:memory', 'connected:memory-expand', 'connected:recommend', 'connected:graph', 'connected:graph-read','connected:organize'];
export function registerConnectedIpc(owner: BrowserWindow) {
  const directory = path.join(app.getPath('userData'), 'connected-ai');
  let vault: CredentialStore | null = null;
  try { vault = new CredentialStore(path.join(directory, 'credentials.json'), safeStorage); } catch { /* Locked/corrupt store does not disable local inference. Never downgrade encryption. */ }
  const fixtures = process.env.JARVIS_ALLOW_FIXTURES === '1';
  const endpoint = process.env.OLLAMA_HOST ?? 'http://127.0.0.1:11434';
  const api = fixtures && process.env.JARVIS_TEST_API_DESTINATION ? process.env.JARVIS_TEST_API_DESTINATION : API_DESTINATION;
  service = new ConnectedAIService(fabricDatabase(), authority, vault, directory, endpoint, api);
  unsubscribe = onAuthorityStop(id => service?.cancel(id));
  // Private isolated-preload channel. A public request cannot declare itself a
  // manual paid choice; the selected surface/model are sealed by the UI gesture.
  ipcMain.on('connected:capture-selection', (event, value: unknown) => {
    if (event.sender !== owner.webContents || event.senderFrame !== owner.webContents.mainFrame || !value || typeof value !== 'object') return;
    const v = value as Record<string, unknown>;
    if (typeof v.prompt !== 'string' || v.prompt.length > 16000 || typeof v.model !== 'string' || v.model.length > 200
      || !operative.includes(String(v.providerId))) return;
    if (typeof v.taskId !== 'string' || v.taskId.length > 200 || !Number.isSafeInteger(v.revision)) return;
    selectionCapture = { prompt: v.prompt, providerId: String(v.providerId), model: v.model, taskId: v.taskId, revision: v.revision as number, at: Date.now() };
  });
  ipcMain.on('connected:capture-artifact', (event, value: unknown) => {
    if (event.sender !== owner.webContents || event.senderFrame !== owner.webContents.mainFrame || !value || typeof value !== 'object') return;
    const v = value as Record<string, unknown>;
    if (typeof v.taskId !== 'string' || !v.taskId || v.taskId.length > 200 || !Number.isSafeInteger(v.revision) || typeof v.sourceOperationId !== 'string' || v.sourceOperationId.length > 200) return;
    artifactCapture = { taskId: v.taskId, revision: v.revision as number, sourceOperationId: v.sourceOperationId, at: Date.now() };
  });
  authorityHandle('connected:snapshot', () => service!.snapshot());
  ipcMain.on('connected:capture-advanced', (event, payload: unknown) => {
    if (event.sender !== owner.webContents || event.senderFrame !== owner.webContents.mainFrame || typeof payload !== 'string' || payload.length > 16000) return;
    advancedCapture = { payload, at: Date.now() };
  });
  const consumeAdvanced = (payload: string) => {
    const capture = advancedCapture; advancedCapture = null;
    if (!capture || Date.now() - capture.at > 30000 || capture.payload !== payload) throw Error('ADVANCED_GESTURE_REQUIRED');
  };
  authorityHandle('connected:verify', (_event, id: string, choice: { taskId: string; revision: number }, sourceOperationId: string, contract: unknown) => {
    consumeAdvanced(JSON.stringify({ ...choice, sourceOperationId, contract })); return service!.verify(id, choice, sourceOperationId, contract);
  });
  authorityHandle('connected:memory', (_event, taskId: unknown, query: unknown) => {
    if (typeof taskId !== 'string' || taskId.length > 200 || typeof query !== 'string' || query.length > 256) throw Error('INVALID_MEMORY_QUERY');
    return service!.memory(taskId, query);
  });
  authorityHandle('connected:recommend', (_event, taskId: unknown, contract: unknown) => {
    if (typeof taskId !== 'string' || taskId.length > 200) throw Error('INVALID_ROUTING_TASK');
    return service!.recommend(taskId, contract);
  });
  authorityHandle('connected:memory-expand', (_event, taskId: string, ref: import('./SovereignMemory').MemoryReference) => service!.expandMemory(taskId, ref));
  authorityHandle('connected:graph', (_event, id: unknown, input: unknown) => {
    if (typeof id !== 'string' || id.length > 160) throw Error('INVALID_GRAPH_ID');
    const payload = JSON.stringify(input); consumeAdvanced(payload); return service!.runGraph(id, input);
  });
  authorityHandle('connected:organize', (_event,id:string,input:unknown) => {
    if(typeof id!=='string')throw Error('ORGANIZATION_INVALID_ID');
    consumeAdvanced(JSON.stringify(input));return service!.runOrganization(id,input);
  });
  authorityHandle('connected:graph-read', (_event, id: unknown) => {
    if (typeof id !== 'string' || id.length > 160) throw Error('INVALID_GRAPH_ID'); return service!.graph(id);
  });
  authorityHandle('connected:refresh', () => service!.refresh());
  authorityHandle('connected:start-local', () => service!.startLocal());
  authorityHandle('connected:execute', (_event, id: unknown, prompt: unknown, selection: unknown) => {
    if (typeof id !== 'string' || typeof prompt !== 'string' || !selection || typeof selection !== 'object'
      || Object.keys(selection).some(key => !['providerId', 'model', 'continuation'].includes(key))) throw Error('INVALID_CONNECTED_REQUEST');
    const choice = selection as { providerId?: string; model?: string; continuation?: { taskId: string; revision: number } }, capture = selectionCapture;
    selectionCapture = null;
    if (!capture || Date.now() - capture.at > 30000 || capture.prompt !== prompt || capture.model !== (choice.model ?? '')
      || (choice.providerId !== undefined && choice.providerId !== capture.providerId)
      || (choice.continuation?.taskId ?? '') !== capture.taskId
      || (choice.continuation && (Object.keys(choice.continuation).some(k => !['taskId', 'revision'].includes(k)) || choice.continuation.revision !== capture.revision))) throw Error('CONNECTED_SELECTION_GESTURE_REQUIRED');
    return service!.execute(id, prompt, choice, ['openai-api', ...Object.keys(API_ROUTES)].includes(choice.providerId ?? '') && choice.providerId === capture.providerId);
  });
  authorityHandle('connected:checkpoint', (_event, id: unknown) => {
    if (typeof id !== 'string' || id.length > 200) throw Error('INVALID_CONTINUITY_TASK');
    return service!.continuity.checkpoint(id);
  });
  authorityHandle('connected:artifact', (_event, id: unknown, choice: unknown, sourceOperationId: unknown) => {
    const capture = artifactCapture; artifactCapture = null;
    if (typeof id !== 'string' || !choice || typeof choice !== 'object' || typeof sourceOperationId !== 'string' || !capture || Date.now() - capture.at > 30000) throw Error('CONTINUITY_ARTIFACT_GESTURE_REQUIRED');
    const c = choice as { taskId: string; revision: number };
    if (Object.keys(c).some(k => !['taskId', 'revision'].includes(k)) || c.taskId !== capture.taskId || c.revision !== capture.revision || sourceOperationId !== capture.sourceOperationId) throw Error('CONTINUITY_ARTIFACT_GESTURE_REQUIRED');
    return service!.commitArtifact(id, c, sourceOperationId);
  });
  authorityHandle('connected:choose', () => {
    const policy = service!.policy.snapshot();
    const change = (update: Partial<Omit<ConnectedPolicy, 'version'>>) => service!.policy.userChange(update);
    const menu = Menu.buildFromTemplate([
      { label: 'Clase de datos', submenu: (['GENERIC', 'CLIENT_DATA', 'LOCAL_ONLY'] as DataClass[]).map(dataClass => ({ id: 'connected-data-' + dataClass, label: dataClass, type: 'radio' as const, checked: policy.dataClass === dataClass, click: () => change({ dataClass }) })) },
      { label: 'Destinos habilitados', submenu: operative.map(id => ({ id: 'connected-enable-' + id, label: id, type: 'checkbox' as const, checked: policy.enabled.includes(id), click: () => change({ enabled: policy.enabled.includes(id) ? policy.enabled.filter(x => x !== id) : [...policy.enabled, id] }) })) },
      { id: 'connected-paid', label: 'Permitir API de pago (separada de suscripción)', type: 'checkbox', checked: policy.allowPaidApi, click: () => change({ allowPaidApi: !policy.allowPaidApi }) },
      { id: 'connected-paid-fallback', label: 'Permitir además fallback automático a API de pago', type: 'checkbox', enabled: policy.allowPaidApi, checked: policy.allowPaidFallback, click: () => change({ allowPaidFallback: !policy.allowPaidFallback }) },
      { id: 'connected-client-api', label: 'Autorizar CLIENT_DATA a ' + api, type: 'checkbox', checked: policy.clientDestinations.includes(api), click: () => change({ clientDestinations: policy.clientDestinations.includes(api) ? policy.clientDestinations.filter(d => d !== api) : [...policy.clientDestinations, api] }) },
      { id: 'connected-revoke-credential', label: 'Revocar credencial OpenAI API', enabled: !!service!.vault, click: () => { service!.cancelAll(); service!.vault?.remove('openai-api'); } },
      ...Object.values(API_ROUTES).map(route => ({ id: 'connected-client-' + route.id, label: 'Autorizar CLIENT_DATA a ' + route.destination, enabled: route.id !== 'openrouter-api', type: 'checkbox' as const, checked: policy.clientDestinations.includes(route.destination), click: () => change({ clientDestinations: policy.clientDestinations.includes(route.destination) ? policy.clientDestinations.filter(d => d !== route.destination) : [...policy.clientDestinations, route.destination] }) })),
      ...Object.values(API_ROUTES).map(route => ({ id: 'connected-revoke-' + route.id, label: 'Revocar ' + route.label, click: () => { service!.cancelAll(); service!.vault?.remove(route.id); } })),
    ]);
    menu.popup({ window: owner }); return true;
  });
  authorityHandle('connected:credential', (_event, provider: unknown = 'openai-api') => {
    if (!['openai-api', ...Object.keys(API_ROUTES)].includes(String(provider))) throw Error('INVALID_CREDENTIAL_PROVIDER');
    if (!service!.vault) throw Error('CREDENTIAL_ENCRYPTION_UNAVAILABLE');
    if (credentials) { credentials.focus(); return true; }
    credentialProvider = String(provider); credentialDestination = credentialProvider === 'openai-api' ? api : API_ROUTES[credentialProvider as keyof typeof API_ROUTES].destination;
    credentials = new BrowserWindow({ parent: owner, modal: true, width: 520, height: 310, title: 'Credencial de proveedor', autoHideMenuBar: true,
      webPreferences: { preload: path.join(path.dirname(fileURLToPath(import.meta.url)), 'credential-preload.cjs'), sandbox: true, contextIsolation: true, nodeIntegration: false, devTools: false } });
    credentials.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    credentials.webContents.on('will-navigate', e => e.preventDefault());
    const html = `<!doctype html><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; form-action 'none'"><style>body{font:16px system-ui;background:#101214;color:#eee;padding:24px}input{width:95%;padding:8px}button{margin-top:18px;padding:10px}</style><h3>${credentialProvider} · credencial privada</h3><p>Destino fijo: ${credentialDestination}. No se incorpora al chat. DPAPI de Windows; no protege frente a programas maliciosos bajo tu misma cuenta.</p><form><input type="password" aria-label="Credencial privada" autocomplete="off" maxlength="16384" required><button type="submit">Guardar credencial</button></form>`;
    void credentials.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));
    credentials.once('closed', () => { credentials = null; }); return true;
  });
  ipcMain.on('credentials:submit', (event, value: unknown) => {
    if (!credentials || event.sender !== credentials.webContents || event.senderFrame !== credentials.webContents.mainFrame || typeof value !== 'string') return;
    try { service!.vault!.put(credentialProvider, credentialDestination, value); service!.cancelAll(); credentials.close(); }
    catch { credentials.webContents.send('credentials:failed'); }
  });
}
export function unregisterConnectedIpc() {
  channels.forEach(c => ipcMain.removeHandler(c)); ipcMain.removeAllListeners('credentials:submit'); ipcMain.removeAllListeners('connected:capture-selection'); ipcMain.removeAllListeners('connected:capture-artifact'); ipcMain.removeAllListeners('connected:capture-advanced'); selectionCapture = null; artifactCapture = null; advancedCapture = null;
  credentials?.close(); unsubscribe?.(); unsubscribe = null;
  void service?.dispose(); service = null;
}
