/**
 * The Electron side of the native helper: protocol validation and the
 * stdin/stdout bridge, driven against a real separate process that speaks the
 * same format. The C# helper itself is not exercised here — there is no
 * Windows or .NET in this environment.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { HELPER_COMMANDS, validateRequest, validateResponse, timeoutFor } from '../../electron/desktop/protocol';
import { WindowsHelperBridge } from '../../electron/desktop/WindowsHelperBridge';
import { wireHelper } from '../../electron/desktop/helperLifecycle';
import { DesktopControlService } from '../../src/desktop/DesktopControlService';
import { CapabilityRegistry } from '../../src/machine/CapabilityRegistry';
import { fixture } from '../../src/machine/fixtures/machines';
import { discoverApps, publicApp } from '../../electron/desktop/AppDiscovery';
import fs from 'node:fs';
import { withProcessScope } from '../../electron/process/WindowsJobProcess';

let pass = 0, fail = 0;
const t = (name: string, cond: boolean, extra = '') => {
  if (cond) { pass++; console.log('  ok  ', name); }
  else { fail++; console.log('  FAIL', name, extra); }
};
const section = (s: string) => console.log(`\n— ${s}`);
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const here = path.dirname(fileURLToPath(import.meta.url));
const FAKE = path.join(here, 'fake-helper.mjs');
const req = (command: string, args: Record<string, unknown> = {}, requestId = 'r1') => validateRequest({ requestId, command, args });

/* ================================================================== */
section('Protocolo: vocabulario cerrado');
{
  const commands = Object.keys(HELPER_COMMANDS);
  t(`${commands.length} comandos, ninguno de ejecución arbitraria`,
    !commands.some((c) => /shell|powershell|script|eval|exec|run|dll|library|load|spawn|cmd|process\.start/i.test(c)));
  for (const bad of ['shellCommand', 'powershell', 'rawScript', 'eval', 'loadLibrary', 'execute', 'runProcess', '__proto__', 'constructor', 'toString']) {
    const r = req(bad);
    t(`«${bad}» se rechaza como desconocido`, !r.ok && /desconocido/.test((r as { error: string }).error));
  }
  t('un comando válido se acepta', req('uiInvoke', { elementId: 'el:42' }).ok);
  t('argumento extra se rechaza (no se ignora)', !req('uiInvoke', { elementId: 'el:42', script: 'rm' }).ok);
  t('argumento que falta se rechaza', !req('uiSetValue', { elementId: 'el:1' }).ok);
  t('tipo inválido: número donde va string', !req('uiInvoke', { elementId: 42 }).ok);
  t('tipo inválido: string donde va entero', !req('mouseMove', { x: '10', y: 5 }).ok);
  t('entero no finito se rechaza', !req('mouseMove', { x: Infinity, y: 5 }).ok && !req('mouseMove', { x: 1.5, y: 5 }).ok);
  t('coordenadas absurdas se rechazan', !req('mouseMove', { x: 10_000_000, y: 5 }).ok);
  t('id con caracteres de inyección se rechaza', !req('uiInvoke', { elementId: 'el:1; rm -rf' }).ok && !req('activateWindow', { windowId: '../../x' }).ok);
  t('estado de ventana fuera de la lista se rechaza', !req('setWindowState', { windowId: 'hwnd:0x1', state: 'hidden' }).ok);
  t('botón inválido se rechaza', !req('mouseClick', { x: 1, y: 1, button: 'x1', count: 1 }).ok);
  t('tecla con texto libre se rechaza', !req('keyPress', { key: 'rm -rf /' }).ok);
  t('combinación de más de 4 teclas se rechaza', !req('keyHotkey', { keys: ['a', 'b', 'c', 'd', 'e'] }).ok);
  t('texto por encima del máximo se rechaza', !req('typeText', { text: 'x'.repeat(4001) }).ok);
  t('requestId ausente o inválido se rechaza', !validateRequest({ command: 'ping', args: {} }).ok && !req('ping', {}, 'id con espacios').ok);
  t('args como lista se rechaza', !validateRequest({ requestId: 'r', command: 'ping', args: [] }).ok);
  t('petición vacía se rechaza', !validateRequest(null).ok);

  t('respuesta válida se acepta', validateResponse({ requestId: 'r1', ok: true, result: 1 }) !== null);
  t('respuesta sin requestId se descarta', validateResponse({ ok: true }) === null);
  t('respuesta con ok no booleano se descarta', validateResponse({ requestId: 'r', ok: 'yes' }) === null);
  t('evento desconocido se descarta', validateResponse({ event: 'runThis', data: {} }) === null);
  t('evento humanInput se reconoce', (validateResponse({ event: 'humanInput', data: { kind: 'mouse' } }) as { event: string } | null)?.event === 'humanInput');
  t('mensajes de error larguísimos se acotan', ((validateResponse({ requestId: 'r', ok: false, error: 'x'.repeat(5000) }) as { error: string }).error.length) === 500);
  t('timeouts por comando: la escritura tiene más margen que las lecturas', timeoutFor('typeText') > timeoutFor('uiInvoke') && timeoutFor('uiInvoke') > 0);

  const csharp = fs.readFileSync(path.join(here, '../../native/windows-helper/Program.cs'), 'utf8');
  const csCommands = [...csharp.matchAll(/\["(\w+)"\] = \[/g)].map((m) => m[1]!).sort();
  t('el helper C# declara exactamente el mismo vocabulario', JSON.stringify(csCommands) === JSON.stringify([...commands].sort()), csCommands.filter((c) => !commands.includes(c)).join());
  t('el helper C# no referencia Process.Start, PowerShell ni carga de ensamblados',
    !/Process\.Start|PowerShell|Assembly\.Load|LoadLibrary|CSharpScript|cmd\.exe/.test(
      fs.readdirSync(path.join(here, '../../native/windows-helper')).filter((f) => f.endsWith('.cs')).map((f) => fs.readFileSync(path.join(here, '../../native/windows-helper', f), 'utf8')).join('\n')
        // Code only: comments that *deny* the capability must not count.
        .replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '')));
  const manifest = fs.readFileSync(path.join(here, '../../native/windows-helper/app.manifest'), 'utf8');
  t('el manifiesto pide asInvoker (nunca elevación) y uiAccess=false', /level="asInvoker"/.test(manifest) && /uiAccess="false"/.test(manifest));
}

