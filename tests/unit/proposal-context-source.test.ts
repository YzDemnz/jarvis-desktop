import assert from 'node:assert/strict';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {readProposalContext, proposalContextMetadata, bindProposalToContext} from '../../electron/dev/ProposalContextSource';
import {registerCredentialValue} from '../../src/machine/CredentialBoundary';
import {PathGuard} from '../../src/dev/PathGuard';
import {NodeFsPort} from '../../electron/dev/nodePorts';
import {createCodingDelegate, parseFailures, type ProposalInput} from '../../src/dev/coding';
import {CancellationToken} from '../../src/agent/cancellation';
import type {IndexedFile, ToolId, ToolResult} from '../../src/types';

let passed = 0; const pass = (name: string) => { passed++; console.log('PASS ' + name); };
const temp = path.resolve(os.tmpdir());
if (process.platform === 'win32' && !temp.toLowerCase().startsWith('e:\\codex\\')) throw Error('EXTERNAL_TEST_TEMP_REQUIRED');
const fixture = fs.mkdtempSync(path.join(temp, 'jarvis-owned-context-source-')), root = path.join(fixture, 'public');
fs.mkdirSync(root);
const port = new NodeFsPort(), guard = new PathGuard(port); await guard.addRoot(root);
const entries: IndexedFile[] = [];
const write = (relativePath: string, content: string | Uint8Array, flags: Partial<IndexedFile> = {}) => {
  const target = path.join(root, relativePath); fs.mkdirSync(path.dirname(target), {recursive: true}); fs.writeFileSync(target, content);
  const stat = fs.statSync(target);
  const entry: IndexedFile = {relativePath, size: stat.size, mtimeMs: stat.mtimeMs, extension: path.extname(relativePath), language: 'typescript', secret: false, binary: false, ...flags};
  entries.push(entry); return entry;
};
const input = (paths: string[], errors: ProposalInput['context']['errors'] = []): ProposalInput => ({goal: 'Fix the owned public source', attempt: 1, failures: [],
  context: {project: {name: 'public', type: 'node', technologies: ['node'], scripts: {}},
    files: paths.map(relative => ({path: relative, reason: 'renderer retrieval hint', content: 'RENDERER_FORGERY_SENTINEL', truncated: false})),
    matches: [], errors, excluded: [], bytes: 0, approxTokens: 0}});
const diskRead = async (relative: string) => {
  const permitted = await guard.check(relative, {write: false, base: root});
  if (permitted.secret) throw Error('PUBLIC_CONTEXT_PATH_DENIED');
  return new Uint8Array(await fsp.readFile(permitted.path));
};
const originalBytes = Buffer.from('\uFEFFexport const mainBody = "PUBLIC_BODY_ONLY_SENTINEL";\r\nexport const add = (a, b) => a - b;\r\n');
write('src/main.ts', originalBytes);
const hash = createHash('sha256').update(originalBytes).digest('hex');
const initial = await readProposalContext(input(['src/main.ts']), {entries, read: diskRead, assert: () => {}});
assert.equal(initial.selected.files[0]!.content, originalBytes.toString('utf8'));
assert.equal(initial.selected.files[0]!.fullFileHash, hash); assert.equal(initial.selected.files[0]!.content.charCodeAt(0), 0xfeff);
assert.ok(initial.selected.files[0]!.content.includes('\r\n')); assert.ok(!initial.selected.text.includes('RENDERER_FORGERY_SENTINEL'));
assert.equal(initial.totalReadBytes, originalBytes.length);
pass('Main rereads real guarded bytes and ignores forged renderer content while preserving BOM, CRLF and the full byte SHA-256');

