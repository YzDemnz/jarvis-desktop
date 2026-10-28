import type { ToolPolicy, ToolBroker } from '../agent/ToolBroker';
import type { BrokeredModelPort } from './backends/BrokeredBackend';
import { BrokeredBackend } from './backends/BrokeredBackend';
import type { ExecutionRequest, ExecutionResult, ExecutionSession } from './types';
import type { ProjectTrustDecision } from './ProjectTrustService';

export type BrokeredMode = 'BROKERED_PROPOSE' | 'BROKERED_SCRATCH_APPLY';
const PROPOSAL_TOOLS = new Set([
  'project.list', 'project.open', 'project.inspect',
  'code.context', 'code.searchText', 'code.searchFiles', 'code.findReferences', 'code.findDefinition',
  'file.read', 'file.proposePatch', 'git.status', 'changes.review',
]);

/** Scratch execution requires both trust and an explicit mode request; default is always propose. */
export function selectBrokeredMode(trust: ProjectTrustDecision, requested: BrokeredMode | null = null): BrokeredMode {
  return requested === 'BROKERED_SCRATCH_APPLY' && trust.state === 'TRUSTED' ? 'BROKERED_SCRATCH_APPLY' : 'BROKERED_PROPOSE';
}

export function brokeredProposePolicy(runId: string): ToolPolicy {
  return ({ tool, request }) => request.runId !== runId || PROPOSAL_TOOLS.has(tool.id)
    ? { ok: true }
    : { ok: false, reason: `TOOL_BLOCKED:BROKERED_PROPOSE:${tool.id}` };
}

/** EF-2A prototype: all model requests still traverse the authoritative ToolBroker. */
export class BrokeredProposeBackend extends BrokeredBackend {
  override readonly id = 'jarvis-brokered-propose';
  constructor(private readonly proposeBroker: ToolBroker, model: BrokeredModelPort | null = null) { super(proposeBroker, model); }
  override async execute(session: ExecutionSession, request: ExecutionRequest): Promise<ExecutionResult> {
    const detach = this.proposeBroker.addPolicy(brokeredProposePolicy(request.runId));
    try { return await super.execute(session, request); }
    finally { detach(); }
  }
}