/* ================================================================== */
section('Puente: transporte con un helper real por stdin/stdout');
{
  const states: boolean[] = [];
  const bridge = new WindowsHelperBridge({
    executable: process.execPath, args: [FAKE], maxRestarts: 1,
    onStateChange: (alive) => states.push(alive),
    timeoutFor: (c) => (c === 'activateWindow' ? 150 : c === 'uiElement' ? 100 : 2000),
  });
  const started = await bridge.start();
  t('arranca y responde al ping pese a ruido y mensajes partidos', started && await bridge.available());
  t('notifica que está vivo', states.at(-1) === true);

  const windows = await bridge.listWindows();
  t('listWindows viaja y vuelve tipado', windows.length === 1 && windows[0]!.windowId === 'hwnd:0x10');
  t('sessionState', (await bridge.sessionState()) === 'ACTIVE');

  const [a, b, c] = await Promise.all([bridge.sessionState(), bridge.listWindows(), bridge.sessionState()]);
  t('peticiones concurrentes se emparejan por requestId', a === 'ACTIVE' && Array.isArray(b) && c === 'ACTIVE');

  let err = '';
  try { await bridge.uiInvoke('el:9'); } catch (e) { err = (e as Error).message; }
  t('un error del helper llega como Error legible', /no expone el patrón Invoke/.test(err));

  const before = (await bridge.processes()).length;
  let rejected = '';
  try { await bridge.send('powershell' as never, { command: 'Get-Process' }); } catch (e) { rejected = (e as Error).message; }
  try { await bridge.send('uiInvoke', { elementId: 'el:1', extra: 'x' }); } catch { /* esperado */ }
  const afterList = await bridge.processes();
  t('un comando fuera del vocabulario se rechaza en el puente', /desconocido/.test(rejected));
  t('las peticiones inválidas nunca llegaron al proceso helper', afterList.length === before + 1 && !afterList.some((p) => p.name === 'powershell'));

  const t0 = Date.now();
  let timeout = '';
  try { await bridge.activateWindow('hwnd:0xdead'); } catch (e) { timeout = (e as Error).message; }
  t('un helper que no responde produce timeout, no bloqueo', /a tiempo/.test(timeout) && Date.now() - t0 < 1000);
  t('la petición caducada no queda pendiente', bridge.pendingCount() === 0);

  let late = '';
  try { await bridge.uiElement('el:late'); } catch (e) { late = (e as Error).message; }
  await sleep(450);
  t('una respuesta tardía tras el timeout se descarta sin efectos', /a tiempo/.test(late) && bridge.pendingCount() === 0 && await bridge.available());

  const human: string[] = [];
  const unsub = bridge.subscribe((e) => human.push(e.kind));
  await bridge.keyPress('h');
  await sleep(20);
  t('los eventos de input humano del helper llegan al detector', human.join() === 'keyboard');
  unsub();

  const ac = new AbortController();
  const typing = bridge.typeText('texto largo', ac.signal).then(() => 'done', (e: Error) => e.message);
  await sleep(50);
  ac.abort();
  t('STOP durante la escritura envía cancelInput y la corta', /cancelada/.test(await typing));
  await bridge.quiesceInput();
  t('el recibo STOP comprueba worker inactivo además de cancelInput', (await bridge.send<{ active: boolean }>('inputState', {})).active === false);
  const revoked = new AbortController(); revoked.abort();
  const refused = await withProcessScope('revoked-fixture', revoked.signal, () => bridge.keyPress('a')).then(() => '', (e: Error) => e.message);
  t('una admisión revocada no manda más comandos al helper', /STOPPED/.test(refused));

  // Crash with pending work → everything rejects, restart kicks in.
  const pendingDuringCrash = bridge.activateWindow('hwnd:0xdead').then(() => 'ok', (e: Error) => e.message);
  let crashErr = '';
  try { await bridge.closeWindow('hwnd:0xcrash'); } catch (e) { crashErr = (e as Error).message; }
  t('si el helper muere, la llamada en curso falla limpiamente', /se detuvo/.test(crashErr));
  t('y todas las pendientes también', /se detuvo/.test(await pendingDuringCrash));
  t('se notificó la caída', states.includes(false));
  await sleep(400);
  t('se reinicia solo (reintento acotado)', await bridge.available() && (await bridge.sessionState()) === 'ACTIVE');

  bridge.kill();
  await sleep(50);
  t('tras kill() explícito no se reinicia', !(await bridge.available()));
  let dead = '';
  try { await bridge.listWindows(); } catch (e) { dead = (e as Error).message; }
  t('con el helper parado, las llamadas fallan al instante', /no está en ejecución/.test(dead));
}

