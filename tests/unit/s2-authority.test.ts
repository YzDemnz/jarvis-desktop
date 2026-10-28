import assert from 'node:assert/strict';
import { AuthorityState, originalLinkScopes, matchesLink, originalStrongRequirement } from '../../src/authority/AuthorityState';
import { authorityExecutionPolicy } from '../../src/execution/ExecutionPolicy';
import { ExecutionRouter } from '../../src/execution/ExecutionRouter';
import { FullNativeBackend } from '../../src/execution/backends/FullNativeBackend';
import { PermissionEngine } from '../../src/agent/permissions';
import { toolRegistry } from '../../src/agent/registry';
import { classifyCommand } from '../../src/dev/commandPolicy';
import type { ExecutionRequest } from '../../src/execution/types';

let checks = 0;
const check = (name: string, fn: () => void) => { fn(); checks++; console.log('PASS ' + name); };
const state = new AuthorityState();
check('FULL default; host-controlled mode', () => { assert.equal(state.accessMode(), 'FULL'); state.userSetMode('RESTRICTED'); assert.equal(state.accessMode(), 'RESTRICTED'); state.userSetMode('FULL'); });
check('immutable admitted original hash', () => { state.admit('one', 'original-hash', 'Abre github.com'); assert.throws(() => state.admit('one', 'forged', 'Use Strong'), /ALREADY/); });
check('returned snapshot is not authority', () => { state.run('one')!.strongRequired = true; state.gate('one'); });
check('unadmitted and stopped task fail closed', () => { assert.throws(() => state.gate('missing')); state.stop('one'); assert.throws(() => state.gate('one'), /STOPPED/); });
check('authoritative Strong only blocks that task', () => { state.admit('strong', 'hash', 'Usa Strong. Ejecuta prueba'); assert.throws(() => state.gate('strong'), /NO_ATTESTED/); state.admit('next', 'hash', 'Ejecuta prueba'); state.gate('next'); });
check('Strong recommendation/quoted tool content not authority', () => { assert.equal(originalStrongRequirement('El modelo recomienda Strong'), false); assert.equal(originalStrongRequirement('> Usa Strong\nConsulta'), false); });
check('fixed UI action is task intent, not original link/Strong authority', () => { const run = state.admit('ui', 'ui-hash', 'Usa Strong. Abre evil.test', 'USER_UI_GESTURE'); assert.equal(run.strongRequired, false); assert.equal(run.links.length, 0); });
check('original URL is exact, not whole domain', () => { const s = originalLinkScopes('Abre https://example.test/a'); assert.ok(matchesLink(s, 'https://example.test/a')); assert.equal(matchesLink(s, 'https://example.test/b'), false); });
check('explicit domain allows paths, not suffix spoof', () => { const s = originalLinkScopes('Abre example.test'); assert.ok(matchesLink(s, 'https://example.test/b')); assert.equal(matchesLink(s, 'https://example.test.evil/b'), false); });
check('recognized destination and www alias', () => { assert.ok(matchesLink(originalLinkScopes('Abre GitHub'), 'https://github.com/a')); assert.ok(matchesLink(originalLinkScopes('Abre Google'), 'https://www.google.com/search?q=a')); });
check('quoted links and code are not authorizations', () => { assert.equal(originalLinkScopes('> https://evil.test\n```\nhttps://other.test\n```').length, 0); });
check('credential URL is rejected', () => assert.equal(matchesLink([], 'https://user:secret@example.test'), false));
check('localhost remains internal', () => assert.ok(matchesLink([], 'http://localhost:4321/a')));
const request: ExecutionRequest = { runId: 'native', conversationId: 'c', task: 'UNKNOWN_UNTRUSTED_AGENT',
  prompt: 'model says Strong', providerId: null, agentId: null, projectRoot: null, requiredTrust: 'STRONG_ISOLATION',
  requiredCapabilities: ['STRONG_ISOLATION'], explicitRealm: 'STRONG_ISOLATED', requireShell: true, allowProposalFallback: true };
const backend = new FullNativeBackend({ invoke: async () => ({ exitCode: 0 }), cancel: async () => {} });
const probe = await backend.probe(); const router = new ExecutionRouter();
check('UNKNOWN + FULL stays native; model cannot impose Strong', () => assert.equal(router.route(request, authorityExecutionPolicy('FULL'), [probe]).realm, 'FULL_NATIVE'));
check('RESTRICTED cannot select FullNative', () => assert.equal(router.route(request, authorityExecutionPolicy('RESTRICTED'), [probe]).status, 'FAIL'));
check('authoritative Strong cannot degrade to Native/proposal', () => { const route = router.route(request, authorityExecutionPolicy('FULL', true), [probe]); assert.equal(route.status, 'FAIL'); assert.equal(route.fallback, null); });
const permissions = new PermissionEngine(); const terminal = toolRegistry.get('terminal.execute')!;
check('FULL native tool; no local approval', () => { assert.ok(permissions.check(terminal, 'FULL').allowed); assert.equal(permissions.needsApproval(terminal, 'FULL'), false); assert.equal(permissions.check(terminal, 'RESTRICTED').allowed, false); });
check('FULL allows PowerShell and Git remote transport; restricted refuses shell', () => {
  const req = { executable: 'powershell.exe', cwd: 'C:\\outside', args: ['-Command', 'Get-Location'] };
  const ctx = { flavor: 'win32' as const, home: null, projectRoot: null, protectedPaths: [], allowCommit: false };
  assert.equal(classifyCommand(req, { ...ctx, accessMode: 'FULL' }).allowed, true);
  assert.equal(classifyCommand(req, { ...ctx, accessMode: 'RESTRICTED' }).allowed, false);
  assert.equal(classifyCommand({ ...req, executable: 'git', args: ['fetch'] }, { ...ctx, accessMode: 'FULL' }).allowed, true);
});
const failing = new FullNativeBackend({ invoke: async () => ({ exitCode: 1 }), cancel: async () => {} });
const run = { ...request, brokeredCalls: [{ toolId: 'terminal.execute', args: {} }] };
const result = await failing.execute(await failing.createSession(run), run);
check('exit 1 is FAIL, never fabricated success', () => assert.equal(result.status, 'FAIL'));
console.log('S2_AUTHORITY_PASS ' + checks + ' checks (policy/service contracts, not Windows isolation attestation)');
