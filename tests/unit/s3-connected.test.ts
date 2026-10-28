import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomBytes, createCipheriv, createDecipheriv } from 'node:crypto';
import { CredentialStore } from '../../electron/connected/CredentialStore';
import { ConnectedPolicyStore } from '../../electron/connected/ConnectedPolicy';
import { loopbackEndpoint, boundedJson, ResponsesProvider } from '../../electron/connected/HttpProvider';
import { safeContextText } from '../../src/fabric/ContinuityState';
import { activateApplication } from '../../electron/process/OwnedApplication';
import { withProcessScope } from '../../electron/process/WindowsJobProcess';
import http from 'node:http';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'jarvis-s3-unit-')), key = randomBytes(32), opaque = 'opaque-unit-' + randomBytes(20).toString('hex');
const encryption = { isEncryptionAvailable: () => true,
  encryptString(value: string) { const iv = randomBytes(12), c = createCipheriv('aes-256-gcm', key, iv); const b = Buffer.concat([c.update(value), c.final()]); return Buffer.concat([iv, c.getAuthTag(), b]); },
  decryptString(b: Buffer) { const d = createDecipheriv('aes-256-gcm', key, b.subarray(0, 12)); d.setAuthTag(b.subarray(12, 28)); return Buffer.concat([d.update(b.subarray(28)), d.final()]).toString(); } };
