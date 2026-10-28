import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DevService } from '../../src/dev/DevService';
import { MemoryFsPort, MemorySnapshotPort, MemoryTrashPort } from '../../src/dev/memoryPorts';
import { ScriptedProcessPort } from '../../src/dev/scriptedProcess';
import { CancellationToken } from '../../src/agent/cancellation';
import type { ToolContext } from '../../src/agent/adapters/types';
import type { SearchHit } from '../../src/types';
import { ProjectSymbols } from '../../electron/dev/ProjectSymbols';
import { NodeFsPort } from '../../electron/dev/nodePorts';
import { registerCredentialValue } from '../../src/machine/CredentialBoundary';

let count = 0; const pass = (name: string) => { count++; console.log('PASS ' + name); };
const projectRoot = 'D:\\OwnedFixture\\invoice';
const functionCode = 'export function invoiceTotal(items: number[]) { return items.length; }\nconst marker = "invoiceTotal"; // invoiceTotal\nfunction shadow() { const invoiceTotal = 7; return invoiceTotal; }\nexport const result = invoiceTotal([]);';
const mem = new MemoryFsPort('win32', {
  [projectRoot + '\\package.json']: '{"name":"invoice-fixture"}',
  [projectRoot + '\\invoice.ts']: functionCode,
  [projectRoot + '\\simple.py']: 'def onlyPython():\n  return 7',
  [projectRoot + '\\.env']: 'fixture never read as code',
});
const dev = new DevService({ fs: mem, snapshots: new MemorySnapshotPort(), trash: new MemoryTrashPort(mem, 'D:\\OwnedFixture\\trash'), processes: new ScriptedProcessPort('win32') });
await dev.init(); await dev.projects.addRoot('D:\\OwnedFixture'); await dev.projects.discover();
const project = dev.projects.list()[0]!, open = await dev.focus(project.id), symbols = new ProjectSymbols(dev, mem), adapters = symbols.adapters(dev.adapters());
const token = new CancellationToken(), context: ToolContext = { runId: 'owned-integration', token, signal: token.signal };
const call = (id: 'code.findDefinition' | 'code.findReferences' | 'code.context', args: Record<string, unknown>, ctx = context) => adapters[id]!(args as never, ctx) as Promise<unknown>;

const refs = await call('code.findReferences', { project: project.id, symbol: 'invoiceTotal' }) as (SearchHit & { source: string; snapshotHash: string })[];
assert.equal(refs.length, 2); assert.ok(refs.every(hit => hit.source === 'TYPESCRIPT_SYMBOL'));
const defs = await call('code.findDefinition', { project: project.id, symbol: 'invoiceTotal' }) as (SearchHit & { source: string })[];
assert.equal(defs.length, 1); assert.equal(defs[0]!.line, 1);
const positionRefs = await call('code.findReferences', { project: project.id, symbol: 'invoiceTotal', file: 'invoice.ts', line: 3, column: 27 }) as SearchHit[];
assert.equal(positionRefs.length, 2); assert.ok(positionRefs.every(hit => hit.line === 3));
pass('Existing DevService endpoints execute main semantic adapters and distinguish shadowed/local position-specific references');

const lexical = await call('code.findDefinition', { project: project.id, symbol: 'onlyPython' }) as (SearchHit & { source: string })[];
assert.equal(lexical.length, 1); assert.equal(lexical[0]!.source, 'LEXICAL');
await assert.rejects(() => call('code.findDefinition', { project: project.id, symbol: 'invoiceTotal', file: '../outside.ts' }), /FILE_NOT_INDEXED/);
await assert.rejects(() => call('code.findReferences', { project: project.id, symbol: 'invoiceTotal', file: '.env', line: 1, column: 1 }), /NOT_SELECTED/);
const code = await call('code.context', { project: project.id, query: 'invoiceTotal' }) as { bytes: number; files: { content: string }[]; repositoryMap: { source: string; text: string; chars: number; selectedFiles: number } };
assert.equal(code.repositoryMap.source, 'TYPESCRIPT_SYMBOL'); assert.ok(code.repositoryMap.text.includes('invoiceTotal')); assert.ok(code.repositoryMap.chars <= 2400); assert.ok(code.bytes <= 48 * 1024); assert.equal(code.repositoryMap.selectedFiles, 1);
const mixed = await call('code.context', { project: project.id, query: 'fix onlyPython', failures: [{ errors: [{ file: 'simple.py', line: 2, message: 'owned synthetic error' }] }] }) as { files: { path: string }[] };
assert.equal(mixed.files[0]!.path, 'simple.py');
pass('Lexical fallback is labelled; existing code.context includes measured repository map without introducing an unsafe path channel');

