import { AgentSideConnection, ndJsonStream, PROTOCOL_VERSION, RequestError } from '@agentclientprotocol/sdk';
import { Readable, Writable } from 'node:stream';
let session = 0; let cancelPending;
const connection = new AgentSideConnection(client => ({
  initialize: () => ({ protocolVersion: process.argv.includes('--mismatch') ? 99 : PROTOCOL_VERSION,
    agentInfo: { name: 'jarvis-fake-acp', version: '1' }, authMethods: [{ id: 'fake', name: 'Fake' }], agentCapabilities: { loadSession: true } }),
  authenticate: () => ({}),
  newSession: () => { if (process.argv.includes('--auth')) throw RequestError.authRequired(); return { sessionId: `fake-${++session}` }; },
  loadSession: r => { if (r.sessionId === 'expired') throw new Error('Session expired'); return {}; },
  prompt: async r => {
    const text = r.prompt[0]?.text;
    if (text === 'crash') process.exit(23);
    if (text === 'oversize') { process.stdout.write('x'.repeat(1024 * 1024 + 1)); return new Promise(() => {}); }
    if (text === 'hang') return new Promise(() => {});
    if (text === 'wait') return new Promise(resolve => { cancelPending = () => resolve({ stopReason: 'cancelled' }); });
    if (text === 'permission') {
      const result = await client.requestPermission({ sessionId: r.sessionId, toolCall: { toolCallId: 'external-shell', title: 'unsafe raw shell', status: 'pending' }, options: [{ optionId: 'allow', name: 'Allow once', kind: 'allow_once' }] });
      await client.sessionUpdate({ sessionId: r.sessionId, update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: result.outcome.outcome } } });
    } else if (text === 'secure-read') {
      const result = await client.readTextFile({ sessionId: r.sessionId, path: 'sum.ts' });
      await client.sessionUpdate({ sessionId: r.sessionId, update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: result.content } } });
    } else if (text === 'secure-write-denied') {
      let outcome = 'unexpectedly-allowed';
      try { await client.writeTextFile({ sessionId: r.sessionId, path: 'sum.ts', content: 'direct overwrite' }); }
      catch { outcome = 'denied'; }
      await client.sessionUpdate({ sessionId: r.sessionId, update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: outcome } } });
    } else {
      await client.sessionUpdate({ sessionId: r.sessionId, update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'Retained fact: sum must add.' } } });
      await client.sessionUpdate({ sessionId: r.sessionId, update: { sessionUpdate: 'usage_update', used: 17, size: 8192 } });
    }
    return { stopReason: 'end_turn' };
  },
  cancel: () => { cancelPending?.(); cancelPending = undefined; },
}), ndJsonStream(Writable.toWeb(process.stdout), Readable.toWeb(process.stdin)));
await connection.closed;
