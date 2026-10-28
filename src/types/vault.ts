/**
 * The vault UI never sees a secret value — only metadata and a handle.
 * Stage 2 resolves handles inside a Credential Broker in the main process
 * (Windows DPAPI / TPM-backed), and the model layer only ever receives
 * the handle, never the plaintext.
 */
export interface VaultEntry {
  id: string;
  name: string;
  category: 'developer' | 'ai' | 'finance' | 'personal' | 'infrastructure';
  maskedIdentity: string;
  handle: string;
  lastUsed: number;
  status: 'active' | 'rotate_soon' | 'expired';
  tags: string[];
}

export interface CredentialBroker {
  list(): Promise<VaultEntry[]>;
  /** Resolves to an opaque injection token consumed by a tool, not by a model. */
  requestUse(handle: string, reason: string): Promise<{ granted: boolean; token?: string }>;
}