const opaque = 'synthetic-context-source-opaque-only-for-test'; registerCredentialValue(opaque);
write('src/opaque.ts', `export const value = "${opaque}";`);
write('src/invalid.ts', Buffer.from([0x65, 0x78, 0x70, 0xC3, 0x28]));
write('src/with-null.ts', Buffer.from('public\0binary'));
write('.env', 'ONLY_SYNTHETIC=value', {secret: true});
write('image.png', Buffer.from([0, 1, 2]), {binary: true});
fs.writeFileSync(path.join(fixture, 'outside.ts'), 'OWNED_OUTSIDE_FENCE_SENTINEL');
entries.push({relativePath: '../outside.ts', size: 35, mtimeMs: 0, extension: '.ts', language: 'typescript', secret: false, binary: false});
const reads: string[] = [];
const guarded = await readProposalContext(input(['src/main.ts', 'src/opaque.ts', 'src/invalid.ts', 'src/with-null.ts', '.env', 'image.png', '../outside.ts']), {
  entries, assert: () => {}, read: async relative => { const bytes = await diskRead(relative); reads.push(relative); return bytes; },
});
assert.deepEqual(guarded.selected.files.map(file => file.path), ['src/main.ts']);
assert.ok(guarded.omitted.some(file => file.path === 'src/invalid.ts' && file.reason === 'INVALID_UTF8'));
assert.ok(guarded.omitted.some(file => file.path === 'src/opaque.ts' && file.reason === 'REDACTED_OR_BINARY'));
assert.ok(guarded.omitted.some(file => file.path === 'src/with-null.ts' && file.reason === 'REDACTED_OR_BINARY'));
assert.ok(guarded.omitted.some(file => file.path === '../outside.ts' && file.reason === 'PUBLIC_READ_DENIED'));
assert.ok(!reads.includes('.env') && !reads.includes('image.png') && !reads.includes('../outside.ts'));
assert.ok(!JSON.stringify(guarded).includes(opaque)); assert.ok(!JSON.stringify(guarded).includes('OWNED_OUTSIDE_FENCE_SENTINEL'));
pass('Invalid UTF-8, redactable and NUL input are explicit omissions; indexed secrets/binaries and escaped paths never enter model context');

const metadata = proposalContextMetadata(guarded), encoded = JSON.stringify(metadata);
assert.ok(!encoded.includes('PUBLIC_BODY_ONLY_SENTINEL') && !encoded.includes('RENDERER_FORGERY_SENTINEL') && !encoded.includes(opaque));
assert.ok(!('text' in metadata) && !('files' in metadata) && !('repositoryMap' in metadata));
assert.equal(metadata.selectedFiles[0]!.fullFileHash, hash); assert.equal(metadata.selectedFiles[0]!.chars, originalBytes.toString('utf8').length);
const budgetBefore = metadata.contextBudget.maxChars; guarded.selected.budget.maxChars = 1;
assert.equal(metadata.contextBudget.maxChars, budgetBefore);
pass('The actual main journal projection contains only cloned scope/budget/hash metadata, excluding raw source, prompt and renderer content');

let stopped = false, stopReads = 0, proposals = 0;
await assert.rejects(async () => {
  await readProposalContext(input(['src/main.ts']), {entries: entries.slice(0, 1), assert: () => { if (stopped) throw Error('AUTHORITY_RUN_STOPPED'); },
    read: async relative => { stopReads++; const data = await diskRead(relative); stopped = true; return data; }});
  proposals++;
}, /AUTHORITY_RUN_STOPPED/);
assert.equal(stopReads, 1); assert.equal(proposals, 0);
pass('Authority cancellation arriving during awaited disk read rejects before selecting or proposing any patch');

const capEntries: IndexedFile[] = [write('cap/a000.ts', 'export const ok = 1;\n')];
for (let index = 1; index <= 50; index++) capEntries.push(write(`cap/a${String(index).padStart(3, '0')}.ts`, Buffer.from([0xc3, 0x28])));
let attempts = 0;
const cap = await readProposalContext(input(['cap/a000.ts']), {entries: capEntries, assert: () => {}, read: async relative => { attempts++; return diskRead(relative); }});
assert.equal(attempts, 48); assert.equal(cap.omitted.filter(file => file.reason === 'RAW_FILE_LIMIT').length, 3);
assert.equal(cap.omitted.filter(file => file.reason === 'INVALID_UTF8').length, 47);
pass('The raw read-attempt limit counts rejected files too, preventing unbounded I/O through malformed candidates');

