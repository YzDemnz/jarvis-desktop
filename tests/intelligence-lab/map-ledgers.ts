import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { FabricDatabase } from '../../electron/fabric/FabricDatabase';
import { ConversationLedger } from '../../src/fabric/ConversationLedger';
import { UsageLedger } from '../../src/fabric/UsageLedger';
import { LedgerMapping } from '../../src/intelligence/lab/LedgerMapping';
import { HandoffContextBuilder } from '../../src/fabric/ContextBudgetManager';
import { tempLab, repo } from './lab-harness';
const file = path.join(tempLab(), 'phase-a-ledgers.sqlite'); let db = new FabricDatabase(file);
const benchmark = JSON.parse(fs.readFileSync(path.join(repo, 'docs/evidence/phase-a/benchmarks.json'), 'utf8'));
const map = new LedgerMapping(new ConversationLedger(db), new UsageLedger(db)); let responses = 0, tokens = 0;
for (const r of benchmark.results) for (const [index, item] of (r.proposals ?? []).entries()) {
  const p = typeof item === 'string' ? { text: item, session: `jarvis-${r.trial}-${r.fixture}`, model: benchmark.model, input: null, output: null } : item;
  const observed = Number.isFinite(p.input) && Number.isFinite(p.output) ? { input: p.input, output: p.output, source: 'OBSERVED' as const } : undefined;
  map.record({ conversationId: 'phase-a-benchmark', taskId: `${r.trial}-${r.fixture}`, provider: r.engine, agent: r.engine, model: p.model,
    session: p.session, text: p.text, routingId: `lab-${r.engine}-${index}`, artifacts: r.files?.map((f: any) => f.path) ?? [], tools: r.commands?.map(() => 'terminal.execute') ?? [] }, observed);
  responses++; if (observed) tokens += 2;
}
db.close(); db = new FabricDatabase(file);
assert.equal(new ConversationLedger(db).page('phase-a-benchmark', 1000).length, responses);
const state = { taskId: 'handoff', conversationId: 'phase-a-benchmark', goal: 'Review evidence', currentTask: 'handoff', instructions: [], findings: ['Only JARVIS-applied proposals count as changes'], decisions: ['No Phase B without equivalence'], artifacts: [], openQuestions: [], pendingSteps: [], updatedAt: Date.now() };
const handoff = new HandoffContextBuilder().build(state, new ConversationLedger(db).workingMemory('phase-a-benchmark'), 8192, 8192);
assert.ok(handoff.findings.includes('Only JARVIS-applied proposals count as changes'));
assert.equal(new UsageLedger(db).quota('opencode-proposal', null, 'SUBSCRIPTION_PERCENT').state, 'UNKNOWN');
db.close();
fs.writeFileSync(path.join(repo, 'docs/evidence/phase-a/ledger-mapping.json'), JSON.stringify({ responses, observedUsageRecords: tokens, persistedAfterRestart: true, database: file, handoffMockRetainedFacts: true,
  realCodexHandoff: 'NOT_RUN_SECURITY_GATE', quota: 'UNKNOWN' }, null, 2));
console.log(`PASS ${responses} actual benchmark responses persisted; external session not master; quota UNKNOWN`);
