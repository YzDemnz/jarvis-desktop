import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { randomBytes, createCipheriv, createDecipheriv } from 'node:crypto';
import { CredentialStore } from '../../electron/connected/CredentialStore';
import { API_ROUTES, ChatCompletionsProvider } from '../../electron/connected/ChatCompletionsProvider';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'jarvis-adv-provider-unit-'));
const key = randomBytes(32), credential = 'synthetic-provider-' + randomBytes(20).toString('hex');
const encryption = { isEncryptionAvailable: () => true,
  encryptString(value: string) { const iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', key, iv), bytes = Buffer.concat([cipher.update(value), cipher.final()]); return Buffer.concat([iv, cipher.getAuthTag(), bytes]); },
  decryptString(value: Buffer) { const decipher = createDecipheriv('aes-256-gcm', key, value.subarray(0, 12)); decipher.setAuthTag(value.subarray(12, 28)); return Buffer.concat([decipher.update(value.subarray(28)), decipher.final()]).toString(); },
};
// An encryption double must actually encrypt at rest; DPAPI belongs to packaged tests.
const vault = new CredentialStore(path.join(root, 'credentials.json'), encryption);
let count = 0, calls = 0, handler: (request: http.IncomingMessage, response: http.ServerResponse, body: any) => void;
let last: { url?: string; authorization?: string; body: any } | null = null;
const pass = (label: string) => { count++; console.log('PASS ' + label); };
const completion = (text = 'Public result', extra: Record<string, unknown> = {}) => ({ model: 'fixture-model', choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: text } }], usage: { prompt_tokens: 12, completion_tokens: 7 }, ...extra });
const server = http.createServer((request, response) => {
  let data = ''; request.setEncoding('utf8'); request.on('data', chunk => data += chunk);
  request.on('end', () => { calls++; const body = JSON.parse(data || '{}'); last = { url: request.url, authorization: request.headers.authorization, body }; handler(request, response, body); });
});
await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
const endpoint = 'http://127.0.0.1:' + (server.address() as import('node:net').AddressInfo).port;
const request = { taskId: 'owned-fixture-task', prompt: 'Produce a bounded result', context: 'Only needed public task context' };
function fixture(id: 'groq-api' | 'openrouter-api', guard = () => {}) { return new ChatCompletionsProvider(id, vault, 'fixture-model', guard, { fixtureEndpoint: endpoint }); }
const reply = (value: unknown) => { handler = (_req, res) => { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(value)); }; };
try {
  assert.equal(API_ROUTES['groq-api'].destination, 'https://api.groq.com/openai/v1');
  assert.equal(API_ROUTES['openrouter-api'].destination, 'https://openrouter.ai/api/v1');
  for (const raw of ['https://remote.invalid', 'http://127.0.0.1@remote.invalid', 'http://localhost/path', 'http://localhost?token=x'])
    assert.throws(() => new ChatCompletionsProvider('groq-api', vault, 'fixture', () => {}, { fixtureEndpoint: raw }), /LOOPBACK/);
  assert.throws(() => new ChatCompletionsProvider('evil' as 'groq-api', vault, 'fixture', () => {}), /UNKNOWN_API_ROUTE/);
  assert.throws(() => new ChatCompletionsProvider('groq-api', vault, 'groq/compound', () => {}), /INVALID_CONNECTED_MODEL/);
  assert.throws(() => new ChatCompletionsProvider('openrouter-api', vault, 'openrouter/auto', () => {}), /INVALID_CONNECTED_MODEL/);
  pass('Pinned official destinations; only explicit loopback fixture injection; tool-bearing and implicit model routers denied');

  const missing = fixture('groq-api');
  assert.equal(await missing.connectionState(), 'AUTH_REQUIRED');
  assert.equal((await missing.entitlement()).paid, true); assert.equal((await missing.estimate()).amount, null);
  await assert.rejects(missing.execute(request), /^Error: PROVIDER_AUTH_REQUIRED$/); assert.equal(calls, 0);
  vault.put('groq-api', 'https://api.groq.com/openai/v1', credential);
  await assert.rejects(missing.execute(request), /PROVIDER_AUTH_REQUIRED/); assert.equal(calls, 0);
  pass('No request without exact provider/destination SecretRef; credentials and estimates do not invent entitlement');

  vault.put('groq-api', endpoint, credential); reply(completion());
  const groq = fixture('groq-api'); assert.equal(await groq.connectionState(), 'NOT_CONNECTED'); assert.equal((await groq.health()).ok, false);
  const result = await groq.execute(request), observed = last!;
  assert.equal(result.text, 'Public result'); assert.equal(await groq.connectionState(), 'AVAILABLE');
  assert.equal(observed.url, '/chat/completions'); assert.equal(observed.authorization, 'Bearer ' + credential);
  assert.equal(observed.body.max_completion_tokens, 512); assert.equal(observed.body.max_tokens, undefined);
  assert.deepEqual(observed.body.tools, []); assert.equal(observed.body.tool_choice, 'none'); assert.equal(observed.body.stream, false);
  assert.deepEqual(observed.body.messages.map((m: any) => m.role), ['system', 'user']);
  assert.equal(result.usage![0].input, 12); assert.equal(result.usage![0].output, 7);
  assert.equal(result.usage![0].estimatedCost, null); assert.equal(result.usage![0].resetAt, null);
  assert.ok(!JSON.stringify(result).includes(credential)); assert.ok(!fs.readFileSync(path.join(root, 'credentials.json'), 'utf8').includes(credential));
  pass('Groq real loopback transport contract, internal bearer resolution and observed-only usage (not provider inference)');

  vault.put('openrouter-api', endpoint, credential); const router = fixture('openrouter-api');
  await router.execute(request);
  assert.deepEqual(last!.body.provider, { allow_fallbacks: false, require_parameters: true, data_collection: 'deny', zdr: true });
  assert.equal(last!.body.max_tokens, 512); assert.equal(last!.body.max_completion_tokens, undefined);
  assert.equal(last!.body.models, undefined); assert.equal(last!.body.route, undefined);
  pass('OpenRouter contract disables implicit fallback and declares restrictive upstream data routing without claiming attestation');

  reply(completion(credential + ' public', { reasoning: credential, headers: { authorization: credential }, debug: credential }));
  const masked = await groq.execute({ ...request, prompt: credential, context: credential });
  assert.ok(!JSON.stringify(masked).includes(credential)); assert.ok(!JSON.stringify(last!.body).includes(credential));
  assert.deepEqual(Object.keys(masked).sort(), ['model', 'text', 'usage']);
  pass('Prompt/context/assistant redaction and public projection exclude raw metadata, headers and reasoning');

  for (const [status, failure, state] of [[429, 'PROVIDER_RATE_LIMITED', 'RATE_LIMITED'], [401, 'PROVIDER_AUTH_REQUIRED', 'AUTH_REQUIRED'], [403, 'PROVIDER_AUTH_REQUIRED', 'AUTH_REQUIRED'], [503, 'PROVIDER_UNAVAILABLE', 'DEGRADED'], [400, 'PROVIDER_FAILED', 'DEGRADED']] as const) {
    handler = (_req, res) => { res.statusCode = status; res.end(JSON.stringify({ error: { message: credential, raw: 'private fixture response' } })); };
    const provider = fixture('groq-api');
    await assert.rejects(provider.execute(request), new RegExp('^Error: ' + failure + '$'));
    assert.equal(await provider.connectionState(), state);
  }
  pass('Observed HTTP auth, rate-limit and service failures are distinct; raw error bodies never surface');

  const beforeRedirect = calls;
  handler = (_req, res) => { res.writeHead(307, { Location: endpoint + '/stolen' }); res.end(); };
  await assert.rejects(groq.execute(request), /^Error: PROVIDER_FAILED$/);
  assert.equal(calls, beforeRedirect + 1);
  pass('Redirect denied before any credential forwarding or implicit retry');

  for (const invalid of [completion('', {}), { ...completion(), choices: [] }, { ...completion(), choices: [completion().choices[0], completion().choices[0]] },
    { ...completion(), choices: [{ finish_reason: 'length', message: { role: 'assistant', content: 'truncated' } }] },
    { ...completion(), choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: 'tool attempt', tool_calls: [{ id: 'x', function: { name: 'os', arguments: credential } }] } }] },
    { ...completion(), choices: [{ finish_reason: 'stop', message: { role: 'user', content: 'wrong role' } }] }]) {
    reply(invalid); await assert.rejects(groq.execute(request), /^Error: PROVIDER_RESPONSE_NOT_COMPLETED$/);
  }
  pass('Empty, ambiguous, truncated and tool-bearing completions are not successful text results');

  reply(completion('<think>private reasoning fixture</think>Public answer'));
  assert.equal((await groq.execute(request)).text, 'Public answer');
  reply(completion('<think>unfinished private reasoning fixture'));
  await assert.rejects(groq.execute(request), /^Error: PROVIDER_RESPONSE_NOT_COMPLETED$/);
  pass('Known thinking wrappers are excluded; incomplete private-reasoning output is rejected');

  reply(completion('x'.repeat(24001))); await assert.rejects(groq.execute(request), /^Error: PROVIDER_OUTPUT_TOO_LARGE$/);
  reply(completion('x'.repeat(2 * 1024 * 1024))); await assert.rejects(groq.execute(request), /^Error: PROVIDER_OUTPUT_TOO_LARGE$/);
  pass('Public text and actual streamed JSON response limits are enforced, not trusted to upstream token settings');

  let live = false, delivered!: () => void;
  const arrived = new Promise<void>(resolve => delivered = resolve);
  handler = (_req, res) => { live = true; delivered(); setTimeout(() => { if (!res.destroyed) res.end(JSON.stringify(completion())); }, 250); };
  let allowed = true; const guarded = fixture('groq-api', () => { if (!allowed) throw Error('private authority diagnostic'); });
  const pending = guarded.execute(request); await arrived; assert.equal(live, true); allowed = false;
  await assert.rejects(pending, /^Error: CONNECTED_RUN_REVOKED$/);
  pass('Authority/policy revocation in flight suppresses late successful output');

  let cancelArrived!: () => void;
  const cancelArrival = new Promise<void>(resolve => cancelArrived = resolve);
  handler = (_req, _res) => { cancelArrived(); };
  const controller = new AbortController(), cancelled = groq.execute({ ...request, signal: controller.signal });
  await cancelArrival; controller.abort(); await assert.rejects(cancelled, /^Error: CONNECTED_RUN_REVOKED$/);
  const prior = calls, stopped = new AbortController(); stopped.abort();
  await assert.rejects(groq.execute({ ...request, signal: stopped.signal }), /^Error: CONNECTED_RUN_REVOKED$/); assert.equal(calls, prior);
  pass('STOP aborts the actual fixture transport; already stopped admission sends no request');

  reply(completion('Valid public response', { usage: { prompt_tokens: -1, completion_tokens: 'unknown' }, model: credential }));
  const unknown = await groq.execute(request); assert.equal(unknown.model, 'fixture-model'); assert.equal(unknown.usage![0].input, null); assert.equal(unknown.usage![0].output, null);
  pass('Invalid or secret-shaped usage/model metadata cannot become fabricated catalog, accounting or context');
  vault.remove('groq-api'); assert.equal(await groq.connectionState(), 'AUTH_REQUIRED'); assert.equal((await groq.health()).ok, false);
  pass('Credential revocation invalidates observed availability without revealing or copying the retired secret');
  console.log('ADV_PROVIDERS_UNIT_PASS ' + count + '; synthetic transport only; real paid API calls=0');
} finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }
