import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { ProcessPort } from '../dev/ports';
import { TerminalService } from '../dev/TerminalService';
import { containsSecret } from '../intelligence/capsule/AgentCapsuleWorkspace';
import { ALLOWED_SCRIPTS, removeOwnedTemp, scratchEnvironment, ScratchProcessPort } from './TrustedScratchService';
import type { ProjectTrustService } from './ProjectTrustService';
import type { ExecutionLedger, RealVerifyLedgerEntry } from './ExecutionLedger';

/** Executes a package script in the real project only after current explicit trust is checked. */
export class RealVerificationService {
  constructor(private readonly trust: ProjectTrustService, private readonly port: ProcessPort,
    private readonly ledger: ExecutionLedger, private readonly maxDurationMs = 120_000) {
    if (!Number.isSafeInteger(maxDurationMs) || maxDurationMs < 1_000 || maxDurationMs > 600_000) throw new Error('REAL_VERIFY_DURATION_INVALID');
  }
  async verify(input: { project: string; script: string; runId: string; signal?: AbortSignal }): Promise<RealVerifyLedgerEntry> {
    const decision = await this.trust.status(input.project);
    const basic = { id: randomUUID(), runId: input.runId, at: Date.now(), canonicalRoot: decision.canonicalRoot,
      script: input.script, literalScript: null, environmentNames: [] as string[], exitCode: null, reason: null };
    if (decision.state !== 'TRUSTED') {
      const entry: RealVerifyLedgerEntry = { ...basic, status: 'REAL_VERIFY_SKIPPED_UNTRUSTED', reason: decision.reason };
      this.ledger.realVerify(entry); return entry;
    }
    if (!ALLOWED_SCRIPTS.has(input.script)) throw new Error('REAL_VERIFY_SCRIPT_NOT_ALLOWLISTED');
    const pkg = JSON.parse(fs.readFileSync(path.join(decision.canonicalRoot, 'package.json'), 'utf8')) as { scripts?: Record<string, string> };
    const literalScript = pkg.scripts?.[input.script];
    if (!literalScript || containsSecret(Buffer.from(literalScript))) throw new Error('REAL_VERIFY_SCRIPT_UNAVAILABLE_OR_SECRET');
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'jarvis-real-verify-'));
    const env = scratchEnvironment(process.env, root);
    for (const dir of ['meta', 'tmp', 'profile', 'profile/AppData/Roaming', 'profile/AppData/Local']) fs.mkdirSync(path.join(root, dir), { recursive: true });
    fs.writeFileSync(env.NPM_CONFIG_USERCONFIG!, '', { flag: 'wx' });
    fs.writeFileSync(env.NPM_CONFIG_GLOBALCONFIG!, '', { flag: 'wx' });
    const terminal = new TerminalService(new ScratchProcessPort(this.port, env));
    let entry: RealVerifyLedgerEntry | null = null;
    try {
      // Re-evaluate after setup: revocation or identity change must stop host execution.
      if ((await this.trust.status(decision.canonicalRoot)).state !== 'TRUSTED') throw new Error('REAL_VERIFY_TRUST_CHANGED');
      const result = await terminal.execute({ executable: 'npm', args: ['run', input.script],
        cwd: decision.canonicalRoot, timeoutMs: this.maxDurationMs }, { runId: input.runId, signal: input.signal });
      entry = { ...basic, literalScript, environmentNames: Object.keys(env).sort(), exitCode: result.exitCode,
        status: result.exitCode === 0 && !result.cancelled && !result.timedOut ? 'REAL_VERIFY_PASS' : 'REAL_VERIFY_FAIL',
        reason: result.cancelled ? 'CANCELLED' : result.timedOut ? 'TIMEOUT' : result.exitCode === 0 ? null : `NONZERO_EXIT:${result.stderr.slice(0, 300)}` };
      this.ledger.realVerify(entry);
      return entry;
    } finally {
      await terminal.cancelRun(input.runId);
      const until = Date.now() + 2_000;
      while (terminal.runningCount(input.runId) && Date.now() < until) await new Promise(resolve => setTimeout(resolve, 25));
      if (terminal.runningCount(input.runId)) throw new Error('REAL_VERIFY_PROCESS_ORPHAN_REMAINS');
      removeOwnedTemp(root, 'jarvis-real-verify-');
    }
  }
}
