import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';

const repo = path.resolve(import.meta.dirname, '../..');
const evidenceDir = path.join(repo, 'docs/evidence/ef1');
fs.mkdirSync(evidenceDir, { recursive: true });
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'jarvis-ef1-native-'));
const prompt = 'In this temporary fixture, find why the test fails, fix math.js, and run npm test. Do not read files outside this fixture or access the network. Briefly report commands and result.';
const makeFixture = name => {
  const dir = path.join(root, name); fs.mkdirSync(dir);
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: 'ef1-native-fixture', private: true, scripts: { test: 'node test.cjs' } }));
  fs.writeFileSync(path.join(dir, 'math.js'), 'exports.sum = (a, b) => a - b;\n');
  fs.writeFileSync(path.join(dir, 'test.cjs'), "const {sum}=require('./math'); if(sum(2,3)!==5) process.exit(1);\n");
  return dir;
};
const run = (command, args, cwd, timeoutMs) => new Promise(resolve => {
  const start = Date.now(); let output = ''; let killed = false;
  const child = spawn(command, args, { cwd, windowsHide: true, shell: false, env: { ...process.env, CI: '1' } });
  child.stdin?.end();
  const capture = chunk => { if (output.length < 2_000_000) output += chunk.toString(); };
  child.stdout?.on('data', capture); child.stderr?.on('data', capture);
  const timer = setTimeout(() => { killed = true; child.kill(); }, timeoutMs);
  child.on('error', error => { clearTimeout(timer); resolve({ exitCode: null, error: String(error), durationMs: Date.now() - start, output, timedOut: killed }); });
  child.on('close', code => { clearTimeout(timer); resolve({ exitCode: code, error: null, durationMs: Date.now() - start, output, timedOut: killed }); });
});
const summarize = (name, dir, outcome, policy) => {
  const events = outcome.output.split(/\r?\n/).flatMap(line => { try { return [JSON.parse(line)]; } catch { return []; } });
  const commands = events.filter(e => e.type === 'item.started' || e.type === 'item.completed').map(e => e.item).filter(i => i?.type === 'command_execution').map(i => ({ command: i.command, exitCode: i.exit_code }));
  const usage = events.findLast(e => e.type === 'turn.completed')?.usage ?? null;
  const changed = fs.readFileSync(path.join(dir, 'math.js'), 'utf8').includes('a + b');
  const report = { provider: name, trust: 'PROVIDER_MANAGED', policy, fixtureOnly: true, status: changed && outcome.exitCode === 0 ? 'PASS' : outcome.timedOut ? 'TIMEOUT' : 'BLOCKED',
    exitCode: outcome.exitCode, error: outcome.error, durationMs: outcome.durationMs, changedFiles: changed ? ['math.js'] : [],
    testExit: null, commands, eventTypes: [...new Set(events.map(e => e.type))], usage, networkObserved: 'NOT_MEASURED',
    outputTail: outcome.output.slice(-2000).replaceAll(root, '<TEMP_FIXTURE>') };
  return report;
};
try {
  const codexDir = makeFixture('codex');
  const codex = await run('codex.exe', ['exec', '--ephemeral', '--ignore-user-config', '-s', 'workspace-write', '-c', 'approval_policy="never"', '-C', codexDir, '--skip-git-repo-check', '--json', prompt], codexDir, 150_000);
  const codexReport = summarize('Codex', codexDir, codex, 'workspace-write; approval_policy=never; ephemeral; no danger-full-access');
  const codexTest = await run(process.execPath, ['test.cjs'], codexDir, 10_000); codexReport.testExit = codexTest.exitCode;
  if (codexReport.status === 'PASS' && codexTest.exitCode !== 0) codexReport.status = 'PARTIAL';
  fs.writeFileSync(path.join(evidenceDir, 'codex-native-poc.json'), JSON.stringify(codexReport, null, 2));
  console.log(`Codex: ${codexReport.status}, test=${codexReport.testExit}, ${codexReport.durationMs}ms`);
  const openDir = makeFixture('opencode');
  const openExe = path.join(repo, 'node_modules/opencode-ai/bin/opencode.exe');
  const open = fs.existsSync(openExe) ? await run(openExe, ['run', '--pure', '--format', 'json', '--dir', openDir, '--model', 'ollama/qwen2.5:3b-instruct', prompt], openDir, 90_000)
    : { exitCode: null, error: 'OpenCode executable absent', durationMs: 0, output: '', timedOut: false };
  const openReport = summarize('OpenCode', openDir, open, 'OpenCode native; explicit local Ollama model; --pure; TEMP fixture');
  const openTest = await run(process.execPath, ['test.cjs'], openDir, 10_000); openReport.testExit = openTest.exitCode;
  if (openReport.status === 'PASS' && openTest.exitCode !== 0) openReport.status = 'PARTIAL';
  fs.writeFileSync(path.join(evidenceDir, 'opencode-native-poc.json'), JSON.stringify(openReport, null, 2));
  console.log(`OpenCode: ${openReport.status}, test=${openReport.testExit}, ${openReport.durationMs}ms`);
} finally { fs.rmSync(root, { recursive: true, force: true }); }
