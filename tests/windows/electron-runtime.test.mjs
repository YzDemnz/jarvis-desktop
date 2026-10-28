import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { _electron as electron } from 'playwright';

const executablePath = process.env.JARVIS_EXE ?? path.resolve('release/win-unpacked/JARVIS.exe');
const fixtureProject = path.resolve('tests/windows/fixture/JarvisNativeTestFixture.csproj');
const build = spawnSync('dotnet', ['publish', fixtureProject, '-c', 'Release', '-r', 'win-x64', '--self-contained', 'true', '--nologo'], { encoding: 'utf8', timeout: 120000, windowsHide: true });
assert.equal(build.status, 0, build.stderr || build.stdout);
const fixture = spawn(path.resolve('tests/windows/fixture/bin/Release/net8.0-windows/win-x64/publish/JarvisNativeTestFixture.exe'), [], { windowsHide: false, shell: false, stdio: 'ignore' });
let app;

try {
  app = await electron.launch({ executablePath });
  const shell = await app.firstWindow();
  shell.on('close', () => console.log('ELECTRON SHELL CLOSED'));
  shell.on('crash', () => console.log('ELECTRON SHELL CRASHED'));
  shell.on('pageerror', (error) => console.log('ELECTRON PAGE ERROR', error.message));
  await shell.getByRole('button', { name: 'Home', exact: true }).waitFor({ state: 'visible', timeout: 15_000 });
  const bridge = await shell.evaluate(async () => ({
    platform: await window.jarvis?.app.platform(),
    version: await window.jarvis?.app.version(),
  }));
  assert.equal(bridge.platform, 'win32');
  assert.equal(bridge.version, JSON.parse(fs.readFileSync(path.resolve('package.json'), 'utf8')).version);
  console.log('CHECKPOINT bridge');

  const nativeState = await shell.evaluate(async () => ({
    machine: await window.jarvis.machine.profile(true),
    ollama: await window.jarvis.agent.ollamaHealth(true),
  }));
  assert.equal(nativeState.machine.profile.source, 'windows');
  assert.ok(nativeState.machine.profile.cpu.model?.includes('i5-10400F'));
  assert.equal(nativeState.machine.profile.gpus.find((gpu) => gpu.model?.includes('RX 6600'))?.vramBytes, null,
    'El valor saturado de AdapterRAM no debe presentarse como VRAM real.');
  assert.equal(nativeState.ollama.online, true);
  assert.ok(nativeState.ollama.models.some((model) => model.name === 'qwen2.5:3b-instruct'));
  const readOnlyTools = await shell.evaluate(async () => ({
    drives: await window.jarvis.agent.fsGetDrives('OBSERVE'),
    apps: await window.jarvis.agent.appList('OBSERVE', 'Visual Studio Code'),
    system: await window.jarvis.agent.systemInfo('OBSERVE'),
    processes: await window.jarvis.agent.processList('OBSERVE'),
  }));
  assert.ok(readOnlyTools.drives.ok && readOnlyTools.drives.data.length >= 2);
  assert.ok(readOnlyTools.apps.ok && readOnlyTools.apps.data.length >= 1);
  assert.ok(readOnlyTools.system.ok && readOnlyTools.system.data);
  assert.ok(readOnlyTools.processes.ok && readOnlyTools.processes.data.length >= 1);
  console.log('CHECKPOINT machine/ollama/tools');

  await shell.getByRole('button', { name: 'Settings', exact: true }).click({ force: true });
  await shell.getByRole('button', { name: 'Desarrollo', exact: true }).click({ force: true });
  console.log('CHECKPOINT Settings Desarrollo');
  const inspector = shell.getByTestId('ui-inspector');
  const fixtureOption = inspector.locator('option').filter({ hasText: /JarvisNativeTestFixture\.exe/i }).first();
  await fixtureOption.waitFor({ state: 'attached', timeout: 15_000 }).catch(async () => {
    console.log('INSPECTOR VENTANAS', (await shell.locator('body').innerText({ timeout: 1000 }).catch(() => 'NO BODY')).slice(-1500), await inspector.locator('option').allTextContents().catch(() => []));
  });
  assert.ok(await fixtureOption.count(), 'La ventana aislada aparece en el inspector real.');
  await inspector.getByTestId('inspector-window').selectOption(await fixtureOption.getAttribute('value'));
  await shell.waitForFunction(() => document.querySelectorAll('[data-testid^="inspector-node-"]').length > 10, null, { timeout: 30_000 }).catch(() => {});
  const inspectorNodes = await inspector.locator('[data-testid^="inspector-node-"]').count();
  if (inspectorNodes <= 10) console.log('INSPECTOR DIAGNÓSTICO', await inspector.innerText());
  assert.ok(inspectorNodes > 10, 'El inspector UIA real entrega el árbol de la ventana aislada.');

  const initial = await shell.evaluate(() => window.jarvis.browser.snapshot());
  await shell.getByRole('button', { name: 'Browser', exact: true }).click();
  const created = await shell.evaluate(() => window.jarvis.browser.create('https://example.com', 'personal'));
  assert.equal(created.tabs.length, initial.tabs.length + 1);
  await shell.waitForTimeout(1500);

  let views = [];
  for (let i = 0; i < 30; i++) {
    views = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().flatMap((win) =>
      win.contentView.children.map((view) => ({ bounds: view.getBounds(), url: view.webContents?.getURL() ?? null }))));
    if (views.some((view) => view.url?.startsWith('https://example.com'))) break;
    await shell.waitForTimeout(500);
  }
  const remote = views.find((view) => view.url?.startsWith('https://example.com'));
  if (!remote) {
    console.log('DIAGNÓSTICO', JSON.stringify({
      views,
      shell: await shell.evaluate(async () => ({
        browserText: document.body.innerText.includes('Example Domain'),
        visibleText: document.body.innerText.slice(0, 500),
        tabs: await window.jarvis.browser.snapshot(),
      })),
    }, null, 2));
  }
  assert.ok(remote, 'WebContentsView attached to BrowserWindow');
  assert.ok(remote.bounds.width > 300 && remote.bounds.height > 300, 'Native view follows React viewport');

  const content = await app.evaluate(async ({ webContents }) => {
    const page = webContents.getAllWebContents().find((wc) => wc.getURL().startsWith('https://example.com'));
    if (!page) return null;
    return {
      url: page.getURL(),
      text: await page.executeJavaScript('document.body.innerText'),
      imageBytes: (await page.capturePage()).toPNG().length,
    };
  });
  assert.ok(content?.text.includes('Example Domain'));
  assert.ok(content.imageBytes > 1000);

  await shell.getByRole('button', { name: 'Menú' }).click();
  assert.equal(await shell.getByPlaceholder('Busca, ordena o pregunta').isVisible(), true);
  const covered = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].contentView.children.length);
  assert.equal(covered, 0, 'La paleta desmonta WebContentsView y recibe los clics.');
  await shell.keyboard.press('Escape');
  await shell.waitForTimeout(100);
  const restored = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].contentView.children.length);
  assert.equal(restored, 1, 'WebContentsView vuelve tras cerrar overlay.');

  const forwarded = await app.evaluate(async ({ webContents }) => {
    const page = webContents.getAllWebContents().find((wc) => wc.getURL().startsWith('https://example.com'));
    page.focus();
    page.sendInputEvent({ type: 'keyDown', keyCode: 'l', modifiers: ['control'] });
    page.sendInputEvent({ type: 'keyUp', keyCode: 'l', modifiers: ['control'] });
    return true;
  });
  assert.equal(forwarded, true);
  await shell.waitForTimeout(100);
  assert.equal(await shell.evaluate(() => document.activeElement?.getAttribute('placeholder')),
    'Dirección, búsqueda u orden para JARVIS', 'Ctrl+L desde la página llega al shell');

  const tradingTab = await shell.evaluate(() => window.jarvis.browser.create('https://example.com', 'personal', 'trading'));
  assert.equal(tradingTab.tabs.find((tab) => tab.id === tradingTab.activeId)?.profileId, 'trading');
  await shell.waitForTimeout(900);

  const isolation = await app.evaluate(async ({ session, webContents }) => {
    const personal = session.fromPartition('persist:jarvis-personal');
    const trading = session.fromPartition('persist:jarvis-trading');
    const cookieName = 'jarvis-native-isolation-test';
    const storageKey = 'jarvis-native-isolation-test';
    const page = webContents.getAllWebContents().find((wc) => wc.session === personal && wc.getURL().startsWith('https://example.com'));
    const tradingPage = webContents.getAllWebContents().find((wc) => wc.session === trading && wc.getURL().startsWith('https://example.com'));
    try {
      await personal.cookies.set({ url: 'https://example.com', name: cookieName, value: 'personal' });
      await page.executeJavaScript(`localStorage.setItem('${storageKey}', 'personal')`);
      const tradingCookies = await trading.cookies.get({ url: 'https://example.com', name: cookieName });
      return {
        tradingCookies: tradingCookies.length,
        personalStorage: await page.executeJavaScript(`localStorage.getItem('${storageKey}')`),
        tradingStorage: await tradingPage.executeJavaScript(`localStorage.getItem('${storageKey}')`),
      };
    } finally {
      await personal.cookies.remove('https://example.com', cookieName);
      await page.executeJavaScript(`localStorage.removeItem('${storageKey}')`);
    }
  });
  assert.equal(isolation.tradingCookies, 0, 'Trading no recibe cookies de Personal.');
  assert.equal(isolation.personalStorage, 'personal');
  assert.equal(isolation.tradingStorage, null, 'Trading no recibe localStorage de Personal.');
  await shell.evaluate((id) => window.jarvis.browser.close(id), tradingTab.activeId);
  await shell.waitForTimeout(100);

  const beforeShortcutTab = await shell.evaluate(() => window.jarvis.browser.snapshot());
  await app.evaluate(({ webContents }) => {
    const page = webContents.getAllWebContents().find((wc) => wc.getURL().startsWith('https://example.com'));
    page.focus();
    page.sendInputEvent({ type: 'keyDown', keyCode: 't', modifiers: ['control'] });
    page.sendInputEvent({ type: 'keyUp', keyCode: 't', modifiers: ['control'] });
  });
  await shell.waitForTimeout(100);
  const afterShortcutTab = await shell.evaluate(() => window.jarvis.browser.snapshot());
  assert.equal(afterShortcutTab.tabs.length, beforeShortcutTab.tabs.length + 1, 'Ctrl+T desde la página crea pestaña.');
  await shell.evaluate((id) => window.jarvis.browser.close(id), afterShortcutTab.activeId);
  await shell.waitForTimeout(100);
  assert.equal((await shell.evaluate(() => window.jarvis.browser.snapshot())).tabs.length, beforeShortcutTab.tabs.length);

  console.log(JSON.stringify({ bridge: 'PASS', machine: {
    cpu: nativeState.machine.profile.cpu.model,
    ram: nativeState.machine.profile.memory.totalBytes,
    gpu: nativeState.machine.profile.gpus,
  }, ollama: { version: nativeState.ollama.version, models: nativeState.ollama.models.map((model) => model.name) },
  readOnlyTools: { drives: readOnlyTools.drives.data.length, apps: readOnlyTools.apps.data.length,
    processes: readOnlyTools.processes.data.length }, inspectorNodes, view: remote, content,
  overlays: 'PASS', shortcuts: 'PASS', profiles: 'PASS' }, null, 2));
  if (process.env.JARVIS_HOLD_MS) await shell.waitForTimeout(Number(process.env.JARVIS_HOLD_MS));
} finally {
  await app?.close();
  fixture.kill();
}