const previousHash = refs[0]!.snapshotHash, revision = open.indexer.revision;
await mem.userEdit(projectRoot + '\\invoice.ts', functionCode.replace('invoiceTotal', 'renamedTotal'));
// Re-read hash invalidates even before the watcher updates metadata/revision.
const fresh = await call('code.findDefinition', { project: project.id, symbol: 'renamedTotal' }) as (SearchHit & { snapshotHash: string })[];
assert.equal(fresh.length, 1); assert.notEqual(fresh[0]!.snapshotHash, previousHash);
await open.indexer.update('invoice.ts'); assert.ok(open.indexer.revision > revision);
mem.seed(projectRoot + '\\new.ts', 'export const addedSymbol = 1'); await open.indexer.update('new.ts');
const added = await call('code.findDefinition', { project: project.id, symbol: 'addedSymbol' }) as SearchHit[]; assert.equal(added.length, 1);
mem.vanish(projectRoot + '\\new.ts'); await open.indexer.update('new.ts');
assert.equal((await call('code.findDefinition', { project: project.id, symbol: 'addedSymbol' }) as SearchHit[]).length, 0);
pass('Content rehash invalidates unobserved edits; index revision invalidates added/deleted/self-written file snapshots');

const secret = 'synthetic-symbol-context-credential'; registerCredentialValue(secret);
await mem.userEdit(projectRoot + '\\invoice.ts', 'export const publicInvoice = "' + secret + '";'); await open.indexer.update('invoice.ts');
const safe = await call('code.context', { project: project.id, query: 'publicInvoice' }); assert.ok(!JSON.stringify(safe).includes(secret));
const cancelled = new CancellationToken(); cancelled.cancel('owned fixture stop');
await assert.rejects(() => call('code.findReferences', { project: project.id, symbol: 'publicInvoice' }, { runId: context.runId, token: cancelled, signal: cancelled.signal }), /owned fixture stop/);
pass('Main repository context masks known credentials and refuses cancelled semantic operations');

for (let index = 0; index < 100; index++) mem.seed(projectRoot + '\\extra-' + index + '.ts', 'export const filler' + index + ' = ' + index + ';');
await open.indexer.refresh();
let reads = 0; const originalRead = mem.readFile.bind(mem); mem.readFile = async file => { reads++; return originalRead(file); };
const large = await call('code.context', { project: project.id, query: 'publicInvoice', failures: [{ errors: [{ file: 'invoice.ts', line: 1, message: 'owned focus' }] }] }) as { files: { path: string }[]; repositoryMap: { selectedFiles: number; candidateFiles: number; truncated: boolean }; bytes: number };
assert.equal(large.files[0]!.path, 'invoice.ts'); assert.ok(large.repositoryMap.selectedFiles <= 48); assert.equal(large.repositoryMap.candidateFiles, 101); assert.equal(large.repositoryMap.truncated, true);
assert.ok(reads <= 49); assert.ok(Buffer.byteLength(JSON.stringify(large)) <= 48 * 1024);
console.log('CODE_CONTEXT_METRICS ' + JSON.stringify({ indexedTypeScriptFiles: 101, readFiles: reads, selectedFiles: large.repositoryMap.selectedFiles, contextBytes: Buffer.byteLength(JSON.stringify(large)) }));
mem.readFile = originalRead;
pass('Large indexed repository context reads at most48selected sources pluspackage metadata, prioritizes errors and measures full serialized budget');

const diskRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'jarvis-owned-code-integration-')), diskProject = path.join(diskRoot, 'fixture');
fs.mkdirSync(diskProject); fs.writeFileSync(path.join(diskProject, 'package.json'), '{"name":"owned-real-code-fixture"}');
fs.writeFileSync(path.join(diskProject, 'owner.ts'), 'export function ownedResult() { return 42; }');
const callerCode = 'import { ownedResult as next } from "./owner"; export const output = next();';
fs.writeFileSync(path.join(diskProject, 'caller.ts'), callerCode);
const disk = new NodeFsPort(), diskDev = new DevService({ fs: disk, snapshots: new MemorySnapshotPort(), trash: { native: false, async trash() { throw Error('fixture deletion forbidden'); } }, processes: new ScriptedProcessPort(disk.flavor) });
await diskDev.init(); await diskDev.projects.addRoot(diskRoot); await diskDev.projects.discover();
const diskId = diskDev.projects.list()[0]!.id, diskAdapters = new ProjectSymbols(diskDev, disk).adapters(diskDev.adapters());
const result = await diskAdapters['code.findDefinition']!({ project: diskId, symbol: 'next', file: 'caller.ts', line: 1, column: callerCode.lastIndexOf('next') + 1 } as never, context) as (SearchHit & { source: string })[];
assert.equal(result.length, 1); assert.equal(result[0]!.file, 'owner.ts'); assert.equal(result[0]!.source, 'TYPESCRIPT_SYMBOL');
pass('Real indexed filesystem fixture resolves an imported alias through existing guarded project read adapters');

dev.projects.closeAll(); diskDev.projects.closeAll(); console.log('ADVANCEMENT_CODE_INTEGRATION_PASS ' + count);
