/** Real OpenCode binary/SDK + explicitly fake model. NOT a coding-quality benchmark. */
import assert from 'node:assert/strict';
import http from 'node:http';
import net from 'node:net';
import path from 'node:path';
import fs from 'node:fs';
import { OpenCodeProcessManager } from '../../src/intelligence/opencode/OpenCodeProcessManager';
import { OpenCodeBridge } from '../../src/intelligence/opencode/OpenCodeBridge';
import { OpenCodeProposalAdapter } from '../../src/intelligence/opencode/OpenCodeProposalAdapter';
import { tempLab, repo, harness } from './lab-harness';
const root = tempLab(), cwd = path.join(root, 'project'); fs.mkdirSync(cwd);
fs.writeFileSync(path.join(cwd, 'package.json'), '{"name":"flow","scripts":{"test":"node test.cjs"}}');
fs.writeFileSync(path.join(cwd, 'math.ts'), 'export const sum = (a: number, b: number) => a - b;\n');
fs.writeFileSync(path.join(cwd, 'test.cjs'), "if(!require('fs').readFileSync('math.ts','utf8').includes('a + b'))process.exit(1);");
let invalid = false, slow = false; const advertisedTools: string[][] = []; let modelCalls = 0;
const mock = http.createServer((req, res) => {
  const parts: Buffer[] = []; req.on('data', b => parts.push(b)); req.on('end', () => {
    const body = JSON.parse(Buffer.concat(parts).toString()); modelCalls++;
    advertisedTools.push((body.tools ?? []).map((t: any) => t.function?.name));
    const proposal = JSON.stringify({ diagnosis: 'sum subtracts', edits: [{ path: invalid ? '../../outside.ts' : 'math.ts', oldText: 'a - b', newText: 'a + b' }], commands: ['node test.cjs'], context: ['math.ts'] });
    res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' });
    const send = () => {
      if (res.destroyed) return;
      res.write(`data: ${JSON.stringify({ id: 'mock', object: 'chat.completion.chunk', created: 1, model: 'fake-model', choices: [{ index: 0, delta: { role: 'assistant', content: proposal }, finish_reason: null }] })}\n\n`);
      res.write(`data: ${JSON.stringify({ id: 'mock', object: 'chat.completion.chunk', created: 1, model: 'fake-model', choices: [{ index: 0, delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 50, completion_tokens: 20, total_tokens: 70 } })}\n\n`);
      res.end('data: [DONE]\n\n');
    };
    if (slow) { const timer = setTimeout(send, 5000); res.once('close', () => clearTimeout(timer)); } else send();
  });
});
await new Promise<void>(r => mock.listen(0, '127.0.0.1', r));
const modelPort = (mock.address() as net.AddressInfo).port;
const port = await new Promise<number>(r => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const p = (s.address() as net.AddressInfo).port; s.close(() => r(p)); }); });
const server = new OpenCodeProcessManager(path.join(repo, 'node_modules/opencode-ai/bin/opencode.exe'), cwd, port, '1.18.32', 'fake-model', `http://127.0.0.1:${modelPort}`);
const bridge = new OpenCodeBridge(server); const adapter = new OpenCodeProposalAdapter(bridge, { providerID: 'ollama-lab', modelID: 'fake-model' });
const h = await harness(root); const evidence: Record<string, unknown> = { model: 'EXPLICIT_FAKE_OPENAI_COMPATIBLE_MODEL', engine: 'REAL_OPENCODE_1.18.32', qualityBenchmark: false };
let releaseTask: (() => void) | undefined;
try {
  releaseTask = await bridge.leaseTask(); assert.equal(server.leases.leases, 1); server.child?.stdout?.resume(); await bridge.validateProposalConfiguration();
  await h.broker.execute({ runId: h.runId, toolId: 'project.open', args: { project: 'flow' } });
  const context = (await h.broker.execute({ runId: h.runId, toolId: 'code.context', args: { query: 'sum math.ts' } })).data as any;
  const before = fs.readFileSync(path.join(cwd, 'math.ts'), 'utf8');
  const proposal = await adapter.propose({ goal: 'Fix sum', context, failures: [], attempt: 1 });
  assert.ok(proposal, 'Real engine must deliver fake-model proposal');
  assert.equal(fs.readFileSync(path.join(cwd, 'math.ts'), 'utf8'), before); evidence.proposalOnlyNoWrite = true;
  for (const edit of proposal.edits) {
    const read = await h.broker.execute({ runId: h.runId, toolId: 'file.read', args: { path: edit.path } }); assert.ok(read.ok);
    const patch = await h.broker.execute({ runId: h.runId, toolId: 'file.patch', args: { path: edit.path, ops: edit.ops } }); assert.ok(patch.ok, patch.error);
  }
  assert.ok(h.dev.files.changes.get(h.runId)?.changes.length); evidence.changeSet = true;
  const test = await h.broker.execute<{ exitCode: number }>({ runId: h.runId, toolId: 'terminal.execute', args: { executable: 'node', args: ['test.cjs'] } });
  assert.equal(test.data?.exitCode, 0); evidence.brokerAppliedAndTerminalVerified = true;
  invalid = true; assert.equal(await adapter.propose({ goal: 'invalid traversal', context, failures: [], attempt: 1 }), null); invalid = false; evidence.invalidPatchRejected = true;
  slow = true; const session = (await bridge.createSession()).data!.id;
  const pending = bridge.propose(session, 'wait', { providerID: 'ollama-lab', modelID: 'fake-model' }).catch(() => null);
  await new Promise(r => setTimeout(r, 300)); await bridge.cancel(session); await pending;
  assert.equal((await bridge.health()).data?.healthy, true); evidence.stopHealthy = true; slow = false;
  assert.ok(await adapter.propose({ goal: 'after stop', context, failures: [], attempt: 1 })); evidence.reusableAfterStop = true;
  assert.ok(advertisedTools.every(names => names.length === 0), `Unexpected tools exported: ${JSON.stringify(advertisedTools)}`);
  evidence.noExternalToolsExported = true; evidence.modelCalls = modelCalls; evidence.status = 'PASS_WITH_RESTRICTIONS';
  console.log('PASS real OpenCode + fake model: proposal → broker patch → ChangeSet → TerminalService; STOP healthy');
} catch (e) { evidence.status = 'FAIL'; evidence.error = String(e); throw e; }
finally {
  releaseTask?.(); await server.stop(); await server.leases.dispose(); h.broker.closeRun(h.runId); await h.dev.cancelRun(h.runId); mock.closeAllConnections(); await new Promise<void>(r => mock.close(() => r()));
  fs.writeFileSync(path.join(repo, 'docs/evidence/phase-a/opencode-flow.json'), JSON.stringify(evidence, null, 2));
}
