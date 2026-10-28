import { Readable, Writable } from 'node:stream';
import { ClientSideConnection, ndJsonStream, PROTOCOL_VERSION, type InitializeResponse, type PromptResponse } from '@agentclientprotocol/sdk';
import { ACPProcessManager } from './ACPProcessManager';
import { ACPEventAdapter } from './ACPEventAdapter';
import { ACPPermissionBridge } from './ACPPermissionBridge';

export class ACPTransport {
  connection: ClientSideConnection | null = null;
  initialized: InitializeResponse | null = null;
  authKind: string | null = null;
  readonly events = new ACPEventAdapter();
  constructor(readonly process: ACPProcessManager, readonly permissions: ACPPermissionBridge, readonly timeoutMs = 15000) {}
  async connect(): Promise<InitializeResponse> {
    if (this.connection) await this.close();
    await this.process.start();
    const child = this.process.child!;
    let frameBytes = 0;
    const boundedInput = (Readable.toWeb(child.stdout!) as ReadableStream<Uint8Array>).pipeThrough(new TransformStream<Uint8Array, Uint8Array>({
      transform: (chunk, controller) => {
        for (const byte of chunk) {
          frameBytes = byte === 10 ? 0 : frameBytes + 1;
          if (frameBytes > 1024 * 1024) { controller.error(new Error('ACP frame limit exceeded')); void this.process.stop(); return; }
        }
        controller.enqueue(chunk);
      },
    }));
    this.connection = new ClientSideConnection(() => ({
      sessionUpdate: async m => { this.events.accept(m); },
      requestPermission: r => this.permissions.requestPermission(r),
      readTextFile: async r => ({ content: await this.permissions.read(r.path) }),
      writeTextFile: async r => this.permissions.write(r.path, r.content),
      extNotification: async (method, params) => {
        if (method === '_auth/status_update') {
          const kind = (params.authStatus as { kind?: unknown } | undefined)?.kind;
          if (typeof kind === 'string' && ['account', 'api_key', 'gateway', 'external', 'none'].includes(kind)) this.authKind = kind;
        }
      },
    }), ndJsonStream(Writable.toWeb(child.stdin!) as WritableStream<Uint8Array>, boundedInput));
    try {
      const result = await this.deadline(this.connection.initialize({ protocolVersion: PROTOCOL_VERSION,
        clientInfo: { name: 'jarvis-integration-lab', version: '0.1.0' },
        clientCapabilities: { fs: { readTextFile: true, writeTextFile: true }, terminal: false },
      }));
      if (result.protocolVersion !== PROTOCOL_VERSION) throw new Error('ACP protocol version mismatch');
      this.initialized = result; return result;
    } catch (e) { await this.close(); throw e; }
  }
  async deadline<T>(promise: Promise<T>, timeout = this.timeoutMs): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try { return await Promise.race([promise, new Promise<never>((_, reject) => {
      timer = setTimeout(() => { void this.process.stop(); reject(new Error('ACP timeout; process retired')); }, timeout);
    })]); } finally { clearTimeout(timer); }
  }
  async prompt(sessionId: string, text: string): Promise<PromptResponse> {
    if (this.process.profile.promptSafety !== 'CLIENT_MEDIATED') throw new Error('SECURITY_GATE: external direct tools not proven mediated');
    if (!this.connection) throw new Error('Not initialized');
    return this.deadline(this.connection.prompt({ sessionId, prompt: [{ type: 'text', text }] }));
  }
  async cancel(sessionId: string): Promise<void> {
    if (!this.connection) return;
    await this.deadline(this.connection.cancel({ sessionId }), 2000);
  }
  async close(): Promise<void> { await this.process.stop(); this.connection = null; this.initialized = null; }
}
