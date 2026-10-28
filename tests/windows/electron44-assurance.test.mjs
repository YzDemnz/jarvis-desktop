import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { createHash, randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { _electron as electron } from 'playwright';

// Native assurance only. No model, paid API, owner vault or owner profile is used.
// This driver deliberately retains its isolated profile and every failed attempt.
const repo = process.cwd(), packaged = Boolean(process.env.JARVIS_EXE);
const external = value => path.resolve(value).toLowerCase().startsWith('e:\\codex\\');
assert.ok(external(repo) && external(os.tmpdir()), 'Source and TEMP must remain under E:\\CODEX');
const backup = path.resolve(process.env.JARVIS_ASSURANCE_BACKUP ?? 'E:/CODEX/Historial/Workflow-JARVIS-20261007/Perfil-antes-de-0.4.1/fabric.sqlite');
assert.ok(external(backup) && fs.existsSync(backup), 'A consistent recovered SQLite backup on the external disk is required');
const evidence = path.resolve(process.env.JARVIS_ASSURANCE_EVIDENCE ?? `docs/evidence/electron44-20261011/assurance-${packaged ? 'packaged' : 'source'}`);
assert.ok(external(evidence)); fs.mkdirSync(evidence, { recursive: true });
const attempt = Date.now(), profile = fs.mkdtempSync(path.join(os.tmpdir(), 'jarvis-fabric-native-electron44-'));
const database = path.join(profile, 'intelligence-fabric', 'fabric.sqlite'), work = fs.mkdtempSync(path.join(os.tmpdir(), 'jarvis-electron44-work-'));
fs.mkdirSync(path.dirname(database), { recursive: true });
fs.copyFileSync(backup, database); // SQLite-only recovery; no cookies, accounts, tokens or vault.
const backupHash = createHash('sha256').update(fs.readFileSync(backup)).digest('hex');
fs.writeFileSync(path.join(work, 'child.cjs'), 'setInterval(() => {}, 1000);\n');
fs.writeFileSync(path.join(work, 'parent.cjs'), "const fs=require('node:fs'),cp=require('node:child_process'),path=require('node:path');const c=cp.spawn(process.execPath,[path.join(__dirname,'child.cjs')],{stdio:'ignore',windowsHide:true});fs.writeFileSync(path.join(__dirname,'owned-pids.json'),JSON.stringify({parent:process.pid,child:c.pid}));setInterval(()=>{},1000);\n");
fs.writeFileSync(path.join(work, 'detached.cjs'), "const fs=require('node:fs'),cp=require('node:child_process'),path=require('node:path');const c=cp.spawn(process.execPath,[path.join(__dirname,'child.cjs')],{detached:true,stdio:'ignore',windowsHide:true});c.unref();fs.writeFileSync(path.join(__dirname,'detached-pids.json'),JSON.stringify({parent:process.pid,child:c.pid}));\n");
const env = { ...process.env, JARVIS_ALLOW_FIXTURES: '1', JARVIS_TEST_USER_DATA: profile,
  DOTNET_BUNDLE_EXTRACT_BASE_DIR: process.env.JARVIS_ASSURANCE_USE_DEPENDENCY_CACHE === '1' ? process.env.DOTNET_BUNDLE_EXTRACT_BASE_DIR : path.join(profile, 'dotnet-bundles'),
  JARVIS_RUNTIME_ROOT: path.join(profile, 'absent-runtimes'), JARVIS_BOOTSTRAP_ROOT: path.join(profile, 'absent-model'), OLLAMA_HOST: 'http://127.0.0.1:19877' };
delete env.ELECTRON_RUN_AS_NODE;
const exe = process.env.JARVIS_EXE ?? path.resolve('node_modules/electron/dist/electron.exe');
const expectedVersion = process.env.JARVIS_EXPECTED_VERSION ?? JSON.parse(fs.readFileSync(path.join(repo, 'package.json'), 'utf8')).version;
assert.ok(external(exe));
const checks = [], errors = [], trace = [], receipts = [];
let app, page, control, phase = 'launch', originalFingerprint, host, helper, browser, recovered, lastRun;
const pass = (name, data) => { checks.push({ name, state: 'VERIFIED', ...(data === undefined ? {} : { data }) }); console.log('PASS ' + name); };
const live = pid => { try { process.kill(pid, 0); return true; } catch { return false; } };
async function wait(predicate, timeout = 60000) {
  const end = Date.now() + timeout;
  while (!await predicate()) { if (Date.now() >= end) throw Error('Assurance wait timed out in ' + phase); await new Promise(resolve => setTimeout(resolve, 100)); }
}
async function launch() {
  app = await electron.launch({ executablePath: exe, args: packaged ? ['--disable-gpu'] : ['--disable-gpu',repo], env, timeout: 300000 });
  app.process().stderr?.on('data', chunk => trace.push(String(chunk).slice(0, 4000)));
  await app.evaluate(({app,BrowserWindow}, file) => {
    const fs=process.getBuiltinModule('fs'),record=(event,data)=>fs.appendFileSync(file,JSON.stringify({at:Date.now(),event,data})+'\n');
    const quit=app.quit.bind(app);app.quit=(...args)=>{record('quit-called',new Error().stack);return quit(...args);};
    for(const event of ['before-quit','will-quit','window-all-closed'])app.on(event,()=>record(event));
    app.on('child-process-gone',(_event,details)=>record('child-process-gone',details));
    process.on('uncaughtExceptionMonitor',error=>record('uncaught-exception',String(error.stack)));
    process.on('exit',code=>record('process-exit',code));
    for(const win of BrowserWindow.getAllWindows())win.on('close',()=>record('window-close',{id:win.id}));
  },path.join(evidence,`lifecycle-${attempt}.jsonl`));
  page = await app.firstWindow(); page.setDefaultTimeout(60000); page.on('pageerror', error => errors.push(String(error)));
  await app.evaluate(() => {
    globalThis.__e44HelperTrace = [];
    const seen = new WeakSet(), record = value => { if (globalThis.__e44HelperTrace.length < 400) globalThis.__e44HelperTrace.push({at: Date.now(), ...value}); };
    const inspect = () => {
      for (const child of process._getActiveHandles()) {
        if (!child.spawnfile?.endsWith('jarvis-automation-helper.exe') || seen.has(child)) continue;
        seen.add(child); record({kind: 'child', pid: child.pid});
        child.on('exit', (code, signal) => record({kind: 'exit', pid: child.pid, code, signal}));
        child.stderr.on('data', text => record({kind: 'stderr', text: String(text).slice(0, 3000)}));
        const kill = child.kill;
        child.kill = function(...args) { record({kind: 'kill', pid: child.pid, stack: new Error().stack}); return kill.apply(this, args); };
      }
    };
    inspect(); const timer = setInterval(inspect, 100); timer.unref();
  });
  await page.getByRole('button', { name: 'Home', exact: true }).waitFor();
  // Renderer onboarding preference is a fixture only; main authority remains authoritative.
  await page.evaluate(() => localStorage.setItem('jarvis.firstRun', JSON.stringify({ completed: true, version: 1, permissionPreset: 'FULL', sessionPolicy: 'keep', localAIChoice: 'skipped', fingerprint: null })));
  await page.reload(); await page.getByRole('button', { name: 'Home', exact: true }).waitFor();
}
async function fingerprint() {
  return app.evaluate(({ app }, { backup, database }) => {
    const require = process.getBuiltinModule('module').createRequire(app.getAppPath() + '/package.json');
    const Database = require('better-sqlite3'), crypto = require('node:crypto'), fs = require('node:fs'), path = require('node:path');
    const moduleFile = require.resolve('better-sqlite3'), moduleRoot = path.dirname(path.dirname(moduleFile));
    const bindingFile = require(path.join(moduleRoot, 'lib', 'binding.js')).getPrebuildPath();
    const physicalBinding = app.isPackaged ? bindingFile.replace(app.getAppPath() + path.sep, app.getAppPath() + '.unpacked' + path.sep) : bindingFile;
    const binding = { moduleFile, logicalPath: bindingFile, physicalPath: physicalBinding,
      physicalExists: fs.existsSync(physicalBinding), sha256: fs.existsSync(physicalBinding) ? crypto.createHash('sha256').update(fs.readFileSync(physicalBinding)).digest('hex') : null,
      packageVersion: require('better-sqlite3/package.json').version, runtimeNodeApi: process.versions.napi };
    const source = new Database(backup, { readonly: true, fileMustExist: true }), current = new Database(database, { readonly: true, fileMustExist: true });
    try {
      const tables = [['conversations', 'id'], ['messages', 'message_id'], ['task_states', 'task_id']];
      const digest = rows => crypto.createHash('sha256').update(JSON.stringify(rows)).digest('hex');
      const retained = tables.map(([table, key]) => {
        const before = source.prepare(`SELECT * FROM ${table} ORDER BY ${key}`).all();
        const after = before.map(row => current.prepare(`SELECT * FROM ${table} WHERE ${key}=?`).get(row[key]));
        return { table, sourceRows: before.length, retainedRows: after.filter(Boolean).length, sourceHash: digest(before), recoveredHash: digest(after) };
      });
      return { version: current.pragma('user_version', { simple: true }), integrity: current.pragma('integrity_check', { simple: true }), sqliteVersion: current.prepare('SELECT sqlite_version() AS version').get().version,
        retained, nativeAbi: process.versions.modules, binding };
    } finally { source.close(); current.close(); }
  }, { backup, database });
}
async function mode(value) {
  // This exercises production native MenuItem callback. It is not an OS menu click.
  await app.evaluate(({ Menu }, value) => Menu.getApplicationMenu().getMenuItemById('access-' + value).click(), value);
  await page.waitForFunction(async value => (await window.jarvis.authority.snapshot()).accessMode === value, value);
}
async function consoleView() {
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByRole('button', { name: 'Desarrollo', exact: true }).click();
  await page.getByTestId('native-console').waitFor();
}
async function execute(executable, args, settle = true) {
  await page.getByLabel('Ejecutable nativo', { exact: true }).fill(executable);
  await page.getByLabel('Directorio nativo', { exact: true }).fill(work);
  await page.getByLabel('Argumentos nativos', { exact: true }).fill(JSON.stringify(args));
  await page.getByLabel('Ejecutar nativo', { exact: true }).click();
  await page.waitForFunction(previous => document.querySelector('[data-testid="native-run-id"]')?.textContent && document.querySelector('[data-testid="native-run-id"]')?.textContent !== previous, lastRun ?? '');
  lastRun = await page.getByTestId('native-run-id').innerText();
  if (!settle) return lastRun;
  await page.waitForFunction(() => document.querySelector('[data-testid="native-output"]')?.textContent?.trim(), null, { timeout: 60000 });
  const result = JSON.parse(await page.getByTestId('native-output').innerText()); receipts.push({ runId: lastRun, result }); return result;
}
let serverRequests = 0;
const server = http.createServer((_request, response) => { serverRequests++; response.end('<html><head><title>Electron44 owned page</title></head><body>ASSURANCE_LOOPBACK</body></html>'); });
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const url = 'http://127.0.0.1:' + server.address().port;
try {
  await launch(); phase = 'host-and-preload';
  host = await app.evaluate(({ app, BrowserWindow }) => {
    const shell = BrowserWindow.getAllWindows()[0], prefs = shell.webContents.getLastWebPreferences();
    const fs = process.getBuiltinModule('fs'), path = process.getBuiltinModule('path'), crypto = process.getBuiltinModule('crypto');
    // Electron44's internal preference projection does not expose preload path.
    // Assert the product file plus the actual bridge/private gesture behavior.
    const preload = path.join(app.getAppPath(), 'dist-electron', 'preload.cjs');
    return { version: app.getVersion(), packaged: app.isPackaged, userData: app.getPath('userData'), appPath: app.getAppPath(), resourcesPath: process.resourcesPath,
      mainPid: process.pid, electron: process.versions.electron, node: process.versions.node, abi: process.versions.modules, uiGraphics: app.getGPUFeatureStatus(), networkSandboxDisabled: app.commandLine.getSwitchValue('disable-features').split(',').includes('NetworkServiceSandbox'),
      compiledMainSha256: crypto.createHash('sha256').update(fs.readFileSync(path.join(app.getAppPath(),'dist-electron/main.js'))).digest('hex'),
      preloadFile: { path: preload, exists: fs.existsSync(preload), sha256: crypto.createHash('sha256').update(fs.readFileSync(preload)).digest('hex') },
      security: { contextIsolation: prefs.contextIsolation, sandbox: prefs.sandbox, nodeIntegration: prefs.nodeIntegration, webviewTag: prefs.webviewTag } };
  });
  assert.match(host.electron, /^44\./); assert.equal(host.version, expectedVersion); assert.equal(path.resolve(host.userData), profile); assert.equal(host.packaged, packaged);
  assert.deepEqual(host.security, { contextIsolation: true, sandbox: true, nodeIntegration: false, webviewTag: false });
  assert.equal(host.preloadFile.exists, true); assert.match(host.preloadFile.path, /preload\.cjs$/);
  const surface = await page.evaluate(async () => ({ nodeRequire: typeof window.require, nodeProcess: typeof window.process, publicIpc: typeof window.ipcRenderer,
    capture: typeof window.jarvis.authority.capture, bridgeVersion: await window.jarvis.app.version(), platform: await window.jarvis.app.platform() }));
  assert.equal(surface.nodeRequire, 'undefined'); assert.equal(surface.nodeProcess, 'undefined'); assert.equal(surface.publicIpc, 'undefined'); assert.equal(surface.capture, 'undefined');
  assert.equal(surface.bridgeVersion, host.version); assert.equal(surface.platform, 'win32');
  pass('ESM main starts on Electron44; sandboxed CJS preload and narrow bridge work', { host, surface });

  phase = 'recovered-sqlite'; recovered = await fingerprint();
  assert.equal(recovered.integrity, 'ok'); assert.equal(recovered.version, 4); assert.equal(recovered.nativeAbi, host.abi);
  for (const row of recovered.retained) { assert.equal(row.retainedRows, row.sourceRows); assert.equal(row.recoveredHash, row.sourceHash); }
  originalFingerprint = recovered;
  pass('Actual native SQLite reads the recovered profile with unchanged historical rows', recovered);
  if (packaged) {
    assert.ok(recovered.binding.moduleFile.startsWith(host.appPath + path.sep)); assert.equal(recovered.binding.physicalExists, true);
    assert.ok(recovered.binding.physicalPath.startsWith(host.appPath + '.unpacked' + path.sep));
    const sourceBinary = path.join(repo, 'node_modules', 'better-sqlite3', 'prebuilds', 'win32-x64.node');
    assert.equal(recovered.binding.sha256, createHash('sha256').update(fs.readFileSync(sourceBinary)).digest('hex'));
    pass('Packaged Node-API SQLite loads from unpacked ASAR and matches the validated source binary', recovered.binding);
  }

  phase = 'sender-refusal';
  const forged = await page.evaluate(async () => { try { await window.jarvis.authority.begin('forged-assurance', 'forged model prompt'); return 'ALLOWED'; } catch (error) { return String(error); } });
  assert.match(forged, /ORIGINAL_INPUT_GESTURE_REQUIRED/);
  const synthetic = await page.evaluate(async () => {
    const target = document.querySelector('[data-authority-home-send]'); target.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    try { await window.jarvis.authority.begin('synthetic-assurance', 'synthetic event'); return 'ALLOWED'; } catch (error) { return String(error); }
  });
  assert.match(synthetic, /ORIGINAL_INPUT_GESTURE_REQUIRED/);
  const foreign = await app.evaluate(async ({ app, BrowserWindow }) => {
    const preload = process.getBuiltinModule('path').join(app.getAppPath(), 'dist-electron', 'preload.cjs');
    const attacker = new BrowserWindow({ show: false, webPreferences: { preload, sandbox: true, contextIsolation: true, nodeIntegration: false } });
    try {
      await attacker.loadURL('data:text/html,<body>test-owned foreign sender</body>');
      return await attacker.webContents.executeJavaScript(`Promise.all([window.jarvis.authority.snapshot().then(()=>"ALLOWED",e=>String(e)),window.jarvis.fabric.quota("none",null,"REQUESTS").then(()=>"ALLOWED",e=>String(e))])`);
    } finally { attacker.destroy(); }
  });
  assert.match(foreign[0], /UNTRUSTED_AUTHORITY_SENDER/); assert.match(foreign[1], /Untrusted Fabric sender/);
  pass('Unadmitted input, synthetic gesture and foreign IPC sender are refused', { forged, synthetic, foreign, adversarialWindow: 'Test main creates a foreign window with production preload; production gates decide' });

  phase = 'real-home-gesture';
  const goal = 'Consulta la información del sistema desde Home';
  await page.locator('[data-authority-home-input]').fill(goal); await page.locator('[data-authority-home-send]').click();
  const expected = createHash('sha256').update(goal).digest('hex');
  await page.waitForFunction(async hash => (await window.jarvis.authority.snapshot()).run?.originalHash === hash, expected);
  const admission = await page.evaluate(() => window.jarvis.authority.snapshot());
  assert.equal(admission.run.source, 'USER_INPUT_GESTURE');
  await page.getByTestId('stop-agent').waitFor({ state: 'hidden', timeout: 180000 });
  pass('Trusted Home click admits the exact original input through the private preload channel', { originalHash: expected, source: admission.run.source });

  phase = 'native-managed-command'; await mode('FULL'); await consoleView();
  const successful = await execute(process.execPath, ['-e', "require('node:fs').writeFileSync('managed.txt','ELECTRON44_NATIVE_OK');console.log('ELECTRON44_NATIVE_OK')"]);
  assert.equal(successful.ok, true); assert.equal(successful.realm, 'FULL_NATIVE'); assert.equal(successful.status, 'SUCCESS'); assert.match(successful.data.stdout, /ELECTRON44_NATIVE_OK/);
  assert.equal(fs.readFileSync(path.join(work, 'managed.txt'), 'utf8'), 'ELECTRON44_NATIVE_OK');
  assert.ok(successful.evidence.some(row => row.source === 'MAIN_PROCESS'));
  const successRun = lastRun, persisted = await page.evaluate(id => window.jarvis.fabric.task(id), successRun);
  assert.ok(persisted.evidence.some(row => row.source === 'MAIN_PROCESS'));
  pass('Production process-host executes a real owned native command and persists main evidence', { runId: successRun, status: successful.status, evidence: successful.evidence });

  phase = 'restricted'; await mode('RESTRICTED');
  const denied = await execute(process.execPath, ['-e', "require('node:fs').writeFileSync('must-not-exist.txt','denied')"]);
  assert.equal(denied.ok, false); assert.equal(fs.existsSync(path.join(work, 'must-not-exist.txt')), false);
  const lie = await page.evaluate(async ({ id, work }) => window.jarvis.devTools['terminal.execute']('ADMIN', id, { cwd: work, executable: 'cmd.exe', args: ['/d', '/c', 'echo forged'] }), { id: lastRun, work });
  assert.equal(lie.ok, false);
  pass('Native RESTRICTED mode rejects writes and renderer ADMIN claims', { denied: denied.status ?? denied.error, forged: lie.error, modeInput: 'Production MenuItem callback driven by main test harness; no renderer policy grant' });

  phase = 'native-stop-tree'; await mode('FULL');
  control = spawn(process.execPath, [path.join(work, 'child.cjs')], { stdio: 'ignore', windowsHide: true });
  await execute(process.execPath, [path.join(work, 'parent.cjs')], false);
  await wait(() => fs.existsSync(path.join(work, 'owned-pids.json')));
  const owned = JSON.parse(fs.readFileSync(path.join(work, 'owned-pids.json'))); assert.ok(live(owned.parent) && live(owned.child) && live(control.pid));
  await page.getByLabel('STOP nativo', { exact: true }).click();
  await wait(() => !live(owned.parent) && !live(owned.child)); assert.ok(live(control.pid));
  await page.waitForFunction(() => document.querySelector('[data-testid="native-output"]')?.textContent?.includes('CANCELLED'));
  const stopped = JSON.parse(await page.getByTestId('native-output').innerText()); receipts.push({ runId: lastRun, result: stopped }); assert.equal(stopped.status, 'CANCELLED');
  pass('STOP terminates owned parent and child; unrelated test control process survives', { owned, controlPid: control.pid, status: stopped.status });
  const afterStop = await execute('cmd.exe', ['/d', '/c', 'echo AFTER_STOP_E44']); assert.equal(afterStop.status, 'SUCCESS');
  pass('A new user admission works after STOP');

  phase = 'detached-stop'; await execute(process.execPath, [path.join(work, 'detached.cjs')], false);
  await wait(() => fs.existsSync(path.join(work, 'detached-pids.json')));
  const detached = JSON.parse(fs.readFileSync(path.join(work, 'detached-pids.json'))); await wait(() => !live(detached.parent)); assert.ok(live(detached.child));
  await page.getByLabel('STOP nativo', { exact: true }).click(); await wait(() => !live(detached.child)); assert.ok(live(control.pid));
  await page.waitForFunction(() => !document.querySelector('[data-native-execute]')?.disabled);
  pass('Windows Job retains and stops detached child after its parent exits', detached);

  phase = 'native-automation-helper';
  const helperAdmission = await execute('cmd.exe', ['/d', '/c', 'echo HELPER_ADMISSION_E44']); assert.equal(helperAdmission.status, 'SUCCESS');
  await page.evaluate(id => window.jarvis.desktop.bindRun(id), lastRun);
  await page.waitForFunction(async () => (await window.jarvis.desktop.status()).helperAvailable === true, null, { timeout: 120000 });
  const ownedWindow = await app.evaluate(({BrowserWindow}) => {
    const win = BrowserWindow.getAllWindows()[0];
    const before = {visible: win.isVisible(), minimized: win.isMinimized()};
    win.restore(); win.show();
    return {before, after: {visible: win.isVisible(), minimized: win.isMinimized()}, handle: win.getNativeWindowHandle().toString('hex')};
  });
  let windows;const enumerationAttempts=[];
  await wait(async()=>{
    windows=await page.evaluate(id=>window.jarvis.desktopTools['window.list']('FULL',id,{}),lastRun);
    const status=await page.evaluate(()=>window.jarvis.desktop.status());
    enumerationAttempts.push({at:Date.now(),available:status.helperAvailable,ok:windows.ok,count:windows.data?.length??null,ownWindow:windows.data?.some(window=>window.processId===host.mainPid)??false});
    return status.helperAvailable&&windows.ok&&windows.data.some(window=>window.processId===host.mainPid);
  },30000);
  helper = {status: await page.evaluate(() => window.jarvis.desktop.status()), ownedWindow,
    enumeration: {ok: windows.ok, count: windows.data?.length ?? null, processIds: windows.data?.map(window => window.processId) ?? []}};
  assert.equal(windows.ok, true); assert.ok(windows.data.some(window => window.processId === host.mainPid));
  helper = {...await page.evaluate(() => window.jarvis.desktop.status()),enumerationAttempts};
  const helperPaths = await app.evaluate(({ app }) => {
    const fs = process.getBuiltinModule('fs'), path = process.getBuiltinModule('path');
    const root = app.isPackaged ? path.join(process.resourcesPath, 'native') : null;
    return root ? ['jarvis-process-host.exe', 'jarvis-automation-helper.exe'].map(name => ({ name, exists: fs.existsSync(path.join(root, name)) })) : [];
  });
  if (packaged) for (const binary of helperPaths) assert.equal(binary.exists, true);
  pass(packaged ? 'Actual packaged helpers are present; automation handshake and Windows enumeration work' : 'Actual source automation helper handshake and Windows enumeration work', { helper, helperPaths, observedOwnWindow: true });

  phase = 'webcontents-isolation';
  await page.getByRole('button', { name: 'Browser', exact: true }).click();
  const tab = await page.evaluate(url => window.jarvis.browser.create(url, 'default', 'personal'), url);
  await wait(async () => app.evaluate(({ webContents }, url) => webContents.getAllWebContents().some(contents => contents.getURL().startsWith(url)), url));
  await wait(() => serverRequests > 0);
  browser = await app.evaluate(async ({ webContents }, url) => {
    const contents = webContents.getAllWebContents().find(contents => contents.getURL().startsWith(url));
    const preferences = contents.getLastWebPreferences();
    return { security: { sandbox: preferences.sandbox, contextIsolation: preferences.contextIsolation, nodeIntegration: preferences.nodeIntegration, preload: preferences.preload || null },
      globals: await contents.executeJavaScript('({jarvis:typeof window.jarvis,require:typeof window.require,process:typeof window.process})'), text: await contents.executeJavaScript('document.body.innerText') };
  }, url);
  assert.deepEqual(browser.security, { sandbox: true, contextIsolation: true, nodeIntegration: false, preload: null });
  assert.deepEqual(browser.globals, { jarvis: 'undefined', require: 'undefined', process: 'undefined' }); assert.match(browser.text, /ASSURANCE_LOOPBACK/);
  const second = url + '/second'; await page.evaluate(({ id, url }) => window.jarvis.browser.navigate(id, url), { id: tab.activeId, url: second });
  await wait(async () => app.evaluate(({ webContents }, url) => webContents.getAllWebContents().some(contents => contents.getURL() === url), second));
  const navigation = await page.evaluate(() => window.jarvis.browser.snapshot()); assert.equal(navigation.tabs.find(value => value.id === navigation.activeId).canGoBack, true);
  await page.evaluate(id => window.jarvis.browser.back(id), tab.activeId);
  await wait(async () => app.evaluate(({ webContents }, url) => webContents.getAllWebContents().some(contents => contents.getURL() === url + '/'), url));
  await page.evaluate(id => window.jarvis.browser.forward(id), tab.activeId);
  await wait(async () => app.evaluate(({ webContents }, url) => webContents.getAllWebContents().some(contents => contents.getURL() === url), second));
  await page.getByRole('button', { name: 'Menú', exact: true }).click();
  await wait(async () => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].contentView.children.length === 0));
  await page.keyboard.press('Escape');
  await wait(async () => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].contentView.children.length === 1));
  await page.evaluate(id => window.jarvis.browser.close(id), tab.activeId);
  pass('WebContentsView displays isolated loopback content; back/forward and overlay detach/reattach work', browser);

  phase = 'sqlite-write-and-restart';
  const conversationId = 'electron44-assurance-' + randomUUID(), messageId = randomUUID();
  const message = { conversationId, messageId, parentId: null, role: 'user', content: 'E44 owned persistence marker', timestamp: Date.now(), providerId: null, modelId: null, channel: 'assurance', taskId: null, tools: [], artifacts: [], usageIds: [], contextRefs: [], routingDecisionId: null };
  assert.equal(await page.evaluate(value => window.jarvis.fabric.appendMessage(value), message), true);
  await mode('RESTRICTED'); await app.close(); app = null; await launch();
  assert.equal((await page.evaluate(() => window.jarvis.authority.snapshot())).accessMode, 'RESTRICTED');
  const replay = await page.evaluate(id => window.jarvis.fabric.messagePage(id, 10), conversationId);
  assert.equal(replay.length, 1); assert.equal(replay[0].message.messageId, messageId); assert.equal(replay[0].message.content, message.content);
  const savedTask = await page.evaluate(id => window.jarvis.fabric.task(id), successRun); assert.ok(savedTask.evidence.some(row => row.source === 'MAIN_PROCESS'));
  const snapshot = await page.evaluate(() => window.jarvis.authority.snapshot()); assert.equal(snapshot.activeRun, '');
  assert.equal((await page.evaluate(() => window.jarvis.dev.commands())).length, 0); assert.equal((await page.evaluate(() => window.jarvis.bootstrap.diagnostics())).pid, null);
  const after = await fingerprint(); assert.equal(after.integrity, 'ok'); for (const row of after.retained) assert.equal(row.recoveredHash, row.sourceHash);
  assert.equal(createHash('sha256').update(fs.readFileSync(backup)).digest('hex'), backupHash);
  pass('Recovered historical rows, new SQLite message, main receipt and RESTRICTED policy survive restart without execution replay', { after, activeRun: snapshot.activeRun, messages: replay.length });
  await consoleView(); await page.screenshot({ path: path.join(evidence, `assurance-${attempt}.png`) });
  const result = { status: 'PASS', date: new Intl.DateTimeFormat('en-CA', {timeZone: 'America/Mexico_City'}).format(new Date()),
    at: new Date().toISOString(), attempt, packaged, host, profile, work, backup, backupHash, originalFingerprint,
    checks, errors, receipts, browser, helper, helperLifecycle: await app.evaluate(() => globalThis.__e44HelperTrace),
    paidCalls: 0, modelCalls: 0, ownerProfileTouched: false,
    scope: 'Native migration assurance, recovered SQLite rows, isolated profile, real commands/process trees/helpers and loopback browser. Native menu callback driven by main harness; no claim of manual Windows menu interaction or model quality.' };
  fs.writeFileSync(path.join(evidence, `result-${attempt}.json`), JSON.stringify(result, null, 2)); fs.writeFileSync(path.join(evidence, 'result.json'), JSON.stringify(result, null, 2));
  console.log('ELECTRON44_ASSURANCE_PASS ' + checks.length);
} catch (error) {
  const failure = { status: 'FAIL', phase, attempt, packaged, error: String(error), profile, host, checks, errors, receipts, trace,
    authority: page ? await page.evaluate(() => window.jarvis.authority.snapshot()).catch(() => null) : null,
    helper, helperLifecycle: app ? await app.evaluate(() => globalThis.__e44HelperTrace).catch(() => null) : null,
    ownedConsole: page ? await page.getByTestId('native-output').innerText({ timeout: 1000 }).catch(() => null) : null };
  fs.writeFileSync(path.join(evidence, `failure-${attempt}.json`), JSON.stringify(failure, null, 2)); throw error;
} finally {
  if (app) { try { await page?.evaluate(() => window.jarvis.authority.stop()); } catch {} await app.close().catch(() => {}); }
  if (control && live(control.pid)) control.kill();
  await new Promise(resolve => server.close(resolve));
}