const byteEntries: IndexedFile[] = [write('byte/a000.ts', 'export const ok = 1;\n')];
for (let index = 1; index <= 6; index++) byteEntries.push(write(`byte/a${index}.ts`, '// public buffer' + ' '.repeat(128 * 1024 - 16)));
let byteReads = 0;
const byteCap = await readProposalContext(input(['byte/a000.ts']), {entries: byteEntries, assert: () => {}, read: async relative => { byteReads++; return diskRead(relative); }});
assert.equal(byteReads, 5); assert.ok(byteCap.totalReadBytes <= 512 * 1024 + 128 * 1024);
assert.ok(byteCap.omitted.some(file => file.path === 'byte/a5.ts' && file.reason === 'RAW_BYTE_LIMIT'));
assert.ok(byteCap.omitted.some(file => file.path === 'byte/a6.ts' && file.reason === 'RAW_BYTE_LIMIT'));
pass('Aggregate byte exhaustion stops subsequent reads and reports omitted files instead of reading the remaining repository');

let patchHash: unknown, fixtureChecks = 0;
const sourceFile = initial.selected.files[0]!;
const delegate = createCodingDelegate({maxRepairIterations: 1, proposer: () => ({available: true, propose: async () => ({rationale: 'fixture proposal only',
  edits: [{path: sourceFile.path, expectedHash: sourceFile.fullFileHash, ops: [{kind: 'edit' as const, edit: {oldText: 'a - b', newText: 'a + b'}}]}]})})});
const callTool = async (toolId: ToolId, args: unknown): Promise<ToolResult> => {
  const request = args as Record<string, unknown>;
  const data: unknown = toolId === 'project.open' ? {id: 'fixture-project'} : toolId === 'project.checks' ? [{id: 'test', label: 'fixture criterion', request: {executable: 'node', args: ['test.js']}}]
    : toolId === 'code.context' ? input([sourceFile.path]).context : toolId === 'file.read' ? {hash: 'a'.repeat(64), content: 'concurrent fresh read'}
    : toolId === 'terminal.execute' ? (fixtureChecks++, {exitCode: 1, stdout: 'not ok fixture criterion', stderr: '', timedOut: false}) : {};
  if (toolId === 'file.patch') patchHash = request.expectedHash;
  return {callId: 'fixture-call', toolId, ok: toolId !== 'file.patch', data, durationMs: 0,
    ...(toolId === 'file.patch' ? {error: 'fixture conflict', reason: 'adapter_error' as const} : {})};
};
const outcome = await delegate({runId: 'delegate-hash-fixture', prompt: 'Fix failing fixture', args: {}, token: new CancellationToken(), callTool, note: () => {}});
assert.equal(patchHash, sourceFile.fullFileHash); assert.notEqual(patchHash, 'a'.repeat(64));
assert.equal(outcome.ok, false); assert.equal(fixtureChecks, 2);
pass('The production coding delegate forwards the model-context expectedHash despite a later read returning a different hash (tool execution fixture)');

