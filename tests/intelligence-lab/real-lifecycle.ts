import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import { execFileSync } from 'node:child_process';
import { ACPProcessManager } from '../../src/intelligence/transports/acp/ACPProcessManager';
import { ACPTransport } from '../../src/intelligence/transports/acp/ACPTransport';
import { ACPPermissionBridge } from '../../src/intelligence/transports/acp/ACPPermissionBridge';
import { ACPSessionManager } from '../../src/intelligence/transports/acp/ACPSessionManager';
import type { ACPAgentProfile } from '../../src/intelligence/transports/acp/ACPAgentProfile';
import { OpenCodeProcessManager } from '../../src/intelligence/opencode/OpenCodeProcessManager';
import { OpenCodeBridge } from '../../src/intelligence/opencode/OpenCodeBridge';
import { ExternalComponentRegistry } from '../../src/intelligence/lab/ExternalComponentRegistry';
import { repo, harness, tempLab } from './lab-harness';
const root = tempLab(); const cwd = path.join(root, 'project'); fs.mkdirSync(cwd);
fs.writeFileSync(path.join(cwd, 'package.json'), '{"name":"acp-temp"}');
const h = await harness(root); const registry = new ExternalComponentRegistry();
const sdkVersion = JSON.parse(fs.readFileSync(path.join(repo, 'node_modules/@agentclientprotocol/sdk/package.json'), 'utf8')).version;
registry.register({ component: '@agentclientprotocol/sdk', installedVersion: sdkVersion, testedVersion: '1.5.0', protocolVersion: 'ACP 1', compatibleRange: '=1.5.0', lastSuccessfulValidation: null });
const evidence: Record<string, unknown> = { at: new Date().toISOString(), baseline: '3395ec6', temp: root, productionRouting: false, credentialsReadByHarness: false };
for (const [id, pkg, version, env] of [
  ['codex', '@agentclientprotocol/codex-acp', '1.13.1', { INITIAL_AGENT_MODE: 'read-only', NO_BROWSER: '1', CODEX_CONFIG: JSON.stringify({ sandbox_mode: 'read-only', approval_policy: 'on-request', mcp_servers: {} }) }],
  ['claude', '@agentclientprotocol/claude-agent-acp', '0.81.2', {}],
] as const) {
  const manifest = JSON.parse(fs.readFileSync(path.join(repo, 'node_modules', pkg, 'package.json'), 'utf8'));
  const profile: ACPAgentProfile = { id: `${id}-lab`, name: `${id} ACP`, command: process.execPath,
    args: [path.join(repo, 'node_modules', pkg, 'dist/index.js')], version,
    capabilities: [], authenticationMode: 'OFFICIAL_MANAGED', supportsResume: false, supportsCancel: true,
    supportsUsage: false, supportsTools: false, supportsMCP: false, workingDirectoryPolicy: 'TEMP_ONLY', environmentPolicy: 'ALLOWLIST', environment: { ...env }, promptSafety: 'UNVERIFIED' };
  const manager = new ACPProcessManager(profile, cwd); const transport = new ACPTransport(manager, new ACPPermissionBridge(h.broker, h.runId), 20000);
  const sessions = new ACPSessionManager(transport);
  registry.register({ component: pkg, installedVersion: manifest.version, testedVersion: version, protocolVersion: 'ACP 1', compatibleRange: `=${version}`, lastSuccessfulValidation: null });
  const result: Record<string, unknown> = { packageVersion: manifest.version, status: 'FAIL', prompt: 'SECURITY_GATE_BLOCKED', tools: 'UNVERIFIED_INTERNAL_EXECUTION', auth: 'UNKNOWN' };
  let releaseTask: (() => void) | undefined;
  try {
    if (!registry.compatible(pkg)) throw new Error('Version mismatch');
    if (!registry.compatible('@agentclientprotocol/sdk')) throw new Error('ACP SDK version mismatch');
    releaseTask = await manager.leases.acquire();
    const init = await transport.connect();
    registry.validated('@agentclientprotocol/sdk');
    result.initialize = { version: init.protocolVersion, capabilities: init.agentCapabilities, authMethods: init.authMethods?.map(a => ({ id: a.id, name: a.name })), agent: init.agentInfo };
    try { const session = await sessions.create('jarvis-42'); result.sessionCreated = true; result.sessionModes = session.modes; result.auth = 'SESSION_AVAILABLE_NOT_ENTITLEMENT_PROOF';
      if (init.agentCapabilities?.loadSession) {
        try { await sessions.resume('jarvis-42', session.sessionId); result.resume = true; }
        catch (error) { result.resume = false; result.resumeErrorCode = (error as { code?: number }).code; result.resumeScope = 'EMPTY_SESSION_NO_PROMPT_SECURITY_GATE'; }
      } }
    catch (error) { result.sessionCreated = false; result.auth = sessions.authState;
      const details = JSON.stringify((error as { data?: unknown }).data ?? '');
      result.sessionError = { code: (error as { code?: number }).code, message: String(error).replace(/(?:sk-|eyJ)[A-Za-z0-9_.-]+/g, '[REDACTED]').slice(0, 400),
        categories: ['config', 'sandbox', 'approval', 'variant', 'field', 'model', 'version', 'unsupported', 'invalid', 'load'].filter(k => details.toLowerCase().includes(k)) }; }
    await new Promise(resolve => setTimeout(resolve, 1200));
    result.authKind = transport.authKind;
    if (transport.authKind === 'none') result.auth = 'AUTH_REQUIRED';
    if (transport.authKind === 'account') result.auth = 'OFFICIAL_ACCOUNT_REPORTED';
    result.status = 'PASS_WITH_RESTRICTIONS'; registry.validated(pkg);
  } catch (error) { result.error = /timeout/i.test(String(error)) ? 'STARTUP_TIMEOUT' : 'LIFECYCLE_FAILED'; }
  finally { releaseTask?.(); await transport.close(); await manager.leases.dispose(); result.cleanShutdown = manager.child === null; evidence[id] = result; }
  console.log(`${id}: ${JSON.stringify(result)}`);
}
const port = await new Promise<number>((resolve, reject) => { const s = net.createServer(); s.on('error', reject); s.listen(0, '127.0.0.1', () => { const p = (s.address() as net.AddressInfo).port; s.close(() => resolve(p)); }); });
const server = new OpenCodeProcessManager(path.join(repo, 'node_modules/opencode-ai/bin/opencode.exe'), cwd, port, '1.18.32');
const open = new OpenCodeBridge(server); const result: Record<string, unknown> = { status: 'FAIL', lazyBeforeStart: server.state === 'STOPPED' };
let releaseServer: (() => void) | undefined;
try {
  const binaryVersion = execFileSync(server.profile.command, ['--version'], { encoding: 'utf8', windowsHide: true, timeout: 10000 }).trim();
  result.binaryVersion = binaryVersion;
  for (const component of ['opencode-ai', '@opencode-ai/sdk']) {
    const installed = JSON.parse(fs.readFileSync(path.join(repo, 'node_modules', component, 'package.json'), 'utf8')).version;
    registry.register({ component, installedVersion: component === 'opencode-ai' ? binaryVersion : installed, testedVersion: '1.18.32', protocolVersion: 'OpenCode HTTP v2 + legacy session', compatibleRange: '=1.18.32', lastSuccessfulValidation: null });
    if (!registry.compatible(component)) throw new Error('Version mismatch');
  }
  releaseServer = await open.leaseTask(); server.child?.stdout?.resume();
  result.health = (await open.health()).data;
  result.unauthenticatedStatus = (await fetch(`${server.baseUrl}/v2/health`, { signal: AbortSignal.timeout(3000) })).status;
  if (result.unauthenticatedStatus !== 401) throw new Error('SECURITY_FAILURE: unauthenticated server access');
  const metadata = await open.metadata();
  result.agents = metadata.agents.data?.map(a => ({ name: a.name, mode: a.mode }));
  result.providers = metadata.providers.data?.connected;
  result.project = !!metadata.project.data;
  await open.validateProposalConfiguration(); result.proposalConfiguration = 'ALL_TOOLS_DISABLED_AND_DENIED';
  const session = await open.createSession(); const id = session.data!.id;
  result.sessionCreated = true;
  result.context = (await open.context(id)).data?.length;
  const eventsAbort = new AbortController(); const events = await open.events(eventsAbort.signal);
  const stream = events.stream[Symbol.asyncIterator]();
  const event = await stream.next(); result.streamEvent = event.value?.type;
  result.streamContract = typeof events.stream[Symbol.asyncIterator] === 'function'; eventsAbort.abort(); await stream.return?.();
  result.cancel = (await open.cancel(id)).data;
  await server.stop(); result.cleanShutdown = server.child === null;
  await server.ready(); result.restartHealth = (await open.health()).data;
  // Guardian force-stops its own subtree without the manager's graceful state transition.
  const crashed = server.child!; const death = new Promise(resolve => crashed.once('exit', resolve));
  crashed.send('stop'); await death; result.crashDetected = server.state === 'CRASHED';
  await server.ready(); result.crashRecovery = (await open.health()).data;
  result.status = 'PASS_WITH_RESTRICTIONS';
  registry.validated('opencode-ai'); registry.validated('@opencode-ai/sdk');
} catch (error) { result.error = String(error).replace(/Basic\s+\S+/g, '[REDACTED]').slice(0, 500); }
finally { releaseServer?.(); await server.stop(); await server.leases.dispose(); evidence.opencode = result; }
evidence.components = registry.list();
fs.mkdirSync(path.join(repo, 'docs/evidence/phase-a'), { recursive: true });
fs.writeFileSync(path.join(repo, 'docs/evidence/phase-a/real-lifecycle.json'), JSON.stringify(evidence, null, 2));
console.log(`opencode: ${JSON.stringify(result)}`);
h.broker.closeRun(h.runId); await h.dev.cancelRun(h.runId);