let count = 0; const pass = (s: string) => { count++; console.log('PASS ' + s); };
const file = path.join(root, 'vault.json'), vault = new CredentialStore(file, encryption);
const ref = vault.put('openai-api', 'https://api.openai.com/v1', opaque);
assert.ok(!fs.readFileSync(file, 'utf8').includes(opaque)); assert.ok(!JSON.stringify(vault.references()).includes(opaque));
pass('Encrypted persistence and public SecretRef only (encryption DOUBLE; native DPAPI tested separately)');
const reopened = new CredentialStore(file, encryption);
assert.equal(await reopened.use(ref.id, { providerId: 'openai-api', destination: ref.destination, use: 'PROVIDER_AUTH' }, async v => v === opaque), true);
await assert.rejects(reopened.use(ref.id, { providerId: 'other', destination: ref.destination, use: 'PROVIDER_AUTH' }, async () => true), /BINDING_DENIED/);
await assert.rejects(reopened.use(ref.id, { providerId: 'openai-api', destination: 'https://evil.invalid', use: 'PROVIDER_AUTH' }, async () => true), /BINDING_DENIED/);
pass('Restart resolution stays internal; provider/destination binding rejects substitution');
const masked = safeContextText([opaque, encodeURIComponent(opaque), Buffer.from(opaque).toString('base64')].join(' '));
assert.ok(!masked.includes(opaque)); assert.ok(!masked.includes(Buffer.from(opaque).toString('base64'))); pass('Opaque and encoded credential redaction');
const complex = opaque + '+/"quote'; const complexRef = vault.put('other', 'https://example.invalid', complex);
assert.ok(!safeContextText(encodeURIComponent(complex)).includes(encodeURIComponent(complex)));
assert.ok(!safeContextText(JSON.stringify(complex)).includes(JSON.stringify(complex).slice(1, -1)));
vault.remove('other'); await assert.rejects(vault.use(complexRef.id, { providerId: 'other', destination: complexRef.destination, use: 'PROVIDER_AUTH' }, async () => true));
pass('Distinct URL/JSON encodings redacted; revoked reference cannot resolve');
vault.put('openai-api', ref.destination, opaque + '-rotated');
await assert.rejects(vault.use(ref.id, { providerId: 'openai-api', destination: ref.destination, use: 'PROVIDER_AUTH' }, async () => true));
assert.ok(!safeContextText(opaque).includes(opaque)); pass('Rotation revokes old refs without unmasking retired secrets');
assert.throws(() => new CredentialStore(path.join(root, 'no.json'), { ...encryption, isEncryptionAvailable: () => false }), /ENCRYPTION_UNAVAILABLE/); pass('No plaintext fallback');
let changes = 0; const policyFile = path.join(root, 'policy.json'), policy = new ConnectedPolicyStore(policyFile, () => changes++);
assert.equal(policy.snapshot().allowPaidApi, false); assert.deepEqual(policy.snapshot().enabled, ['ollama-local']);
assert.equal(policy.snapshot().allowPaidFallback, false);
policy.userChange({ dataClass: 'LOCAL_ONLY' }); assert.equal(changes, 1); assert.equal(new ConnectedPolicyStore(policyFile, () => {}).snapshot().dataClass, 'LOCAL_ONLY');
fs.writeFileSync(policyFile, '{corrupt'); assert.equal(new ConnectedPolicyStore(policyFile, () => {}).snapshot().allowPaidApi, false); pass('Native policy persistence and corrupt-file safe defaults');
assert.equal(loopbackEndpoint('http://127.0.0.1:1234'), 'http://127.0.0.1:1234');
for (const endpoint of ['https://remote.invalid', 'http://127.0.0.1@remote.invalid', 'http://localhost/path', 'http://localhost?key=x']) assert.throws(() => loopbackEndpoint(endpoint)); pass('Local transport rejects remote/credential/path substitution');
const shortcut = path.join(root, 'external.lnk'); fs.writeFileSync(shortcut, 'fixture'); let activations = 0;
const external = await activateApplication(shortcut, () => ({ target: 'shell:AppsFolder\\fixture' }), async () => { activations++; return ''; });
assert.equal(external.ownership, 'UNOWNABLE'); assert.equal(external.pid, null); assert.equal(external.stopScope, 'NONE');
await assert.rejects(activateApplication(shortcut, () => ({ target: 'shell:AppsFolder\\fixture' }), async () => { activations++; return ''; }, true), /OWNERSHIP_UNAVAILABLE/);
assert.equal(activations, 1); pass('Normal external activation allowed without fake PID; explicit ownership fails closed');
const c = new AbortController(); c.abort();
await assert.rejects(withProcessScope('stopped', c.signal, () => activateApplication(shortcut, () => ({ target: 'shell:fixture' }), async () => { activations++; return ''; })));
assert.equal(activations, 1); pass('STOP blocks shell fallback before activation');
if (process.platform === 'win32') {
  const invalidExe = path.join(root, 'not-a-pe.exe'); fs.writeFileSync(invalidExe, 'fixture, not executable');
  const activated = await activateApplication(invalidExe, () => { throw Error('unused'); }, async () => { activations++; return ''; });
  assert.equal(activated.ownership, 'UNOWNABLE'); assert.equal(activations, 2);
  await assert.rejects(activateApplication(invalidExe, () => { throw Error('unused'); }, async () => { activations++; return ''; }, true), /OWNERSHIP_UNAVAILABLE/);
  assert.equal(activations, 2); pass('Failed owned creation closes Job before normal fallback; strict ownership never falls back');
}
let forwarded = 0;
const server = http.createServer((req, res) => { if (req.url === '/redirect') { res.writeHead(307, { Location: '/target' }); res.end(); } else { forwarded++; res.end('{}'); } });
await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
try { await assert.rejects(boundedJson('http://127.0.0.1:' + (server.address() as any).port + '/redirect', { headers: { Authorization: 'Bearer synthetic' } })); assert.equal(forwarded, 0); pass('Provider redirect cannot forward credential to another destination'); }
finally { await new Promise<void>(r => server.close(() => r())); }
const adapter = new ResponsesProvider(ref.destination, vault, 'fixture', () => {}); assert.equal(await adapter.connectionState(), 'NOT_CONNECTED'); assert.equal((await adapter.health()).ok, false); pass('Stored credential is not fabricated remote health or inference');
console.log('S3_UNIT_PASS ' + count);
