import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { ModelPatchProposer, createCodingDelegate } from '../../src/dev/coding';
import { LocalAIManager } from '../../src/machine/localai/LocalAIManager';
import { OllamaRuntimeAdapter } from '../../src/machine/localai/runtimes/OllamaRuntimeAdapter';
import { OpenCodeProcessManager } from '../../src/intelligence/opencode/OpenCodeProcessManager';
import { OpenCodeBridge } from '../../src/intelligence/opencode/OpenCodeBridge';
import { OpenCodeProposalAdapter } from '../../src/intelligence/opencode/OpenCodeProposalAdapter';
import { ACPProcessManager } from '../../src/intelligence/transports/acp/ACPProcessManager';
import { tempLab, harness, repo, fakeProfile } from './lab-harness';
const evidenceDir = path.join(repo, 'docs/evidence/phase-a'); fs.mkdirSync(evidenceDir, { recursive: true });
const model = 'qwen2.5:3b-instruct';
let endpoint = 'http://127.0.0.1:11434';
let labRuntime: ACPProcessManager | undefined;
try { await fetch(`${endpoint}/api/version`, { signal: AbortSignal.timeout(1000) }); }
catch {
  const executable = path.join(process.env.LOCALAPPDATA!, 'Programs/Ollama/ollama.exe');
  if (fs.existsSync(executable)) {
    endpoint = 'http://127.0.0.1:11435';
    labRuntime = new ACPProcessManager({ ...fakeProfile(), id: 'ollama-lab', command: executable, args: ['serve'], environment: {
      OLLAMA_HOST: '127.0.0.1:11435', OLLAMA_NO_CLOUD: '1', OLLAMA_NOPRUNE: '1',
      ...(process.env.OLLAMA_MODELS ? { OLLAMA_MODELS: process.env.OLLAMA_MODELS } : {}),
    } }, tempLab());
    await labRuntime.start(); labRuntime.child?.stdout?.resume();
    for (let i = 0; i < 30; i++) { try { await fetch(`${endpoint}/api/version`, { signal: AbortSignal.timeout(1000) }); break; } catch { await new Promise(r => setTimeout(r, 1000)); } }
  }
}
const runtime = new OllamaRuntimeAdapter({
  health: async () => { const r = await fetch(`${endpoint}/api/version`, { signal: AbortSignal.timeout(2000) }); return { online: r.ok, endpoint, version: (await r.json()).version, models: [] }; },
  listModels: async () => { const r = await fetch(`${endpoint}/api/tags`, { signal: AbortSignal.timeout(2000) }); return (await r.json()).models.map((m: any) => ({ name: m.name, size: m.size, family: m.details?.family ?? '', parameterSize: m.details?.parameter_size ?? '' })); },
  generate: async (input, signal) => { const r = await fetch(`${endpoint}/api/generate`, { method: 'POST', signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(60000)]) : AbortSignal.timeout(60000), headers: { 'content-type': 'application/json' }, body: JSON.stringify({ model: input.model, prompt: input.prompt, stream: false, format: 'json', options: { temperature: 0, num_predict: 2048, num_ctx: 8192 } }) }); if (!r.ok) throw new Error(`Local runtime HTTP ${r.status}`); return (await r.json()).response; },
});
const manager = new LocalAIManager([runtime]); const discovery = await manager.discover();
const ready = discovery.runtimes.some(r => r.models.some(m => m.name === model));
const fixtures = [
  { id: 'simple-bug', goal: 'Fix sum: sum(2,3) must equal 5; do not modify tests.', files: { 'math.ts': 'export const sum = (a: number, b: number) => a - b;\n' }, test: "const {sum}=await import('./math.ts');assert.equal(sum(2,3),5);" },
  { id: 'multi-file-bug', goal: 'Fix sum and total so total(2,3) equals 5. Do not modify tests.', files: { 'math.ts': 'export const sum = (a: number, b: number) => a - b;\n', 'total.ts': "import {sum} from './math.ts';export const total=(a:number,b:number)=>sum(a,b)*2;\n" }, test: "const {total}=await import('./total.ts');assert.equal(total(2,3),5);" },
  { id: 'test-failure', goal: 'Fix divide behavior: divide(6,2) equals 3, not 12. Do not modify tests.', files: { 'math.ts': 'export const divide = (a: number, b: number) => a * b;\n' }, test: "const {divide}=await import('./math.ts');assert.equal(divide(6,2),3);" },
  { id: 'refactor', goal: 'Refactor repeated multiplication into exported double(n:number). left and right must call double; preserve behavior. Do not modify tests.', files: { 'math.ts': 'export const left = (n: number) => n * 2;\nexport const right = (n: number) => n * 2;\n' }, test: "const m=await import('./math.ts');assert.equal(m.left(3),6);assert.equal(m.right(4),8);assert.equal(m.double(5),10);const s=fs.readFileSync('math.ts','utf8');assert.equal((s.match(/n \* 2/g)||[]).length,1);" },
  { id: 'typescript-error', goal: 'Fix TypeScript TS2322: answer:number must be numeric 42 instead of string. Do not modify tests or tsconfig.', files: { 'math.ts': 'export const answer: number = "42";\n' }, test: `const r=spawnSync(process.execPath,[${JSON.stringify(path.join(repo, 'node_modules/typescript/bin/tsc'))},'--noEmit','--skipLibCheck','--target','ES2022','math.ts'],{encoding:'utf8'});assert.equal(r.status,0,r.stdout+r.stderr);` },
  { id: 'git-dirty-tree', goal: 'Fix sum(2,3) to 5. Preserve existing README user notes and untracked notes.txt exactly. Do not modify tests.', files: { 'math.ts': 'export const sum = (a: number, b: number) => a - b;\n' }, test: "const {sum}=await import('./math.ts');assert.equal(sum(2,3),5);assert.equal(fs.readFileSync('README.md','utf8'),'USER DIRTY NOTES\\n');assert.equal(fs.readFileSync('notes.txt','utf8'),'USER UNTRACKED\\n');" },
] as const;
const results: any[] = [];
const save = () => fs.writeFileSync(path.join(evidenceDir, 'benchmarks.json'), JSON.stringify({ at: new Date().toISOString(), trials: 2, budget: { promptTimeoutMs: 60000, maxOutputTokens: 2048, maxIterations: 1 }, model, discovery, baseline: '3395ec6', routing: 'LAB_ONLY', results, winner: 'NONE_NO_EQUIVALENCE_PROVEN' }, null, 2));
function snapshot(cwd: string): string {
  return createHash('sha256').update(fs.readdirSync(cwd).filter(f => f !== '.git').sort().map(f => f + ':' + fs.readFileSync(path.join(cwd, f), 'utf8')).join('\n')).digest('hex');
}
for (let trial = 1; trial <= 2; trial++) for (const fixture of fixtures) for (const engine of ['current-developer', 'opencode-proposal', 'codex-acp']) {
  if (!ready || engine === 'codex-acp') { results.push({ fixture: fixture.id, trial, engine, status: engine === 'codex-acp' ? 'SECURITY_GATE_BLOCKED' : 'LOCAL_MODEL_UNAVAILABLE', success: null, iterations: null, durationMs: null, files: [], commands: [], context: null, usage: 'UNKNOWN', recovery: 'NOT_RUN', quality: 'NOT_MEASURED', cancellation: 'NOT_RUN' }); save(); continue; }
  const root = tempLab(); const cwd = path.join(root, 'project'); fs.mkdirSync(cwd);
  fs.writeFileSync(path.join(cwd, 'package.json'), JSON.stringify({ name: fixture.id, type: 'module', scripts: { test: 'node test.mjs' } }));
  for (const [name, content] of Object.entries(fixture.files)) fs.writeFileSync(path.join(cwd, name), content);
  fs.writeFileSync(path.join(cwd, 'test.mjs'), "import assert from 'node:assert/strict';import fs from 'node:fs';import {spawnSync} from 'node:child_process';\n" + fixture.test);
  fs.writeFileSync(path.join(cwd, 'README.md'), 'BASELINE\n');
  const git = (...args: string[]) => execFileSync('git', args, { cwd, env: { ...process.env, GIT_AUTHOR_NAME: 'Lab', GIT_AUTHOR_EMAIL: 'lab@invalid', GIT_COMMITTER_NAME: 'Lab', GIT_COMMITTER_EMAIL: 'lab@invalid' } });
  git('init', '-q'); git('add', '.'); git('commit', '-qm', 'fixture');
  if (fixture.id === 'git-dirty-tree') { fs.writeFileSync(path.join(cwd, 'README.md'), 'USER DIRTY NOTES\n'); fs.writeFileSync(path.join(cwd, 'notes.txt'), 'USER UNTRACKED\n'); }
  const inputHash = snapshot(cwd); const h = await harness(root, `bench-${trial}-${engine}-${fixture.id}`);
  h.broker.addPolicy(({ request }) => {
    if (!/^file\.(write|patch|create|trash|rename|move|copy)$/.test(request.toolId)) return { ok: true };
    const args = request.args as { path?: string; to?: string };
    return [args.path, args.to].filter(Boolean).every(p => Object.keys(fixture.files).includes(p!))
      ? { ok: true } : { ok: false, reason: 'Benchmark fixture tests, manifests and user notes are immutable' };
  });
  const started = Date.now(); let server: OpenCodeProcessManager | undefined; let contextBytes = 0; let directMutation = false;
  let adapter: OpenCodeProposalAdapter | undefined;
  let releaseTask: (() => void) | undefined;
  const responseLog: string[] = [];
  try {
    let proposer = new ModelPatchProposer(async text => { contextBytes += Buffer.byteLength(text); const raw = await manager.runtime('ollama')!.generate!({ model, prompt: text, json: true, timeoutMs: 25000 }); responseLog.push(raw); return raw; });
    if (engine === 'opencode-proposal') {
      const port = await new Promise<number>(resolve => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const p = (s.address() as net.AddressInfo).port; s.close(() => resolve(p)); }); });
      server = new OpenCodeProcessManager(path.join(repo, 'node_modules/opencode-ai/bin/opencode.exe'), cwd, port, '1.18.32', model, endpoint);
      const bridge = new OpenCodeBridge(server); releaseTask = await bridge.leaseTask(); server.child?.stdout?.resume(); await bridge.validateProposalConfiguration();
      adapter = new OpenCodeProposalAdapter(bridge, { providerID: 'ollama-lab', modelID: model });
      const wrapped = { available: true, propose: async (input: any) => { const before = snapshot(cwd); contextBytes += input.context.bytes; const p = await adapter!.propose(input); if (snapshot(cwd) !== before) { directMutation = true; await server!.stop(); throw new Error('SECURITY_FAILURE: unmediated project mutation'); } return p; } };
      proposer = wrapped as ModelPatchProposer;
    }
    const delegate = createCodingDelegate({ proposer: () => proposer, maxRepairIterations: 1 });
    const outcome = await delegate({ runId: h.runId, prompt: fixture.goal, args: { project: fixture.id, goal: fixture.goal }, token: h.token,
      callTool: async (toolId, args) => h.broker.execute({ runId: h.runId, toolId, args }), note: () => {} });
    results.push({ fixture: fixture.id, trial, engine, inputHash, status: outcome.ok ? 'PASS' : 'FAIL', success: outcome.ok, detail: outcome.data,
      durationMs: Date.now() - started, contextBytes, tokens: adapter?.responses.map(r => ({ input: r.input, output: r.output, source: 'OBSERVED' })) ?? 'UNKNOWN',
      proposals: adapter?.responses ?? responseLog, files: h.dev.files.changes.summary(h.runId)?.files, commands: h.dev.commandLog, directMutation, temp: cwd,
      quality: 'FIXTURE_ASSERTIONS_ONLY', recovery: 'ONE_ATTEMPT_LIMIT', cancellation: 'CONTRACT_TEST_SEPARATE' });
  } catch (error) { results.push({ fixture: fixture.id, trial, engine, inputHash, status: directMutation ? 'SECURITY_FAILURE' : 'FAIL', success: false, error: String(error).slice(0, 500), durationMs: Date.now() - started, directMutation, temp: cwd }); }
  finally { releaseTask?.(); await server?.stop(); await server?.leases.dispose(); h.broker.closeRun(h.runId); await h.dev.cancelRun(h.runId); save(); }
  console.log(`BENCH ${trial} ${fixture.id} ${engine}: ${results.at(-1).status} (${Date.now() - started}ms)`);
}
await labRuntime?.stop(); await labRuntime?.leases.dispose();
