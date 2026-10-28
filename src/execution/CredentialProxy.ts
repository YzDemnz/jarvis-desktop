import { randomUUID } from 'node:crypto';

export type ProxyOperation = 'GIT_FETCH' | 'GIT_CLONE' | 'GIT_PUSH_PROPOSAL' | 'PACKAGE_METADATA' | 'PACKAGE_DOWNLOAD';
export interface CredentialProxyRequest { runId: string; realm: string; operation: ProxyOperation; target: string }
export interface CredentialProxyDecision { status: 'DENIED' | 'PROPOSED' | 'AUTHORIZED'; receiptId: string; credentialExposed: false; reason: string }
export interface CredentialProxy { request(input: CredentialProxyRequest): Promise<CredentialProxyDecision> }

/** Policy-only fake: never stores, injects, serializes or returns a real credential. */
export class FakeCredentialProxy implements CredentialProxy {
  readonly calls: CredentialProxyRequest[] = [];
  constructor(private readonly allowedRepos: Set<string>, private readonly allowedRegistries: Set<string>) {}
  async request(input: CredentialProxyRequest): Promise<CredentialProxyDecision> {
    this.calls.push({ ...input });
    const repo = input.operation.startsWith('GIT_');
    const allowed = repo ? this.allowedRepos.has(input.target) : this.allowedRegistries.has(input.target);
    return { status: !allowed ? 'DENIED' : input.operation === 'GIT_PUSH_PROPOSAL' ? 'PROPOSED' : 'AUTHORIZED',
      receiptId: randomUUID(), credentialExposed: false,
      reason: !allowed ? 'TARGET_NOT_ALLOWLISTED' : input.operation === 'GIT_PUSH_PROPOSAL' ? 'HUMAN_APPROVAL_REQUIRED' : 'FAKE_POLICY_ONLY' };
  }
}

export class SandboxGitProxy {
  constructor(private readonly proxy: CredentialProxy) {}
  async request(runId: string, operation: 'fetch' | 'clone' | 'push proposal', repo: string): Promise<CredentialProxyDecision> {
    return this.proxy.request({ runId, realm: 'STRONG_ISOLATED', operation: operation === 'fetch' ? 'GIT_FETCH'
      : operation === 'clone' ? 'GIT_CLONE' : 'GIT_PUSH_PROPOSAL', target: repo });
  }
}

export class PackageRegistryProxy {
  constructor(private readonly proxy: CredentialProxy) {}
  async request(runId: string, operation: 'metadata' | 'download', registry: string): Promise<CredentialProxyDecision> {
    return this.proxy.request({ runId, realm: 'STRONG_ISOLATED', operation: operation === 'metadata' ? 'PACKAGE_METADATA' : 'PACKAGE_DOWNLOAD', target: registry });
  }
}
