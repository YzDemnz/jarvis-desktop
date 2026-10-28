import assert from 'node:assert/strict';
import path from 'node:path';
import { WindowsHelperBridge } from '../../electron/desktop/WindowsHelperBridge';
import { fixtureWindow, launchNativeFixture } from './native-fixture';

const executable = path.resolve('native/windows-helper/bin/Release/net8.0-windows/win-x64/publish/jarvis-automation-helper.exe');
const bridge = new WindowsHelperBridge({ executable, maxRestarts: 0 });
const fixture = launchNativeFixture();

try {
  assert.equal(await bridge.start(), true);
  const monitor = (await bridge.monitors())[0];
  assert.ok(monitor && monitor.bounds.width > 100 && monitor.bounds.height > 100);
  const processes = await bridge.processes();
  assert.ok(processes.some((process) => process.name.toLowerCase().includes('jarvisnativetestfixture')));
  const region = await bridge.captureRegion({ x: monitor.bounds.x, y: monitor.bounds.y, width: 32, height: 32 });
  assert.equal(region.width, 32);
  assert.equal(region.height, 32);
  assert.ok(Buffer.from(region.data, 'base64').subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])));

  const window = await fixtureWindow(bridge);
  assert.ok(window.state === 'normal', 'La ventana aislada debe estar abierta y restaurada.');
  const before = window.bounds;
  try {
    await bridge.moveWindow(window.windowId, before.x + 24, before.y + 16);
    const moved = (await bridge.listWindows()).find((item) => item.windowId === window.windowId);
    assert.equal(moved?.bounds.x, before.x + 24);
    assert.equal(moved.bounds.y, before.y + 16);
    await bridge.resizeWindow(window.windowId, before.width - 40, before.height - 30);
    const resized = (await bridge.listWindows()).find((item) => item.windowId === window.windowId);
    assert.equal(resized?.bounds.width, before.width - 40);
    assert.equal(resized.bounds.height, before.height - 30);
    const capture = await bridge.captureWindow(window.windowId);
    assert.equal(capture.width, resized.bounds.width);
    assert.equal(capture.height, resized.bounds.height);
  } finally {
    await bridge.moveWindow(window.windowId, before.x, before.y);
    await bridge.resizeWindow(window.windowId, before.width, before.height);
  }
  const restored = (await bridge.listWindows()).find((item) => item.windowId === window.windowId);
  assert.deepEqual(restored?.bounds, before, 'La ventana vuelve exactamente a su posición y tamaño anteriores.');
  console.log(`PASS nativo: procesos, PNG región y ventana, mover/redimensionar/restaurar (${processes.length} procesos)`);
} finally {
  bridge.kill();
  fixture.kill();
}
