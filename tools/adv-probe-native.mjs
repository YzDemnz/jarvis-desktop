import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { createHash, randomBytes } from 'node:crypto';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';

// READ-ONLY protocol/account diagnostics. There is no method for prompts,
// threads, logins, process execution, credits, resets or configuration writes.
const methods = new Set(['initialize', 'initialized', 'account/read', 'model/list', 'configRequirements/read', 'account/rateLimits/read']);
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'jarvis-adv-native-probe-'));
const require = createRequire(import.meta.url);
// Existing test dependency only; this experimental transport is not a product adapter.
const { ws: WebSocket } = require(path.join(path.dirname(require.resolve('playwright-core/package.json')), 'lib/utilsBundle.js'));
await build({ entryPoints: ['electron/process/WindowsJobProcess.ts'], outfile: path.join(root, 'owned-job.mjs'), bundle: true, platform: 'node', format: 'esm' });
const { spawnWindowsJob, ownedProcessCount } = await import(pathToFileURL(path.join(root, 'owned-job.mjs')));
const report = { at: new Date().toISOString(), status: 'STARTED', probe: 'OFFICIAL_READONLY_RPC',
  inference: 'NOT_VERIFIED', execution: 'POLICY_BLOCKED_PREEXISTING', paidApiCalls: 0, prompts: 0, createdThreads: 0,
  loginStarted: false, credentialFilesReadByProbe: false, credentialsExtracted: false,
  transport: 'CODEX_APP_SERVER_LOOPBACK_WEBSOCKET_EXPERIMENTAL', productionTransport: false,
  limitation: 'The current owned Job launcher supplies NUL as child stdin. An interactive stdio bridge needs a separately validated process-host extension; WebSocket is diagnostic only.',
  sources: ['https://learn.chatgpt.com/docs/app-server', 'https://learn.chatgpt.com/docs/auth', 'https://developers.openai.com/siwc/token-sharing-open-source/codex-app-server'],
};
let child, socket;
const ceiling = setTimeout(() => { socket?.on('error', () => {}); socket?.terminate(); void child?.killTree(); }, 60000);
const pending = new Map(); let nextId = 0;
const token = randomBytes(32).toString('hex'), tokenSHA = createHash('sha256').update(token).digest('hex');
function safeCode(error) { return /^RPC_\d+$/.test(error?.message ?? '') ? error.message : ['PROBE_CONNECT_TIMEOUT', 'PROBE_RPC_TIMEOUT', 'PROBE_UNEXPECTED_SERVER_REQUEST', 'PROBE_INVALID_RPC', 'PROBE_CLOSED', 'CODEX_NOT_DETECTED'].includes(error?.message) ? error.message : 'PROBE_FAILED'; }
function rpc(method, params) {
  if (!methods.has(method)) throw Error('PROBE_METHOD_NOT_ALLOWED');
  const id = ++nextId;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { pending.delete(id); reject(Error('PROBE_RPC_TIMEOUT')); }, 10000);
    pending.set(id, { resolve: value => { clearTimeout(timer); resolve(value); }, reject: error => { clearTimeout(timer); reject(error); } });
    socket.send(JSON.stringify({ id, method, ...(params === undefined ? {} : { params }) }));
  });
}
function notification(method, params) { if (!methods.has(method)) throw Error('PROBE_METHOD_NOT_ALLOWED'); socket.send(JSON.stringify({ method, params })); }
function windowProjection(value) {
  if (!value || typeof value !== 'object') return null;
  const number = n => typeof n === 'number' && Number.isFinite(n) && n >= 0 ? n : null;
  return { usedPercent: number(value.usedPercent), windowDurationMins: number(value.windowDurationMins), resetsAt: number(value.resetsAt) };
}
try {
  if (process.platform !== 'win32') throw Error('PROBE_FAILED');
  const base = path.join(process.env.LOCALAPPDATA ?? '', 'OpenAI/Codex/bin');
  const files = fs.readdirSync(base, { withFileTypes: true }).filter(item => item.isDirectory()).map(item => path.join(base, item.name, 'codex.exe')).filter(file => fs.existsSync(file));
  const exe = files[0]; if (!exe) throw Error('CODEX_NOT_DETECTED');
  report.binarySHA256 = createHash('sha256').update(fs.readFileSync(exe)).digest('hex');
  const reserve = net.createServer(); await new Promise(resolve => reserve.listen(0, '127.0.0.1', resolve));
  const port = reserve.address().port; await new Promise(resolve => reserve.close(resolve));
  const endpoint = 'ws://127.0.0.1:' + port;
  const env = {};
  for (const name of ['SystemRoot', 'WINDIR', 'TEMP', 'TMP', 'LOCALAPPDATA', 'APPDATA', 'USERPROFILE']) if (process.env[name]) env[name] = process.env[name];
  env.PATH = path.dirname(exe) + ';' + path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32');
  report.environmentNames = Object.keys(env); report.authLifecycle = 'OFFICIAL_PROVIDER_MANAGED_NO_TOKEN_HANDOFF';
  child = spawnWindowsJob({ file: exe, args: ['app-server', '--listen', endpoint, '--ws-auth', 'capability-token', '--ws-token-sha256', tokenSHA,
    '-c', 'analytics.enabled=false'], cwd: root, env });
  child.onStdout(() => {}); child.onStderr(() => {}); await child.ready;
  report.pid = child.pid; report.ownership = child.ownership;
  const connectUntil = Date.now() + 20000;
  while (true) {
    try {
      socket = new WebSocket(endpoint, { headers: { Authorization: 'Bearer ' + token }, handshakeTimeout: 1000, maxPayload: 1024 * 1024 });
      await new Promise((resolve, reject) => { socket.once('open', resolve); socket.once('error', reject); }); break;
    } catch { socket?.on('error', () => {}); socket?.terminate(); if (Date.now() > connectUntil) throw Error('PROBE_CONNECT_TIMEOUT'); await new Promise(resolve => setTimeout(resolve, 100)); }
  }
  socket.on('error', () => { for (const item of pending.values()) item.reject(Error('PROBE_CLOSED')); pending.clear(); });
  socket.on('close', () => { for (const item of pending.values()) item.reject(Error('PROBE_CLOSED')); pending.clear(); });
  socket.on('message', bytes => {
    let message; try { message = JSON.parse(bytes.toString()); } catch { for (const item of pending.values()) item.reject(Error('PROBE_INVALID_RPC')); pending.clear(); return; }
    if (message.id !== undefined && message.method) {
      // No read diagnostic may turn into an approved side effect. Ignore the
      // contents and close our own transport/process if the server asks one.
      for (const item of pending.values()) item.reject(Error('PROBE_UNEXPECTED_SERVER_REQUEST')); pending.clear(); socket.terminate(); return;
    }
    const item = pending.get(message.id); if (!item) return; pending.delete(message.id);
    if (message.error) item.reject(Error('RPC_' + (Number.isInteger(message.error.code) ? message.error.code : 0)));
    else item.resolve(message.result);
  });
  const initialization = await rpc('initialize', { clientInfo: { name: 'jarvis_readonly_probe', title: 'JARVIS read-only probe', version: '1.0.0' } });
  notification('initialized', {}); report.initialized = !!initialization;
  const account = await rpc('account/read', { refreshToken: false });
  const accountTypes = ['chatgpt', 'apiKey', 'amazonBedrock', 'agentIdentity', 'personalAccessToken'];
  report.auth = { accountType: accountTypes.includes(account?.account?.type) ? account.account.type : account?.account == null ? 'NONE' : 'UNKNOWN',
    requiresOpenaiAuth: typeof account?.requiresOpenaiAuth === 'boolean' ? account.requiresOpenaiAuth : null,
    accountEmailStored: false, tokensStored: false, entitlement: 'NOT_VERIFIED' };
  const catalog = await rpc('model/list', { limit: 20, includeHidden: false });
  report.catalog = { source: 'OFFICIAL_MODEL_LIST_NOT_ENTITLEMENT', models: (Array.isArray(catalog?.data) ? catalog.data : []).slice(0, 20).map(item => ({
    model: typeof item.model === 'string' && /^[a-zA-Z0-9._:/-]{1,100}$/.test(item.model) ? item.model : 'UNKNOWN',
    isDefault: item.isDefault === true, inputModalities: Array.isArray(item.inputModalities) ? item.inputModalities.filter(value => ['text', 'image', 'audio', 'video'].includes(value)) : [],
  })) };
  try {
    const response = await rpc('configRequirements/read', {}), requirements = response?.requirements;
    report.managedRequirements = { present: !!requirements,
      allowedSandboxModes: Array.isArray(requirements?.allowedSandboxModes) ? requirements.allowedSandboxModes.filter(value => ['readOnly', 'workspaceWrite', 'dangerFullAccess'].includes(value)) : null,
      allowedApprovalPolicies: Array.isArray(requirements?.allowedApprovalPolicies) ? requirements.allowedApprovalPolicies.filter(value => ['onRequest', 'never', 'unlessTrusted', 'granular'].includes(value)) : null };
  } catch (error) { report.managedRequirements = { status: 'NOT_AVAILABLE', code: safeCode(error) }; }
  try {
    const response = await rpc('account/rateLimits/read', {});
    const limits = response?.rateLimitsByLimitId ?? (response?.rateLimits ? { current: response.rateLimits } : {});
    report.quota = { source: 'OFFICIAL_RATE_LIMITS_READ', observed: Object.entries(limits).slice(0, 20).map(([id, item]) => ({
      id: /^[a-zA-Z0-9._-]{1,100}$/.test(id) ? id : 'UNKNOWN', primary: windowProjection(item.primary), secondary: windowProjection(item.secondary) })),
      cost: 'UNKNOWN', resetsConsumed: 0 };
  } catch (error) { report.quota = { source: 'UNKNOWN', code: safeCode(error) }; }
  report.status = 'PROTOCOL_ONLY';
} catch (error) { report.status = 'BLOCKED'; report.error = safeCode(error); }
finally {
  clearTimeout(ceiling);
  socket?.on('error', () => {}); socket?.terminate();
  await child?.killTree(); report.ownedProcessesAfterCleanup = ownedProcessCount(); report.cleanShutdown = ownedProcessCount() === 0;
}
const evidence = path.resolve('docs/evidence/adv/native'); fs.mkdirSync(evidence, { recursive: true });
const file = path.join(evidence, 'codex-readonly-' + Date.now() + '.json'); fs.writeFileSync(file, JSON.stringify(report, null, 2));
console.log(JSON.stringify({ ...report, evidenceFile: file }, null, 2));
if (report.status === 'BLOCKED') process.exitCode = 1;