/* ================================================================== */
section('Arranque frío: transporte creado no significa handshake verificado');
{
  const states: boolean[] = [];
  const bridge = new WindowsHelperBridge({executable: process.execPath, args: [FAKE, '--cold-start'], maxRestarts: 0,
    onStateChange: value => states.push(value)});
  const first = bridge.start(); let secondSettled = false;
  const second = bridge.start().then(value => {secondSettled = true; return value;});
  await sleep(100);
  t('no anuncia disponibilidad ni éxito mientras el ping está pendiente', !(await bridge.available()) && !secondSettled && !states.includes(true));
  const [a,b] = await Promise.all([first, second]);
  t('el arranque frío de cinco segundos tiene margen finito sin ampliar timeouts de acciones', a && b && await bridge.available() && timeoutFor('uiInvoke') === 3000);
  if (a) t('ambos callers comparten un solo proceso y un único handshake válido', states.filter(Boolean).length === 1 && (await bridge.processes()).filter(item => item.name === 'ping').length === 1);
  bridge.kill();
}

section('Caída durante el handshake: reintento acotado sin disponibilidad falsa');
{
  const states: boolean[] = [];
  const bridge = new WindowsHelperBridge({executable: process.execPath, args: [FAKE, '--exit-before-ping'], maxRestarts: 1,
    onStateChange: value => states.push(value)});
  t('un proceso que muere antes del pong no completa el arranque', await bridge.start() === false);
  await sleep(600);
  t('consume sólo el reintento configurado y nunca anuncia READY', states.filter(value => value === false).length === 2 && !states.includes(true) && !(await bridge.available()));
  bridge.kill();
}

