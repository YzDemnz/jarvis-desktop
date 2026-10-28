/**
 * Real filesystem and the existing broker/dev/mutation chain. The delayed proposer
 * is a synchronization fixture, not an AI quality test. A human's concurrent edit
 * leaves oldText intact; a later read must not authorize the model's stale patch.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import { createRequire } from 'node:module';
import { ToolBroker } from '../../src/agent/ToolBroker';
import { ToolRegistry, TOOL_DEFINITIONS } from '../../src/agent/registry';
import { AuditService } from '../../src/agent/AuditService';
import { CancellationToken } from '../../src/agent/cancellation';
import { DevService } from '../../src/dev/DevService';
import { selectProposalContext, type SelectedProposalFile } from '../../src/dev/ProposalContext';
import {bindProposalToContext} from '../../electron/dev/ProposalContextSource';
import type { ReadResult } from '../../src/dev/FileMutationService';
import type { PatchOp, ToolId } from '../../src/types';
import type { ProcessPort } from '../../src/dev/ports';
import { NodeFsPort, DirectoryTrashPort, DiskSnapshotPort } from '../../electron/dev/nodePorts';

let passed = 0; const pass = (name: string) => { passed++; console.log('PASS ' + name); };
const tempParent = path.resolve(os.tmpdir());
if (process.platform === 'win32' && !tempParent.toLowerCase().startsWith('e:\\codex\\')) throw Error('EXTERNAL_TEST_TEMP_REQUIRED');
const fixture = fs.mkdtempSync(path.join(tempParent, 'jarvis-owned-context-conflict-'));
const roots = path.join(fixture, 'Projects'), projectPath = path.join(roots, 'concurrent-edit'), sourcePath = path.join(projectPath, 'src', 'math.js');
fs.mkdirSync(path.dirname(sourcePath), { recursive: true });
const original = 'exports.sum = (a, b) => a - b;\r\nexports.keep = () => "owner";\r\n';
fs.writeFileSync(sourcePath, original);
fs.writeFileSync(path.join(projectPath, 'package.json'), '{"name":"concurrent-edit"}\n');
fs.writeFileSync(path.join(projectPath, 'test.js'), 'const assert = require("node:assert/strict");\nconst {sum,keep} = require("./src/math");\nassert.equal(sum(2,3),5);\nassert.equal(keep(),"owner");\n');
const unchangedInputs = fs.readFileSync(path.join(projectPath, 'test.js'), 'utf8');
let processStarts = 0;
const processes: ProcessPort = {
  platform: process.platform === 'win32' ? 'win32' : 'posix', which: async () => null, baseEnv: () => ({}),
  spawn: () => { processStarts++; throw Error('NO_PROCESS_EXPECTED_IN_CONFLICT_TEST'); },
};
const snapshots = new DiskSnapshotPort(path.join(fixture, 'snapshots'));
const dev = new DevService({ fs: new NodeFsPort(), snapshots, trash: new DirectoryTrashPort(path.join(fixture, 'trash')), processes });
const audit = new AuditService(), broker = new ToolBroker({ registry: new ToolRegistry(TOOL_DEFINITIONS), audit });
broker.registerAll(dev.adapters()); broker.addPolicy(dev.policy());
const runId = 'context-conflict-fixture', token = new CancellationToken();
broker.openRun(runId, 'FULL', token);
let projectId = '';
const execute = (toolId: ToolId, args: Record<string, unknown>) => broker.execute({ runId, toolId, args: { project: projectId, ...args } });
const read = async () => {
  const result = await execute('file.read', { path: 'src/math.js' });
  assert.equal(result.ok, true, result.error);
  return result.data as ReadResult;
};
const contextFrom = (seen: ReadResult) => selectProposalContext([{ path: 'src/math.js', content: seen.content!, fullFileHash: seen.hash, focusLines: [1] }]).files[0]!;
const ops: PatchOp[] = [{ kind: 'edit', edit: { oldText: 'a - b', newText: 'a + b' } }];
const resultMetadata: Record<string, unknown> = { fixture, filesystem: 'REAL', proposal: 'DELAYED_SYNCHRONIZATION_FIXTURE', inference: 'NONE', paidApiCalls: 0 };
try {
  await dev.init(); await dev.projects.addRoot(roots); await dev.projects.discover();
  projectId = dev.projects.list()[0]!.id;
  await dev.focus(projectId);
  const initialRead = await read(), seenByModel = contextFrom(initialRead);
  assert.equal(seenByModel.fullFileHash, initialRead.hash);
  assert.equal(seenByModel.content, original);
  let signalEntered!: () => void, releaseProposal!: () => void;
  const entered = new Promise<void>(resolve => { signalEntered = resolve; });
  const proposalGate = new Promise<void>(resolve => { releaseProposal = resolve; });
  const delayedProposer = async (context: SelectedProposalFile) => {
    signalEntered(); await proposalGate;
    return { path: context.path, ops, expectedHash: context.fullFileHash };
  };
  const pending = delayedProposer(seenByModel);
  await entered;
  const humanEdit = original + '// human note authored while the proposer was waiting\r\n';
  // An independent actor edits our owned fixture. JARVIS did not write this change.
  fs.writeFileSync(sourcePath, humanEdit);
  releaseProposal(); const proposal = await pending;
  assert.ok(humanEdit.includes(proposal.ops[0]!.kind === 'edit' ? proposal.ops[0]!.edit.oldText : 'a - b'));
  const laterRead = await read();
  assert.notEqual(laterRead.hash, proposal.expectedHash);
  assert.equal(laterRead.content, humanEdit);
  const blocked = await execute('file.patch', proposal);
  assert.equal(blocked.ok, false); assert.equal(blocked.reason, 'adapter_error');
  assert.match(blocked.error!, /cambió desde que JARVIS lo leyó/);
  assert.equal(fs.readFileSync(sourcePath, 'utf8'), humanEdit);
  assert.equal(dev.files.changes.get(runId)?.changes.length, 0);
  assert.deepEqual(await snapshots.list(), []);
  assert.ok(audit.list(runId).some(entry => entry.tool === 'file.patch' && entry.result === 'error'));
  resultMetadata.blocked = { callId: blocked.callId, reason: blocked.reason, contextHash: proposal.expectedHash, concurrentHash: laterRead.hash };
  pass('Concurrent human edit during proposal survives: a later read cannot relax the explicit model-context hash');

  const refreshed = contextFrom(await read());
  const accepted = await execute('file.patch', { path: refreshed.path, ops, expectedHash: refreshed.fullFileHash });
  assert.equal(accepted.ok, true, accepted.error);
  const after = fs.readFileSync(sourcePath, 'utf8');
  assert.ok(after.includes('a + b')); assert.ok(after.endsWith('// human note authored while the proposer was waiting\r\n'));
  assert.equal(fs.readFileSync(path.join(projectPath, 'test.js'), 'utf8'), unchangedInputs);
  assert.equal(dev.files.changes.get(runId)?.changes.length, 1);
  const require = createRequire(import.meta.url), module = require(sourcePath) as { sum: (a: number, b: number) => number; keep: () => string };
  assert.equal(module.sum(2, 3), 5); assert.equal(module.sum(-5, 2), -3); assert.equal(module.keep(), 'owner');
  const snapshotIds = await snapshots.list(); assert.equal(snapshotIds.length, 1);
  assert.equal(new TextDecoder().decode((await snapshots.get(snapshotIds[0]!))!), humanEdit);
  pass('Rebuilt context admits a fresh patch, retains the human edit and frozen check input, and snapshots the current full file');

  const reused = await execute('file.patch', { path: refreshed.path, ops, expectedHash: refreshed.fullFileHash });
  assert.equal(reused.ok, false); assert.equal(fs.readFileSync(sourcePath, 'utf8'), after);
  assert.equal(dev.files.changes.get(runId)?.changes.length, 1);
  pass('Reusing a consumed context hash is refused after the first write rather than repeating or overwriting');

  const reverted = await execute('changes.revert', {});
  assert.equal(reverted.ok, true, reverted.error);
  assert.equal(fs.readFileSync(sourcePath, 'utf8'), humanEdit);
  assert.equal(processStarts, 0);
  pass('Undo restores the pre-JARVIS snapshot containing the concurrent human edit, with no process or model invocation');
  const bomPath = path.join(projectPath, 'src', 'bom.js');
  const bomOriginal = Buffer.from('\uFEFFexports.value = 1;\r\nexports.keep = "owner";\r\n');
  fs.writeFileSync(bomPath, bomOriginal);
  const bomHash = createHash('sha256').update(bomOriginal).digest('hex');
  const bomPatch = await execute('file.patch', {path: 'src/bom.js', expectedHash: bomHash,
    ops: [{kind: 'edit', edit: {oldText: '\uFEFFexports.value = 1;', newText: '\uFEFFexports.value = 2;'}}]});
  assert.equal(bomPatch.ok, true, bomPatch.error);
  assert.deepEqual(fs.readFileSync(bomPath), Buffer.from('\uFEFFexports.value = 2;\r\nexports.keep = "owner";\r\n'));
  pass('Real mutator retains BOM and CRLF when applying an exact first-line context anchor');

  const invalidPath = path.join(projectPath, 'src', 'invalid-utf8.js'), invalidBytes = Buffer.from([0x61, 0xc3, 0x28]);
  fs.writeFileSync(invalidPath, invalidBytes);
  const snapshotsBefore = await snapshots.list();
  const rejected = await execute('file.patch', {path: 'src/invalid-utf8.js', expectedHash: createHash('sha256').update(invalidBytes).digest('hex'),
    ops: [{kind: 'edit', edit: {oldText: 'a', newText: 'b'}}]});
  assert.equal(rejected.ok, false); assert.match(rejected.error ?? '', /PATCH_INVALID_UTF8/);
  assert.deepEqual(fs.readFileSync(invalidPath), invalidBytes); assert.deepEqual(await snapshots.list(), snapshotsBefore);
  pass('Invalid UTF-8 patch is refused before a snapshot or write and preserves original bytes');
  const repeatedPath=path.join(projectPath,'src/repeated.js'), repeated='exports.a = "same";\r\nexports.b = "same";\r\n';
  fs.writeFileSync(repeatedPath,repeated);
  const shown=selectProposalContext([{path:'src/repeated.js',content:repeated,fullFileHash:createHash('sha256').update(repeated).digest('hex')}]).files;
  const bound=bindProposalToContext([{path:'src/repeated.js',ops:[{kind:'edit',edit:{oldText:'"same"',newText:'"new"',nearLine:2}}]}],shown)[0]!;
  const disambiguated=await execute('file.patch',{path:bound.path,ops:bound.ops,expectedHash:bound.expectedHash});
  assert.equal(disambiguated.ok,true,disambiguated.error);
  assert.equal(fs.readFileSync(repeatedPath,'utf8'),'exports.a = "same";\r\nexports.b = "new";\r\n');
  assert.throws(()=>bindProposalToContext([{...bound,ops:[{kind:'edit',edit:{oldText:'"same"',newText:'"x"',nearLine:20}}]}],shown),/PROPOSAL_LINE_HINT_OUTSIDE_COMPLETE_CONTEXT/);
  assert.throws(()=>bindProposalToContext([{...bound,ops:[{kind:'edit',edit:{oldText:'"same"',newText:'"x"',nearLine:2}}]}],shown.map(file=>({...file,complete:false}))),/PROPOSAL_LINE_HINT_OUTSIDE_COMPLETE_CONTEXT/);
  pass('Real repeated-anchor patch selects the requested shown line; main refuses out-of-range and partial-window line hints');
  resultMetadata.passed = passed; resultMetadata.status = 'PASS'; resultMetadata.processStarts = processStarts;
  fs.writeFileSync(path.join(fixture, 'result.json'), JSON.stringify(resultMetadata, null, 2));
  console.log('PROPOSAL_CONTEXT_CONFLICT_RESULT ' + JSON.stringify(resultMetadata));
} catch (error) {
  fs.writeFileSync(path.join(fixture, 'failure.json'), JSON.stringify({ ...resultMetadata, passed, status: 'FAIL', error: error instanceof Error ? error.stack : String(error) }, null, 2));
  throw error;
} finally { dev.projects.closeAll(); broker.closeRun(runId); }
