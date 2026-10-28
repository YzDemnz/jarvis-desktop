import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { spawn, execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { _electron as electron } from 'playwright';

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'jarvis-fabric-native-s2-'));
const profile = path.join(temp, 'jarvis-fabric-native-profile');
const work = path.join(temp, 'unregistered-work');
const fixtureAppData = path.join(temp, 'appdata');
fs.mkdirSync(work);
fs.writeFileSync(path.join(work, 'child.js'), 'setInterval(() => {}, 1000);');
const shortcut = path.join(fixtureAppData, 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'S2 Owned Fixture.lnk');
fs.mkdirSync(path.dirname(shortcut), { recursive: true });
const psLiteral = text => "'" + text.replaceAll("'", "''") + "'";
execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
  '$s=(New-Object -ComObject WScript.Shell).CreateShortcut(' + psLiteral(shortcut) + ');$s.TargetPath=' + psLiteral(process.execPath) + ';$s.Arguments=' + psLiteral('"' + path.join(work, 'child.js') + '"') + ';$s.WorkingDirectory=' + psLiteral(work) + ';$s.Save()'], { windowsHide: true, timeout: 15000 });
const evidence = path.resolve(process.env.JARVIS_S2_EVIDENCE_DIR ?? 'docs/evidence/s2/iteration-native');
fs.mkdirSync(evidence, { recursive: true });
const executablePath = process.env.JARVIS_EXE ?? path.resolve('release/win-unpacked/JARVIS.exe');
const checks = [];
const passed = name => { checks.push({ name, status: 'PASS' }); console.log('PASS ' + name); };
const wait = async (fn, ms = 20000) => { const end = Date.now() + ms; while (!fn()) { if (Date.now() > end) throw Error('Fixture wait timed out'); await new Promise(r => setTimeout(r, 100)); } };
let app, page, foreign;
let requests = 0;
const requestDetails = [];
const server = http.createServer((req, res) => {
  requests++; requestDetails.push({ url: req.url, method: req.method });
  if (req.url === '/redirect-entry') { res.writeHead(307, { Location: '/redirect-target' }); res.end(); return; }
  if (req.url === '/frames-entry') { res.end('<html><title>S2 frames</title><iframe src="/frame-target"></iframe><script>fetch("/xhr-resource")</script></html>'); return; }
  if (req.url === '/post-entry') { res.end('<html><title>S2 post</title><form method="POST" action="/post-target"><input name="fixture" value="synthetic"></form></html>'); return; }
  res.end('<html><title>S2 owned page</title><body>owned fixture</body></html>');
});
await new Promise(resolve => server.listen(0, '127.0.0.2', resolve));
const externalFixture = 'http://127.0.0.2:' + server.address().port + '/original';
const live = pid => { try { process.kill(pid, 0); return true; } catch { return false; } };
async function waitPage(url, expression = 'document.readyState !== "loading"') {
  for (let n = 0; n < 200; n++) {
    const ready = await app.evaluate(async ({ webContents }, { url, expression }) => {
      const w = webContents.getAllWebContents().find(w => w.getURL() === url);
      return w ? w.executeJavaScript(expression).catch(() => false) : false;
    }, { url, expression });
    if (ready) return;
    await new Promise(resolve => setTimeout(resolve, 25));
  }
  throw Error('Own fixture page did not commit: ' + url);
}
async function mode(value) {
  // Test drives the same native MenuItem callback; not a renderer grant or a human OS menu click.
  await app.evaluate(({ Menu }, value) => Menu.getApplicationMenu().getMenuItemById('access-' + value).click(), value);
  await page.waitForFunction(async v => (await window.jarvis.authority.snapshot()).accessMode === v, value);
}
async function consoleView() {
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByRole('button', { name: 'Desarrollo', exact: true }).click();
  await page.getByTestId('native-console').waitFor();
}
async function execute(file, args, settle = true) {
  await page.getByLabel('Ejecutable nativo', { exact: true }).fill(file);
  await page.getByLabel('Directorio nativo', { exact: true }).fill(work);
  await page.getByLabel('Argumentos nativos', { exact: true }).fill(JSON.stringify(args));
  await page.getByLabel('Ejecutar nativo', { exact: true }).click();
  if (settle) {
    await page.waitForFunction(() => document.querySelector('[data-testid="native-output"]')?.textContent?.trim(), null, { timeout: 30000 });
    return JSON.parse(await page.getByTestId('native-output').innerText());
  }
}
try {
  app = await electron.launch({ executablePath, env: { ...process.env, APPDATA: fixtureAppData, JARVIS_ALLOW_FIXTURES: '1', JARVIS_TEST_USER_DATA: profile }, timeout: 60000 });
  page = await app.firstWindow();
  await page.getByRole('button', { name: 'Home', exact: true }).waitFor({ timeout: 30000 });
  await page.evaluate(() => localStorage.setItem('jarvis.firstRun', JSON.stringify({ completed: true, version: 1, permissionPreset: 'ADMIN', sessionPolicy: 'keep', localAIChoice: 'skipped', fingerprint: null })));
  await page.reload(); await page.getByRole('button', { name: 'Home', exact: true }).waitFor();
  assert.equal((await page.evaluate(() => window.jarvis.authority.snapshot())).accessMode, 'FULL');
  passed('packaged main FULL default; legacy localStorage not authority');
  await app.evaluate(({ dialog }) => { globalThis.s2Dialogs = []; dialog.showMessageBox = async (...args) => { globalThis.s2Dialogs.push(args.at(-1).detail); return { response: 0, checkboxChecked: false }; }; });
  const forged = await page.evaluate(async () => { try { await window.jarvis.authority.begin('forged', 'model supplied input'); return 'ALLOWED'; } catch (e) { return String(e); } });
  assert.match(forged, /GESTURE_REQUIRED/);
  assert.equal(await page.evaluate(() => typeof window.jarvis.authority.capture), 'undefined');
  passed('public IPC cannot mint original user input; private capture not exposed');
  await consoleView();
  const native = await execute('powershell.exe', ['-NoProfile', '-Command', "Set-Content -LiteralPath 'native.txt' -Value 'S2_NATIVE_OK'; Get-Content -LiteralPath 'native.txt'"]);
  assert.equal(native.ok, true); assert.equal(native.realm, 'FULL_NATIVE'); assert.equal(native.status, 'SUCCESS');
  assert.match(native.data.stdout, /S2_NATIVE_OK/); assert.ok(fs.existsSync(path.join(work, 'native.txt')));
  assert.ok(native.evidence.some(e => e.source === 'MAIN_PROCESS' && /exit=0/.test(e.summary)));
  assert.equal(await app.evaluate(() => globalThis.s2Dialogs.length), 0);
  assert.equal((await page.evaluate(() => window.jarvis.dev.roots())).length, 0);
  passed('FULL user gesture to Native PowerShell outside project roots, real file and receipt, zero prompts');
  const id = await page.getByTestId('native-run-id').innerText();
  const handoff = await page.evaluate(id => window.jarvis.fabric.handoff(id, 2048), id);
  assert.ok(handoff.evidence.some(e => e.source === 'MAIN_PROCESS'));
  passed('Native receipt persisted in S1 task/handoff');
  await mode('RESTRICTED');
  const denied = await execute('powershell.exe', ['-NoProfile', '-Command', "Set-Content -LiteralPath 'denied.txt' -Value 'bad'"]);
  assert.equal(denied.ok, false); assert.equal(fs.existsSync(path.join(work, 'denied.txt')), false);
  const lie = await page.evaluate(async ({ id, cwd }) => window.jarvis.devTools['terminal.execute']('ADMIN', id, { cwd, executable: 'cmd.exe', args: ['/c', 'echo forged'] }), { id, cwd: work });
  assert.equal(lie.ok, false);
  passed('RESTRICTED blocks shell/write; renderer ADMIN claim does not grant FULL');
  await mode('FULL');
  fs.writeFileSync(path.join(work, 'child.js'), 'setInterval(() => {}, 1000);');
  fs.writeFileSync(path.join(work, 'parent.js'), "const fs=require('fs'),cp=require('child_process'),path=require('path'); const c=cp.spawn(process.execPath,[path.join(__dirname,'child.js')],{stdio:'ignore',windowsHide:true}); fs.writeFileSync(path.join(__dirname,'owned-pids.json'),JSON.stringify({parent:process.pid,child:c.pid})); setInterval(()=>{},1000);");
  foreign = spawn(process.execPath, [path.join(work, 'child.js')], { stdio: 'ignore', windowsHide: true });
  await execute(process.execPath, [path.join(work, 'parent.js')], false);
  await wait(() => fs.existsSync(path.join(work, 'owned-pids.json')));
  const pids = JSON.parse(fs.readFileSync(path.join(work, 'owned-pids.json')));
  assert.ok(live(pids.parent) && live(pids.child) && live(foreign.pid));
  await page.getByLabel('STOP nativo', { exact: true }).click();
  await wait(() => !live(pids.parent) && !live(pids.child));
  assert.ok(live(foreign.pid));
  await page.waitForFunction(() => document.querySelector('[data-testid="native-output"]')?.textContent?.includes('CANCELLED'));
  passed('STOP kills own live root and child; own foreign control process survives');
  const fresh = await execute('cmd.exe', ['/d', '/c', 'echo AFTER_STOP']);
  assert.equal(fresh.status, 'SUCCESS'); assert.match(fresh.data.stdout, /AFTER_STOP/);
  passed('JARVIS executes a fresh native task after STOP');
  fs.writeFileSync(path.join(work, 'detached.cjs'), "const fs=require('fs'),cp=require('child_process'),path=require('path');const c=cp.spawn(process.execPath,[path.join(__dirname,'child.js')],{detached:true,stdio:'ignore',windowsHide:true});c.unref();fs.writeFileSync(path.join(__dirname,'detached-pids.json'),JSON.stringify({parent:process.pid,child:c.pid}));process.exit(0);");
  await execute(process.execPath, [path.join(work, 'detached.cjs')], false);
  await wait(() => fs.existsSync(path.join(work, 'detached-pids.json')));
  const detached = JSON.parse(fs.readFileSync(path.join(work, 'detached-pids.json'))); await wait(() => !live(detached.parent)); assert.ok(live(detached.child));
  await page.getByLabel('STOP nativo', { exact: true }).click(); await wait(() => !live(detached.child)); assert.ok(live(foreign.pid));
  passed('packaged STOP owns detached child after parent has exited, foreign control preserved');
  // Native app discovery reads only this test-owned APPDATA shortcut folder.
  const launched = await page.evaluate(async () => {
    const known = (await window.jarvis.desktop.apps()).find(a => a.name === 'S2 Owned Fixture');
    if (!known) throw Error('Own shortcut not discovered');
    const s = await window.jarvis.authority.snapshot();
    return { known, id: s.activeRun };
  });
  // A stopped admission must first be replaced by a new real console gesture.
  await execute('cmd.exe', ['/d', '/c', 'echo APP_RUN']);
  // ACTIVE is an actual helper observation, not a test grant. UNKNOWN during
  // helper startup must not be confused with a successful interactive launch.
  await page.waitForFunction(async () => (await window.jarvis.desktop.status()).session === 'ACTIVE', null, { timeout: 30000 });
  const launchedApp = await page.evaluate(async appId => {
    const s = await window.jarvis.authority.snapshot(); await window.jarvis.desktop.bindRun(s.activeRun);
    return window.jarvis.desktopTools['app.launch']('FULL', s.activeRun, { appId });
  }, launched.known.id);
  assert.equal(launchedApp.ok, true, JSON.stringify(launchedApp)); assert.ok(launchedApp.data.pid > 0 && live(launchedApp.data.pid));
  await page.evaluate(() => window.jarvis.authority.stop()); await wait(() => !live(launchedApp.data.pid)); assert.ok(live(foreign.pid));
  passed('packaged app.launch resolves own discovered .lnk and STOP kills only owned executable');
  fs.unlinkSync(path.join(work, 'owned-pids.json'));
  await execute(process.execPath, [path.join(work, 'parent.js')], false); await wait(() => fs.existsSync(path.join(work, 'owned-pids.json')));
  const flight = JSON.parse(fs.readFileSync(path.join(work, 'owned-pids.json')));
  const oldRun = await page.evaluate(async () => (await window.jarvis.authority.snapshot()).activeRun);
  await mode('RESTRICTED'); await wait(() => !live(flight.parent) && !live(flight.child)); assert.ok(live(foreign.pid));
  assert.equal((await page.evaluate(() => window.jarvis.authority.snapshot())).run.stopped, true);
  await mode('FULL');
  const revived = await page.evaluate(({ id, cwd }) => window.jarvis.authority.execute(id, 'terminal.execute', { cwd, executable: 'cmd.exe', args: ['/c', 'echo NO_REVIVE'] }), { id: oldRun, cwd: work });
  assert.equal(revived.ok, false);
  passed('packaged downgrade aborts running command and child; upgrade never revives old admission');
  await execute('cmd.exe', ['/c', 'echo NEW_ADMISSION']);
  // Pause after the temporary write but before the final rename. This is a
  // timing fixture, not a bypass: the production mutation checkpoint decides.
  await app.evaluate(() => {
    const f = process.getBuiltinModule('fs').promises; globalThis.s2ReadOriginal = f.readFile;
    globalThis.s2WritePaused = false;
    f.readFile = async (...args) => { if (String(args[0]).includes('flight-file.txt') && String(args[0]).includes('.jarvis-tmp-')) { globalThis.s2WritePaused = true; await new Promise(r => { globalThis.s2WriteRelease = r; }); } return globalThis.s2ReadOriginal(...args); };
  });
  await page.evaluate(async work => {
    const s = await window.jarvis.authority.snapshot();
    window.s2Flight = window.jarvis.authority.execute(s.activeRun, 'file.create', { path: 'flight-file.txt', content: 'must-not-commit', cwd: work });
  }, work);
  for (let n = 0; !(await app.evaluate(() => globalThis.s2WritePaused)); n++) { assert.ok(n < 150, 'own write reached commit checkpoint'); await new Promise(r => setTimeout(r, 100)); }
  await mode('RESTRICTED'); await mode('FULL');
  await app.evaluate(() => { process.getBuiltinModule('fs').promises.readFile = globalThis.s2ReadOriginal; globalThis.s2WriteRelease(); });
  const flightWrite = await page.evaluate(() => window.s2Flight); assert.equal(flightWrite.ok, false); assert.equal(fs.existsSync(path.join(work, 'flight-file.txt')), false);
  passed('packaged downgrade/upgrade during file write cannot commit or resurrect operation');
  const priorPermissions = await page.evaluate(() => window.jarvis.browser.permissions());
  await app.evaluate(({ Menu }) => { globalThis.s2Popup = Menu.prototype.popup; Menu.prototype.popup = function () {}; });
  await page.evaluate(() => window.jarvis.browser.setPermission('https://example.test', 'geolocation', true, 'personal'));
  assert.deepEqual(await page.evaluate(() => window.jarvis.browser.permissions()), priorPermissions);
  await app.evaluate(({ Menu }) => { Menu.prototype.popup = globalThis.s2Popup; });
  passed('renderer browser permission claim opens native choice, cannot self-grant policy');
  const secret = await execute('powershell.exe', ['-NoProfile', '-Command', "Write-Output 'PASSWORD=s2-never-store'; Write-Output 'cookie=s2-never-cookie'"]);
  assert.equal(JSON.stringify(secret).includes('s2-never-store'), false);
  assert.equal(JSON.stringify(secret).includes('s2-never-cookie'), false);
  const logs = await page.evaluate(() => window.jarvis.dev.commands());
  assert.equal(JSON.stringify(logs).includes('s2-never-store'), false);
  passed('tested synthetic credential output and command arguments do not enter public logs/receipt');
  // Native control interception counts real dialog attempts but simulates denial; no external visit.
  await page.evaluate(url => window.jarvis.browser.create(url, 'default'), externalFixture + '?discovered');
  await new Promise(r => setTimeout(r, 500));
  assert.equal(requests, 0); assert.equal(await app.evaluate(() => globalThis.s2Dialogs.length), 1);
  passed('discovered external fixture requests native authorization before navigation (denial simulated)');
  const omnibox = page.locator('[data-authority-omnibox="true"]');
  await omnibox.fill(externalFixture); await omnibox.press('Enter');
  await wait(() => requests > 0);
  await waitPage(externalFixture);
  assert.equal(await app.evaluate(() => globalThis.s2Dialogs.length), 1);
  passed('original trusted omnibox URL navigates without double prompt');
  await app.evaluate(async ({ webContents }, url) => {
    const page = webContents.getAllWebContents().find(w => w.getURL() === url);
    await page.executeJavaScript("window.open(" + JSON.stringify(url + '?popup-discovered') + ")");
  }, externalFixture);
  await new Promise(r => setTimeout(r, 300));
  assert.equal(requests, 1); assert.equal(await app.evaluate(() => globalThis.s2Dialogs.length), 2);
  passed('real Chromium popup goes through external navigation guard before requesting content');
  const hostUrl = externalFixture.replace('/original', '');
  const beforeRedirect = await app.evaluate(() => globalThis.s2Dialogs.length);
  await omnibox.fill(hostUrl + '/redirect-entry'); await omnibox.press('Enter');
  await wait(() => requestDetails.some(r => r.url === '/redirect-entry')); await new Promise(r => setTimeout(r, 500));
  assert.equal(requestDetails.some(r => r.url === '/redirect-target'), false);
  assert.equal(await app.evaluate(() => globalThis.s2Dialogs.length), beforeRedirect + 1);
  passed('packaged external redirect requires new authorization before destination request');
  const beforeFrame = await app.evaluate(() => globalThis.s2Dialogs.length);
  await omnibox.fill(hostUrl + '/frames-entry'); await omnibox.press('Enter');
  await wait(() => requestDetails.some(r => r.url === '/xhr-resource')); await new Promise(r => setTimeout(r, 500));
  assert.equal(requestDetails.some(r => r.url === '/frame-target'), false);
  assert.equal(await app.evaluate(() => globalThis.s2Dialogs.length), beforeFrame + 1);
  passed('initial subframe requires authorization, while XHR remains unaffected (not an egress firewall)');
  await omnibox.fill(hostUrl + '/post-entry'); await omnibox.press('Enter');
  await wait(() => requestDetails.some(r => r.url === '/post-entry'));
  await waitPage(hostUrl + '/post-entry', '!!document.querySelector("form")');
  await app.evaluate(async ({ dialog, webContents }, target) => {
    dialog.showMessageBox = async (...args) => { globalThis.s2Dialogs.push(args.at(-1).detail); return { response: 1, checkboxChecked: false }; };
    const w = webContents.getAllWebContents().find(w => w.getURL() === target);
    await w.executeJavaScript('document.querySelector("form").submit()');
  }, hostUrl + '/post-entry');
  await wait(() => requestDetails.some(r => r.url === '/post-target'));
  assert.equal(requestDetails.find(r => r.url === '/post-target').method, 'POST');
  passed('approved navigation retains original POST method, no GET replay (approval simulated)');
  await app.evaluate(({ dialog }) => {
    dialog.showMessageBox = async (...args) => { globalThis.s2Dialogs.push(args.at(-1).detail); return new Promise(resolve => { globalThis.s2PendingLink = resolve; }); };
  });
  await page.evaluate(url => window.jarvis.browser.create(url, 'default'), hostUrl + '/transition-target');
  for (let n = 0; !(await app.evaluate(() => !!globalThis.s2PendingLink)); n++) { assert.ok(n < 100); await new Promise(r => setTimeout(r, 50)); }
  await mode('RESTRICTED'); await mode('FULL');
  await app.evaluate(({ dialog }) => {
    globalThis.s2PendingLink({ response: 1 });
    dialog.showMessageBox = async (...args) => { globalThis.s2Dialogs.push(args.at(-1).detail); return { response: 0, checkboxChecked: false }; };
  });
  await new Promise(r => setTimeout(r, 300)); assert.equal(requestDetails.some(r => r.url === '/transition-target'), false);
  passed('pending external approval cannot survive downgrade/upgrade authority transition');
  await page.getByRole('button', { name: 'Home', exact: true }).click();
  const homeOriginal = 'Consulta la información del sistema desde Home';
  await page.locator('[data-authority-home-input]').fill(homeOriginal);
  await page.locator('[data-authority-home-send]').click();
  await page.waitForFunction(async hash => (await window.jarvis.authority.snapshot()).run?.originalHash === hash, createHash('sha256').update(homeOriginal).digest('hex'));
  passed('Home original user input reaches main authority before classification');
  await page.getByRole('button', { name: 'Analiza NVIDIA', exact: true }).click();
  await page.waitForFunction(async () => (await window.jarvis.authority.snapshot()).run?.source === 'USER_UI_GESTURE');
  const fixed = await page.evaluate(() => window.jarvis.authority.snapshot());
  assert.deepEqual(fixed.run.links, []); assert.equal(fixed.run.strongRequired, false);
  passed('fixed UI action starts a task without promoting discovered text to link/Strong authority');
  if (!(await page.getByPlaceholder('Pide algo a JARVIS', { exact: true }).count())) await page.getByRole('button', { name: 'Abrir JARVIS' }).click();
  await page.getByPlaceholder('Pide algo a JARVIS', { exact: true }).fill('Usa Strong. Consulta información del sistema');
  await page.getByLabel('Enviar', { exact: true }).click();
  await page.waitForFunction(async () => (await window.jarvis.authority.snapshot()).run?.strongRequired === true);
  const strong = await page.evaluate(async cwd => { const s = await window.jarvis.authority.snapshot(); return window.jarvis.authority.execute(s.activeRun, 'terminal.execute', { cwd, executable: 'cmd.exe', args: ['/c','echo WRONG'] }); }, work);
  assert.equal(strong.ok, false);
  passed('original user Strong fails this native task closed; no model-induced Native fallback');
  const foreignSender = await app.evaluate(async ({ BrowserWindow }) => { const w = new BrowserWindow({ show: false, webPreferences: { nodeIntegration: true, contextIsolation: false } }); try { await w.loadURL('about:blank'); return await w.webContents.executeJavaScript("require('electron').ipcRenderer.invoke('authority:snapshot').then(()=> 'ALLOWED',e=>e.message)"); } finally { w.destroy(); } });
  assert.match(foreignSender, /UNTRUSTED_AUTHORITY_SENDER/);
  passed('foreign renderer cannot reach effective authority IPC');
  await consoleView();
  await execute('cmd.exe', ['/d','/c','echo STILL_ALIVE']);
  await page.screenshot({ path: path.join(evidence, 's2-native.png') });
  await app.close(); app = null;
  for (const file of fs.readdirSync(path.join(profile, 'intelligence-fabric'))) {
    const bytes = fs.readFileSync(path.join(profile, 'intelligence-fabric', file));
    assert.equal(bytes.includes(Buffer.from('s2-never-store')), false); assert.equal(bytes.includes(Buffer.from('s2-never-cookie')), false);
  }
  passed('tested secret values absent from actual S1 SQLite files');
  fs.writeFileSync(path.join(evidence, 'native-s2.json'), JSON.stringify({ status: 'PASS', checks, executablePath,
    asarHash: createHash('sha256').update(fs.readFileSync(path.join(path.dirname(executablePath), 'resources', 'app.asar'))).digest('hex'),
    limitations: ['native mode menu callback and external denial simulated in host test; not a human OS dialog interaction', 'OS jobs cover created process descendants, not foreign brokers or reused app instances', 'no arbitrary secret-flow certification or Strong isolation attestation'] }, null, 2));
  console.log('S2_NATIVE_PASS ' + checks.length + ' checks');
} catch (error) {
  fs.writeFileSync(path.join(evidence, 'native-s2.json'), JSON.stringify({ status: 'FAIL', checks, error: String(error) }, null, 2)); throw error;
} finally {
  await app?.close().catch(() => {}); foreign?.kill(); server.close();
  const resolved = path.resolve(temp);
  if (!resolved.startsWith(path.resolve(os.tmpdir()) + path.sep) || !path.basename(resolved).startsWith('jarvis-fabric-native-s2-')) throw Error('Unsafe cleanup');
  try { fs.rmSync(resolved, { recursive: true, force: true, maxRetries: 5 }); } catch (error) { console.warn('Own TEMP retained: ' + resolved + ' ' + error.code); }
}
