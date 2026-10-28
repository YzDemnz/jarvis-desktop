import type { VaultEntry } from '@/types';

const day = 86_400_000;

export const mockVaultEntries: VaultEntry[] = [
  { id: 'v1', name: 'GitHub', category: 'developer', maskedIdentity: 'al•••@proton.me', handle: 'vault://github/pat', lastUsed: Date.now() - 1000 * 60 * 18, status: 'active', tags: ['token', 'repo'] },
  { id: 'v2', name: 'OpenAI', category: 'ai', maskedIdentity: 'sk-•••••••••4f2a', handle: 'vault://openai/key', lastUsed: Date.now() - 1000 * 60 * 60 * 3, status: 'active', tags: ['api'] },
  { id: 'v3', name: 'Anthropic', category: 'ai', maskedIdentity: 'sk-ant-•••••b91', handle: 'vault://anthropic/key', lastUsed: Date.now() - 1000 * 60 * 47, status: 'active', tags: ['api'] },
  { id: 'v4', name: 'Google Gemini', category: 'ai', maskedIdentity: 'AIza••••••••7Qd', handle: 'vault://google/key', lastUsed: Date.now() - day * 2, status: 'rotate_soon', tags: ['api'] },
  { id: 'v5', name: 'Google', category: 'personal', maskedIdentity: 'al•••@gmail.com', handle: 'vault://google/account', lastUsed: Date.now() - day * 5, status: 'active', tags: ['cuenta'] },
  { id: 'v6', name: 'Broker (paper)', category: 'finance', maskedIdentity: 'demo-••••21', handle: 'vault://broker/paper', lastUsed: Date.now() - day * 9, status: 'active', tags: ['paper'] },
  { id: 'v7', name: 'Servidor Reforger', category: 'infrastructure', maskedIdentity: 'root@10.0.•.•', handle: 'vault://ssh/reforger', lastUsed: Date.now() - day * 14, status: 'rotate_soon', tags: ['ssh'] },
  { id: 'v8', name: 'Registro de dominios', category: 'infrastructure', maskedIdentity: 'al•••@proton.me', handle: 'vault://dns/registrar', lastUsed: Date.now() - day * 61, status: 'expired', tags: ['dns'] },
];
