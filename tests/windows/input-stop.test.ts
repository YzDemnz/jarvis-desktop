import assert from 'node:assert/strict';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { WindowsHelperBridge } from '../../electron/desktop/WindowsHelperBridge';
import type { AutomationElement } from '../../src/types';
import { fixtureWindow, launchNativeFixture } from './native-fixture';
import { waitForCursorStable } from './wait-for-cursor-stable';

const executable = path.resolve(
  'native/windows-helper/bin/Release/net8.0-windows/win-x64/publish/jarvis-automation-helper.exe',
);
const bridge = new WindowsHelperBridge({ executable, maxRestarts: 0 });
const fixture = launchNativeFixture();

async function findDocument(windowId: string): Promise<AutomationElement> {
  const root = await bridge.uiRoot(windowId);
  const queue = [{ element: root, depth: 0 }];
  while (queue.length) {
    const { element, depth } = queue.shift()!;
    if ((element.controlType === 'Document' || element.controlType === 'Edit') && element.patterns.includes('Value')) return element;
    if (depth < 6 && element.childCount > 0) {
      const children = await bridge.uiChildren(element.id);
      queue.push(...children.map((child) => ({ element: child, depth: depth + 1 })));
    }
  }
  throw new Error('El editor de Bloc de notas no expone Value.');
}

try {
  assert.equal(await bridge.start(), true);
  const ownWindow = await fixtureWindow(bridge);
  const editor = await findDocument(ownWindow.windowId);
  assert.equal((await bridge.uiElement(editor.id))?.value, 'Prueba JARVIS Windows: áéíóú ñ',
    'El editor activo debe contener sólo la frase de prueba antes de reemplazarla.');
  await bridge.uiSetValue(editor.id, '');
  await bridge.uiFocus(editor.id);

  const controller = new AbortController();
  const longText = 'JARVIS-STOP-PRUEBA '.repeat(120);
  const typing = bridge.typeText(longText, controller.signal);
  await delay(120);
  controller.abort();
  const typingStopped = assert.rejects(typing, /cancelad/i);
  await bridge.quiesceInput();
  await typingStopped;

  const first = (await bridge.uiElement(editor.id))?.value ?? '';
  await delay(350);
  const later = (await bridge.uiElement(editor.id))?.value ?? '';
  assert.ok(first.length < longText.length, 'STOP cortó la secuencia antes del final.');
  assert.equal(later, first, 'No hubo caracteres pendientes después de STOP.');
  await bridge.uiSetValue(editor.id, 'Prueba JARVIS Windows: áéíóú ñ');
  console.log(`PASS STOP nativo: ${first.length}/${longText.length} caracteres antes de cancelar; sin residuo`);

  const dragController = new AbortController();
  const from = { x: ownWindow.bounds.x + 400, y: ownWindow.bounds.y + 300 };
  const to = { x: from.x + 300, y: from.y };
  console.log('INPUT_DIAGNOSTIC ' + JSON.stringify({ phase: 'before-drag', from, to, window: ownWindow.bounds, monitors: await bridge.monitors(), cursor: await bridge.cursor() }));
  const dragging = bridge.mouseDrag(from, to, 4000, dragController.signal);
  await delay(180);
  dragController.abort();
  const draggingStopped = assert.rejects(dragging, /cancelad/i);
  await bridge.quiesceInput();
  await draggingStopped;
  const injected = await bridge.send<any>('inputState', {});
  console.log('INPUT_DIAGNOSTIC ' + JSON.stringify({ phase: 'helper-after-stop', injected }));
  assert.equal(injected.active, false);
  assert.equal(injected.cancelled, true);
  assert.ok(injected.injectedSteps > 0 && injected.injectedSteps < 251);
  assert.ok(injected.lastInjected.x >= from.x && injected.lastInjected.x < to.x);
  await delay(250);
  assert.deepEqual(await bridge.send('inputState', {}), injected, 'El helper no emite más movimientos después de completar STOP.');
  const stoppedAt = await waitForCursorStable(() => bridge.cursor(), 5000, 5, 100, 2);
  await delay(250);
  const laterCursor = await bridge.cursor();
  console.log('INPUT_DIAGNOSTIC ' + JSON.stringify({ phase: 'after-stop', from, to, stoppedAt, laterCursor }));
  assert.ok(Math.abs(laterCursor.x - stoppedAt.x) <= 2 && Math.abs(laterCursor.y - stoppedAt.y) <= 2,
    'El cursor no sigue moviéndose tras STOP.');
  assert.ok(stoppedAt.x >= from.x - 2 && stoppedAt.x < to.x && Math.abs(stoppedAt.y - from.y) <= 2,
    'Cursor fuera de la trayectoria: interferencia externa o fallo de síntesis; no PASS artificial.');
  console.log('PASS STOP nativo: arrastre detenido y cursor estable');
} finally {
  bridge.kill();
  fixture.kill();
}
