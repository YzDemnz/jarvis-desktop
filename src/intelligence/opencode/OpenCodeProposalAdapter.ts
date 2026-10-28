import { parseProposal, type PatchProposer, type ProposalInput } from '../../dev/coding';
import type { OpenCodeBridge } from './OpenCodeBridge';
/** Proposals pass the existing parser, then existing coding delegate's broker.
 * External command suggestions remain data, never executable instructions.
 */
export class OpenCodeProposalAdapter implements PatchProposer {
  readonly available = true;
  readonly experimentalProvider = true;
  readonly responses: { session: string; model: string; text: string; input: number | null; output: number | null }[] = [];
  constructor(readonly bridge: OpenCodeBridge, readonly model: { providerID: string; modelID: string }) {}
  async propose(input: ProposalInput) {
    const session = (await this.bridge.createSession()).data!.id;
    const text = `Goal: ${input.goal}\nErrors: ${input.failures.map(f => f.excerpt).join('\n')}\nFiles:\n${input.context.files.map(f => `=== ${f.path}\n${f.content}`).join('\n')}`;
    const response = await this.bridge.propose(session, text, this.model);
    const raw = response.data?.parts.filter(p => p.type === 'text').map(p => p.text).join('\n') ?? '';
    const info = response.data?.info;
    this.responses.push({ session, model: this.model.modelID, text: raw, input: info?.tokens.input ?? null, output: info?.tokens.output ?? null });
    let proposal: unknown;
    try { proposal = JSON.parse(raw.slice(raw.indexOf('{'), raw.lastIndexOf('}') + 1)); } catch { return null; }
    const p = proposal as { diagnosis?: unknown; edits?: { path?: unknown; oldText?: unknown; newText?: unknown }[] };
    if (!Array.isArray(p.edits) || !p.edits.length || p.edits.length > 20) return null;
    return parseProposal(JSON.stringify({ rationale: p.diagnosis, edits: p.edits.map(e => ({ path: e.path, ops: [{ kind: 'edit', edit: { oldText: e.oldText, newText: e.newText } }] })) }));
  }
}