const grouped = bindProposalToContext([
  {path: sourceFile.path, expectedHash: 'model-forged-hash', ops: [{kind: 'edit', edit: {oldText: 'a - b', newText: 'a + b'}}]},
  {path: sourceFile.path, ops: [{kind: 'edit', edit: {oldText: 'PUBLIC_BODY_ONLY_SENTINEL', newText: 'public'}}]},
], initial.selected.files);
assert.equal(grouped.length, 1); assert.equal(grouped[0]!.ops.length, 2); assert.equal(grouped[0]!.expectedHash, sourceFile.fullFileHash);
assert.throws(() => bindProposalToContext([{path: 'unshown.ts', ops: [{kind: 'edit', edit: {oldText: 'x', newText: 'y'}}]}], initial.selected.files), /PROPOSAL_OUTSIDE_PRESENTED_CONTEXT/);
assert.throws(() => bindProposalToContext([{path: sourceFile.path, ops: [{kind: 'edit', edit: {oldText: 'not in the shown window', newText: 'y'}}]}], initial.selected.files), /PROPOSAL_OUTSIDE_PRESENTED_CONTEXT/);
pass('Main replaces forged hashes, groups repeated file edits atomically and refuses unshown paths or anchors');

const focusedEntries: IndexedFile[] = [];
const templateRoot = path.resolve('tests/benchmarks/coding/dependency-contract/project');
for (const relative of ['src/cart.cjs','src/ids.cjs','src/catalog.cjs','tests/contract.test.cjs','package.json']) {
  focusedEntries.push(write('focused/'+relative, fs.readFileSync(path.join(templateRoot,relative))));
}
focusedEntries.push(write('focused/tests/criteria.json',JSON.stringify({version:1,kind:'UNIT_CHECK_METADATA_ONLY'})));
const focusedInput = input(focusedEntries.map(file=>file.relativePath),[{file:path.join(root,'focused/tests/contract.test.cjs'),line:31,message:'unit focus'}]);
Object.assign(focusedInput.context,{repositoryMap:{text:'REDUNDANT_MAP_SENTINEL '.repeat(50)}});
const focused = await readProposalContext(focusedInput,{entries:focusedEntries,read:diskRead,assert:()=>{}});
for (const relative of ['src/cart.cjs','src/ids.cjs','src/catalog.cjs']) {
  const selected=focused.selected.files.find(file=>file.path==='focused/'+relative);
  assert.ok(selected?.complete); assert.equal(selected.content,fs.readFileSync(path.join(templateRoot,relative),'utf8'));
}
const reference=focused.selected.files.find(file=>file.path==='focused/tests/contract.test.cjs');
assert.ok(reference && !reference.complete && reference.content.length<=700);
assert.ok(reference.startLine<=31 && reference.endLine>=31);
assert.equal(focused.selected.files.length,4);assert.ok(focused.selected.text.length<4200);
assert.ok(!focused.selected.text.includes('REDUNDANT_MAP_SENTINEL'));
assert.equal(focused.omitted.filter(file=>file.reason==='CHECK_METADATA_NOT_IN_PROMPT').length,2);
pass('Focused CPU context retains all three complete sources including the 1694-character cart, bounds a real test window and omits redundant check/map metadata');

const failingEnv={...process.env};delete failingEnv.NODE_TEST_CONTEXT;delete failingEnv.ELECTRON_RUN_AS_NODE;
const tap=spawnSync('node',['--test','tests/contract.test.cjs'],{cwd:templateRoot,env:failingEnv,encoding:'utf8',windowsHide:true});
assert.notEqual(tap.status,0);const parsed=parseFailures('test',tap.status,tap.stdout+'\n'+tap.stderr);
assert.ok(parsed.errors.some(error=>error.file?.endsWith('contract.test.cjs') && error.line!>0));
pass('Actual failing Node TAP stack retains its test file/line for focused reference retrieval, without changing frozen criteria');

const evidence = {status: 'PASS', passed, fixture, reads: 'REAL_GUARDED_FILESYSTEM', authority: 'CANCELLATION_ASSERTION_CONTRACT', inference: 'NONE',
  delegateExecution: 'TOOL_RESULT_FIXTURE', rawAttempts: attempts, byteReads, totalReadBytes: byteCap.totalReadBytes, metadata};
fs.writeFileSync(path.join(fixture, 'result.json'), JSON.stringify(evidence, null, 2));
console.log('PROPOSAL_CONTEXT_SOURCE_RESULT ' + JSON.stringify(evidence));
