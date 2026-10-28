import assert from 'node:assert/strict';
import path from 'node:path';
import { WindowsHelperBridge } from '../../electron/desktop/WindowsHelperBridge';
import { fixtureWindow, launchNativeFixture } from './native-fixture';

const executable = process.env.JARVIS_AUTOMATION_HELPER ?? path.resolve(
  'native/windows-helper/bin/Release/net8.0-windows/win-x64/publish/jarvis-automation-helper.exe',
);
const bridge = new WindowsHelperBridge({ executable, maxRestarts: 0 });
const fixture = launchNativeFixture();

try {
  assert.equal(await bridge.start(), true, 'helper handshake');
  assert.equal(await bridge.send('ping', {}), 'pong');
  assert.equal(await bridge.sessionState(), 'ACTIVE');
  const monitors = await bridge.monitors();
  assert.ok(monitors.length >= 1, 'physical monitor discovery');
  const windows = await bridge.listWindows();
  assert.ok(windows.length >= 1, 'real Windows enumeration');
  const overlay = windows.find((window) => window.title.includes('Cursor Overlay'));
  if (overlay) {
    try { await bridge.uiRoot(overlay.windowId); }
    catch (error) { console.log(`UIA overlay no inspeccionable: ${String(error)}`); }
  }
  const ownWindow = await fixtureWindow(bridge);
  const root = await bridge.uiRoot(ownWindow.windowId);
  const queue = [{ element: root, depth: 0 }];
  let documentId: string | null = null;
  let visited = 0;
  while (queue.length && visited < 300) {
    const { element, depth } = queue.shift()!;
    visited += 1;
    if (element.controlType === 'Edit' || element.controlType === 'Document') {
      if (element.patterns.includes('Value')) documentId = element.id;
    }
    if (depth < 6 && element.childCount > 0) {
      const children = await bridge.uiChildren(element.id);
      queue.push(...children.map((child) => ({ element: child, depth: depth + 1 })));
    }
  }
  assert.ok(documentId, 'The isolated fixture exposes an editable UIA Value');
  const sample = 'Prueba JARVIS Windows: áéíóú ñ';
  await bridge.uiSetValue(documentId, sample);
  assert.equal((await bridge.uiElement(documentId))?.value, sample);
  console.log(`UIA fixture: ${visited} nodos, Unicode Value verificado`);
  console.log(`PASS helper: ping, sesión, ${monitors.length} monitor(es), ${windows.length} ventana(s)`);
} finally {
  bridge.kill();
  fixture.kill();
}
