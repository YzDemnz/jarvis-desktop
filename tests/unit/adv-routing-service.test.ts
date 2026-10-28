import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { FabricDatabase } from '../../electron/fabric/FabricDatabase';
import { TaskContinuity } from '../../electron/connected/TaskContinuity';
import { VerificationService } from '../../electron/connected/VerificationService';
import { evidenceRoute } from '../../electron/connected/OutcomeRouting';
import { ConnectedAIService } from '../../electron/connected/ConnectedAIService';
import { AuthorityState } from '../../src/authority/AuthorityState';
import { continuityHash } from '../../electron/connected/TaskContinuity';
import type { ProviderDescriptor } from '../../src/fabric/types';
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'jarvis-adv-routing-')), db = new FabricDatabase(path.join(root, 'db.sqlite'));
const journal = new TaskContinuity(db, path.join(root, 'artifacts')), verifier = new VerificationService(db);
let checks = 0; const pass = (s: string) => { checks++; console.log('PASS ' + s); };
const contract = { kind: 'TEXT_EXACT', expected: 'correct' };
const provider = (id: string): ProviderDescriptor => ({ id, label: id, kind: 'LOCAL_MODEL', state: 'AVAILABLE', capabilities: [{ id: 'chat', strength: 1, available: true }], costClass: 'LOCAL', privacyClass: 'LOCAL', quota: 'UNKNOWN', quality: 0, contextLimit: null, healthCheckedAt: null });
for (const [id, surface, text] of [['a', 'local-a', 'wrong'], ['b', 'local-b', 'correct']]) {
  db.saveTask({ taskId: id!, conversationId: id!, goal: 'owned', currentTask: '', instructions: [], findings: [], decisions: [], artifacts: [], openQuestions: [], pendingSteps: [], updatedAt: 0 });
  journal.begin(id!, 'reply', surface!, 'owned-model', 'LOCAL_ONLY'); journal.finish(id!, 'SUCCESS', text!, surface!, 'owned-model'); verifier.verify(id!, contract, 0, 0, () => {});
}
const request = { taskId: 'route', taskType: 'TEXT_EXACT', required: ['chat' as const], policy: 'LOCAL_FIRST' as const, allowPaidApi: false };
const learned = evidenceRoute(db, [provider('local-a'), provider('local-b')], request, contract);
assert.equal(learned.audit.selectedProviderId, 'local-b'); assert.equal(learned.model, 'owned-model'); assert.equal(learned.observations.length, 2); pass('Comparable actual verification outcomes affect eligible provider/model recommendation');
verifier.verify('b', { kind: 'MODEL_REVIEW' }, 0, 0, () => {}); assert.equal(evidenceRoute(db, [provider('local-a'), provider('local-b')], request, contract).observations.length, 1); pass('Advisory latest verdict supersedes positive evidence; no model reputation fabricated');
const policyRoute = evidenceRoute(db, [{ ...provider('local-b'), privacyClass: 'REMOTE', costClass: 'PAID_API' }], { ...request, maxPrivacy: 'LOCAL' }, contract);
assert.equal(policyRoute.audit.selectedProviderId, null); pass('Past performance cannot override privacy or paid permission');
let responses = 0;
const server = http.createServer(async (req, res) => {
  let body = ''; for await (const b of req) body += b;
  res.setHeader('Content-Type', 'application/json');
  if (req.url === '/api/tags') return res.end(JSON.stringify({ models: [{ name: 'owned-model' }] }));
  if (req.url === '/api/version') return res.end('{"version":"fixture"}');
  if (req.url === '/api/show') return res.end('{}');
  if (req.url === '/api/generate') { responses++; return res.end(JSON.stringify({ response: '{"items":[]}', model: JSON.parse(body).model, prompt_eval_count: 10, eval_count: 5 })); }
  res.end('{}');
}); await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
const authority = new AuthorityState(), service = new ConnectedAIService(db, authority, null, path.join(root, 'connected'), 'http://127.0.0.1:' + (server.address() as any).port);
try {
  await service.refresh();
  const plan = { version: 1, dataClass: 'LOCAL_ONLY', nodes: [{ id: 'produce', role: 'producer', dependsOn: [], providerId: 'ollama-local', model: 'owned-model', prompt: 'Output items JSON', verification: { kind: 'JSON_SHAPE', fields: { items: 'array' } } }, { id: 'critic', role: 'critic', dependsOn: ['produce'], providerId: 'ollama-local', model: 'owned-model', prompt: 'Review JSON as advisory' }] };
  const prompt = JSON.stringify(plan); authority.admit('graph-unit', continuityHash(prompt), prompt);
  const graph = await service.runGraph('graph-unit', plan);
  assert.equal(graph.state, 'VERIFIED'); assert.equal(graph.nodes[1]!.state, 'ADVISORY'); assert.equal(responses, 2);
  assert.equal(authority.run('graph-unit-node-1'), null); assert.equal(service.continuity.checkpoint('graph-unit')!.dataClass, 'LOCAL_ONLY'); pass('Integrated coordinator reuses transport/journal with root-derived authorization, no invented child gestures');
  assert.throws(() => service.verify('missing-run', { taskId: 'graph-unit', revision: 2 }, 'graph-unit', { kind: 'MODEL_REVIEW' }), /NOT_ADMITTED/); pass('Public verifier requires independent admitted gesture');
  const planStrong = { ...plan, nodes: [{ ...plan.nodes[0], prompt: 'Use Strong isolation. Output JSON.' }] };
  const original = JSON.stringify(planStrong); authority.admit('strong-unit', continuityHash(original), original);
  await assert.rejects(service.runGraph('strong-unit', planStrong), /STRONG_REQUIRED/); assert.equal(responses, 2); pass('Explicit Strong in root plan fails closed without invoking any provider');
} finally { await service.dispose(); server.closeAllConnections(); await new Promise<void>(r => server.close(() => r())); db.close(); }
console.log('ADV_ROUTING_SERVICE_PASS ' + checks + '; transport synthetic, no provider inference');
