import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { DevService } from '../../src/dev/DevService';
import { NodeFsPort, NodeProcessPort, DirectoryTrashPort, DiskSnapshotPort } from '../../electron/dev/nodePorts';
import { ToolBroker } from '../../src/agent/ToolBroker';
import { ToolRegistry, TOOL_DEFINITIONS } from '../../src/agent/registry';
import { AuditService } from '../../src/agent/AuditService';
import { ApprovalEngine } from '../../src/agent/ApprovalEngine';
import { PermissionEngine } from '../../src/agent/permissions';
import { CancellationToken } from '../../src/agent/cancellation';
import type { ACPAgentProfile } from '../../src/intelligence/transports/acp/ACPAgentProfile';
export const repo = path.resolve(import.meta.dirname, '../..');
export function tempLab() { return fs.mkdtempSync(path.join(os.tmpdir(), 'jarvis-convergence-')); }
export async function harness(root: string, runId = 'lab', options: { allowTerminal?: boolean } = {}) {
  const dev = new DevService({ fs: new NodeFsPort(), processes: new NodeProcessPort(),
    trash: new DirectoryTrashPort(path.join(root, 'trash')), snapshots: new DiskSnapshotPort(path.join(root, 'snapshots')), home: os.homedir() });
  const approvals = new ApprovalEngine();
  // Human fixture approval policy: temporary project changes ONLY, never shell escalation.
  approvals.subscribe(r => { if (r) queueMicrotask(() => approvals.resolve(r.id, /terminal|process/.test(r.toolId) && !options.allowTerminal ? 'deny' : 'allow_once')); });
  const broker = new ToolBroker({ authoritative: true, registry: new ToolRegistry(TOOL_DEFINITIONS), audit: new AuditService(), permissions: new PermissionEngine(), approvals,
    adapters: dev.adapters(), policies: [dev.policy()] });
  const token = new CancellationToken(); broker.openRun(runId, 'ADMIN', token);
  await dev.init(); await dev.projects.addRoot(root);
  return { dev, broker, token, runId };
}
export function fakeProfile(args: string[] = []): ACPAgentProfile {
  return { id: 'fake', name: 'Fake ACP', command: process.execPath, args: [path.join(repo, 'tests/intelligence-lab/fake-agent.mjs'), ...args], version: '1',
    capabilities: ['coding'], authenticationMode: 'FAKE', supportsResume: true, supportsCancel: true, supportsUsage: false,
    supportsTools: true, supportsMCP: false, workingDirectoryPolicy: 'TEMP_ONLY', environmentPolicy: 'ALLOWLIST', promptSafety: 'CLIENT_MEDIATED' };
}