section('STOP incompleto: watchdog, no recibo falso');
{
  const bridge = new WindowsHelperBridge({ executable: process.execPath, args: [FAKE, '--hang-stop'], maxRestarts: 0 });
  await bridge.start();
  const typing = bridge.typeText('fixture', new AbortController().signal).then(() => 'DONE', (e: Error) => e.message);
  const started = Date.now();
  const receipt = await bridge.quiesceInput().then(() => 'PASS', (e: Error) => e.message);
  t('telemetría colgada y cancel aceptado no producen PASS', receipt === 'INPUT_STOP_NOT_QUIESCENT');
  t('el watchdog termina solo nuestro helper, acotado', !(await bridge.available()) && Date.now() - started < 4000);
  t('la entrada pendiente falla al terminar el helper', /se detuvo/.test(await typing));
  bridge.kill();
}

/* ================================================================== */
section('Ciclo de vida: caída y reinicio conectados al control');
{
  const desktop = new DesktopControlService();
  const bridge = wireHelper(desktop, { executable: process.execPath, args: [FAKE], maxRestarts: 1 });
  await sleep(300);
  t('al arrancar, el control usa el helper', desktop.status().helperAvailable && (await desktop.windows.listWindows()).length === 1);
  t('y el helper es la fuente de input humano', desktop.human.supported);
  try { await bridge.closeWindow('hwnd:0xcrash'); } catch { /* muere a propósito */ }
  await sleep(20);
  t('al caer, el control informa no disponible', !desktop.status().helperAvailable);
  t('y deja de ofrecer una fuente de input humano', !desktop.human.supported);
  await sleep(400);
  t('tras el reinicio, el control vuelve a estar disponible', desktop.status().helperAvailable);
  t('y las llamadas vuelven a llegar al helper (no al adaptador vacío)', (await desktop.windows.listWindows()).length === 1);
  bridge.kill();
  await sleep(30);
}

/* ================================================================== */
section('Helper ausente: JARVIS sigue funcionando');
{
  const missing = new WindowsHelperBridge({ executable: '/no/existe/jarvis-automation-helper.exe', maxRestarts: 0 });
  const ok = await missing.start();
  t('un ejecutable inexistente no rompe el arranque', ok === false && !(await missing.available()));

  const desktop = new DesktopControlService({ adapter: missing });
  await desktop.refresh();
  t('el control informa helper no disponible', !desktop.status().helperAvailable);
  const caps = new CapabilityRegistry().evaluate({
    profile: fixture('C'), localAI: null, permission: 'ADMIN', hasNativeBridge: true,
    helperAvailable: desktop.status().helperAvailable,
  });
  t('CapabilityRegistry: uiAutomation = UNAVAILABLE', caps.find((c) => c.id === 'uiAutomation')?.state === 'UNAVAILABLE');
  t('las capacidades ajenas al helper siguen disponibles', caps.find((c) => c.id === 'filesystem.read')?.state === 'AVAILABLE');
}

/* ================================================================== */
section('Descubrimiento de aplicaciones (main)');
{
  const apps = await discoverApps([
    { id: 'visual studio code', name: 'Visual Studio Code', path: 'C:\\Users\\a\\Start Menu\\Visual Studio Code.lnk', source: 'start-menu' },
    { id: 'blender 4.2', name: 'Blender 4.2', path: 'C:\\ProgramData\\Start Menu\\Blender.lnk', source: 'start-menu' },
    { id: 'code', name: 'Code', path: 'C:\\dup.lnk', source: 'desktop' },
  ] as never);
  t('ids estables a partir del menú Inicio', apps.some((a) => a.id === 'app:vscode') && apps.some((a) => a.id === 'app:blender'));
  t('duplicados de la misma app se fusionan', apps.filter((a) => a.id === 'app:vscode').length === 1);
  t('publicApp nunca expone la ruta', apps.map(publicApp).every((a) => a.launchTarget === ''));
  t('en Linux no se consulta el registro (sin ejecutar reg.exe)', process.platform !== 'win32' ? apps.every((a) => a.source !== 'registry') : true);
}

console.log(`\n${pass} ok · ${fail} fallos\n`);
process.exit(fail ? 1 : 0);
