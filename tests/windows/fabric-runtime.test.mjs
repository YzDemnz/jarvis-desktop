import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { _electron as electron } from 'playwright';

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'jarvis-fabric-native-'));
const executablePath = process.env.JARVIS_EXE ?? path.resolve('release/win-unpacked/JARVIS.exe');
const conversationId = `fabric-test-${crypto.randomUUID()}`;
const message = { conversationId, messageId: crypto.randomUUID(), parentId: null, role: 'user', content: 'persistencia nativa',
  timestamp: Date.now(), providerId: null, modelId: null, channel: 'test', taskId: null,
  tools: [], artifacts: [], usageIds: [], contextRefs: [], routingDecisionId: null };
let app;
try {
  const env = { ...process.env, JARVIS_ALLOW_FIXTURES: '1', JARVIS_TEST_USER_DATA: temp };
  app = await electron.launch({ executablePath, env, timeout: 30000 });
  app.process().stderr?.on('data', (data) => console.log('ELECTRON STDERR', String(data).slice(0, 2000)));
  console.log('FIRST LAUNCH', await app.evaluate(({ app, BrowserWindow }) => ({ userData: app.getPath('userData'), windows: BrowserWindow.getAllWindows().length })));
  let shell = await app.firstWindow();
  await shell.getByRole('button', { name: 'Home', exact: true }).waitFor({ state: 'visible', timeout: 20000 });
  const version = await shell.evaluate(() => window.jarvis.app.version());
  assert.equal(version, JSON.parse(fs.readFileSync(path.resolve('package.json'), 'utf8')).version);
  const userData = await app.evaluate(({ app }) => app.getPath('userData'));
  assert.ok(path.resolve(userData).toLowerCase().startsWith(path.resolve(temp).toLowerCase()), 'La prueba debe usar un perfil aislado');
  assert.equal(await shell.evaluate((value) => window.jarvis.fabric.appendMessage(value), message), true);
  const unknown = await shell.evaluate(() => window.jarvis.fabric.quota('unconnected', null, 'REQUESTS'));
  assert.equal(unknown.remaining, null);
  assert.equal(unknown.state, 'UNKNOWN');
  await app.close(); app = null;

  app = await electron.launch({ executablePath, env, timeout: 30000 });
  shell = await app.firstWindow();
  await shell.getByRole('button', { name: 'Home', exact: true }).waitFor({ state: 'visible', timeout: 20000 });
  const rows = await shell.evaluate((id) => window.jarvis.fabric.messagePage(id, 10), conversationId);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].message.content, 'persistencia nativa');
  console.log('PASS SQLite Electron: mensaje y cuota desconocida, persistencia tras reinicio, perfil aislado');
} finally {
  await app?.close();
  const resolved = path.resolve(temp); const root = path.resolve(os.tmpdir()) + path.sep;
  if (resolved.startsWith(root) && path.basename(resolved).startsWith('jarvis-fabric-native-')) fs.rmSync(resolved, { recursive: true, force: true, maxRetries: 5 });
}
