import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { registerCredentialValue } from '../../src/machine/CredentialBoundary';

export interface SecretRef { id: string; providerId: string; destination: string; use: 'PROVIDER_AUTH' }
export interface SecretEncryption { isEncryptionAvailable(): boolean; encryptString(value: string): Buffer; decryptString(value: Buffer): string }
interface Entry { ref: SecretRef; ciphertext: string }
/** DPAPI via Electron on Windows. No reveal/read-value RPC, no plaintext fallback. */
export class CredentialStore {
  private entries = new Map<string, Entry>();
  constructor(private readonly file: string, private readonly encryption: SecretEncryption) {
    if (!encryption.isEncryptionAvailable()) throw Error('CREDENTIAL_ENCRYPTION_UNAVAILABLE');
    if (fs.existsSync(file)) {
      const data = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (data.version !== 1 || !Array.isArray(data.entries) || data.entries.length > 64) throw Error('INVALID_CREDENTIAL_STORE');
      for (const entry of data.entries as Entry[]) {
        if (typeof entry.ref?.id !== 'string' || !entry.ref.id.startsWith('secret:') || entry.ref.use !== 'PROVIDER_AUTH'
          || typeof entry.ref.providerId !== 'string' || typeof entry.ref.destination !== 'string' || typeof entry.ciphertext !== 'string') throw Error('INVALID_CREDENTIAL_ENTRY');
        const u = new URL(entry.ref.destination);
        if (u.username || u.password || u.search || u.hash || !['http:', 'https:'].includes(u.protocol)) throw Error('INVALID_CREDENTIAL_ENTRY');
        this.entries.set(entry.ref.id, entry);
        this.remember(encryption.decryptString(Buffer.from(entry.ciphertext, 'base64')));
      }
    }
  }
  private remember(value: string) {
    registerCredentialValue(value);
    registerCredentialValue(Buffer.from(value).toString('base64'));
  }
  private persist() {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    fs.writeFileSync(this.file + '.tmp', JSON.stringify({ version: 1, entries: [...this.entries.values()] }), { mode: 0o600 });
    fs.renameSync(this.file + '.tmp', this.file);
  }
  put(providerId: string, destination: string, value: string): SecretRef {
    if (typeof value !== 'string' || value.length < 6 || value.length > 16384 || /[\r\n\0]/.test(value)) throw Error('INVALID_PROVIDER_CREDENTIAL');
    const url = new URL(destination);
    if (!providerId || providerId.length > 200 || url.username || url.password || url.search || url.hash || !['http:', 'https:'].includes(url.protocol)) throw Error('INVALID_CREDENTIAL_DESTINATION');
    const ref: SecretRef = { id: 'secret:' + randomUUID(), providerId, destination: url.href.replace(/\/$/, ''), use: 'PROVIDER_AUTH' };
    const ciphertext = this.encryption.encryptString(value).toString('base64');
    this.remember(value);
    // Rotation revokes prior references; old in-flight output remains masked.
    for (const [id, item] of this.entries) if (item.ref.providerId === providerId) this.entries.delete(id);
    this.entries.set(ref.id, { ref, ciphertext }); this.persist(); return { ...ref };
  }
  references(): SecretRef[] { return [...this.entries.values()].map(entry => ({ ...entry.ref })); }
  remove(providerId: string) { for (const [id, item] of this.entries) if (item.ref.providerId === providerId) this.entries.delete(id); this.persist(); }
  async use<T>(refId: string, binding: Omit<SecretRef, 'id'>, operation: (value: string) => Promise<T>): Promise<T> {
    const entry = this.entries.get(refId);
    if (!entry || entry.ref.providerId !== binding.providerId || entry.ref.destination !== binding.destination || binding.use !== 'PROVIDER_AUTH') throw Error('CREDENTIAL_BINDING_DENIED');
    let value = this.encryption.decryptString(Buffer.from(entry.ciphertext, 'base64'));
    try { return await operation(value); }
    finally { value = ''; } // JS strings cannot promise memory zeroization.
  }
}
