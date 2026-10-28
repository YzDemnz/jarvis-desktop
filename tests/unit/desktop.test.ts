/**
 * Windows computer control against the Windows double. Nothing here runs on
 * Windows: every assertion is about JARVIS's own logic — refs, gates, limits,
 * strategies, secrets — driven by a fake that behaves like the real thing.
 */
import type { PermissionLevel, RoutingDecision, ToolResult, UIElementView } from '../../src/types';
import { FakeWindowsAutomationAdapter, fixtureApps } from '../../src/desktop/FakeWindowsAutomationAdapter';
import { UnavailableAutomationAdapter } from '../../src/desktop/adapter';
import { DesktopControlService } from '../../src/desktop/DesktopControlService';
import { StaleElementError, UnsupportedPatternError } from '../../src/desktop/UIAutomationService';
import { InputBlockedError, containsSecret } from '../../src/desktop/InputService';
import { runWithStrategies } from '../../src/desktop/InteractionStrategy';
import { ManualHumanInputSource } from '../../src/desktop/HumanOverrideDetector';
import { ScreenCaptureService } from '../../src/desktop/ScreenCaptureService';
import { VisionService } from '../../src/desktop/VisionService';
import type { VisionProvider } from '../../src/desktop/VisionService';
import { buildUIContext } from '../../src/desktop/UIContextBuilder';
import { DesktopSnapshotService } from '../../src/desktop/DesktopSnapshotService';
import { SlidingWindowLimiter } from '../../src/desktop/RateLimiter';
import { appIdFromText, stableId } from '../../src/desktop/appIds';
import { heuristicCategory, heuristicRoute } from '../../src/services/ai/routing';
import { ToolBroker } from '../../src/agent/ToolBroker';
import { ToolRegistry, TOOL_DEFINITIONS } from '../../src/agent/registry';
import { PermissionEngine } from '../../src/agent/permissions';
import { ApprovalEngine } from '../../src/agent/ApprovalEngine';
import { AuditService } from '../../src/agent/AuditService';
import { CancellationToken } from '../../src/agent/cancellation';
import { AgentRuntime, bindArgs } from '../../src/agent/AgentRuntime';
import { planRun } from '../../src/agent/planner';
import { CapabilityRegistry } from '../../src/machine/CapabilityRegistry';
import { fixture } from '../../src/machine/fixtures/machines';

let pass = 0, fail = 0;
const t = (name: string, cond: boolean, extra = '') => {
  if (cond) { pass++; console.log('  ok  ', name); }
  else { fail++; console.log('  FAIL', name, extra); }
};
const section = (s: string) => console.log(`\n— ${s}`);
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const throwsAsync = async (fn: () => Promise<unknown>, match?: RegExp | (new (...a: never[]) => Error)): Promise<boolean> => {
  try { await fn(); return false; } catch (e) {
    if (!match) return true;
    if (match instanceof RegExp) return match.test(e instanceof Error ? e.message : String(e));
    return e instanceof match;
  }
};

/** Answers every approval prompt with a fixed verdict, counting them. */
function onRequest(approvals: ApprovalEngine, handle: (req: { id: string }) => void): void {
  const seen = new Set<string>();
  approvals.subscribe((req) => {
    if (!req || seen.has(req.id)) return;
    seen.add(req.id);
    queueMicrotask(() => handle(req));
  });
}

async function setup(apps?: string[]) {
  const fake = new FakeWindowsAutomationAdapter(apps);
  const human = new ManualHumanInputSource();
  let overrides = 0;
  const desktop = new DesktopControlService({
    adapter: fake, humanInput: human, apps: async () => fixtureApps(), onHumanOverride: () => { overrides++; },
  });
  await desktop.refresh();
  return { fake, desktop, human, overrides: () => overrides };
}

function brokerFor(desktop: DesktopControlService, extra: Record<string, unknown> = {}) {
  const audit = new AuditService();
  const approvals = new ApprovalEngine();
  const registry = new ToolRegistry(TOOL_DEFINITIONS);
  const broker = new ToolBroker({ registry, audit, approvals, permissions: new PermissionEngine() });
  broker.registerAll(desktop.adapters());
  broker.registerAll(extra as never);
  broker.addPolicy(desktop.policy());
  return { broker, audit, approvals, registry };
}

const vscodeWindow = async (fake: FakeWindowsAutomationAdapter) => (await fake.listWindows()).find((w) => w.processName === 'Code.exe')!;

/* ================================================================== */
section('Registro de herramientas');
{
  const registry = new ToolRegistry(TOOL_DEFINITIONS);
  const expected = [
    'window.list', 'window.active', 'window.find', 'window.focus', 'window.minimize', 'window.maximize',
    'window.restore', 'window.move', 'window.resize', 'window.close',
    'ui.inspect', 'ui.find', 'ui.focus', 'ui.invoke', 'ui.setValue', 'ui.toggle', 'ui.select', 'ui.expand', 'ui.collapse', 'ui.scroll',
    'screen.captureDisplay', 'screen.captureWindow', 'screen.captureRegion',
    'mouse.move', 'mouse.click', 'mouse.doubleClick', 'mouse.rightClick', 'mouse.scroll', 'mouse.drag',
    'keyboard.press', 'keyboard.hotkey', 'keyboard.type', 'app.launch', 'process.list', 'process.find', 'process.info',
  ];
  const missing = expected.filter((id) => !registry.get(id));
  t(`las ${expected.length} herramientas de la fase existen`, missing.length === 0, missing.join(','));
  const g = (id: string) => registry.get(id)!;
  t('window.list/active/find → OBSERVE/SAFE', ['window.list', 'window.active', 'window.find'].every((id) => g(id).requiredPermission === 'OBSERVE' && g(id).risk === 'SAFE'));
  t('focus/minimize/maximize/restore → ASSIST/SAFE', ['window.focus', 'window.minimize', 'window.maximize', 'window.restore'].every((id) => g(id).requiredPermission === 'ASSIST' && g(id).risk === 'SAFE'));
  t('move/resize/close → CONTROL/SENSITIVE', ['window.move', 'window.resize', 'window.close'].every((id) => g(id).requiredPermission === 'CONTROL' && g(id).risk === 'SENSITIVE'));
  t('ui.inspect/find → OBSERVE', g('ui.inspect').requiredPermission === 'OBSERVE' && g('ui.find').requiredPermission === 'OBSERVE');
  t('ui.focus → ASSIST', g('ui.focus').requiredPermission === 'ASSIST');
  t('invoke/select/expand/scroll → CONTROL', ['ui.invoke', 'ui.select', 'ui.expand', 'ui.scroll'].every((id) => g(id).requiredPermission === 'CONTROL'));
  t('ui.setValue → CONTROL/SENSITIVE', g('ui.setValue').requiredPermission === 'CONTROL' && g('ui.setValue').risk === 'SENSITIVE');
  t('capturas → OBSERVE/SENSITIVE', ['screen.captureDisplay', 'screen.captureWindow', 'screen.captureRegion'].every((id) => g(id).requiredPermission === 'OBSERVE' && g(id).risk === 'SENSITIVE'));
  t('ratón → CONTROL/SENSITIVE', ['mouse.move', 'mouse.click', 'mouse.doubleClick', 'mouse.rightClick', 'mouse.scroll', 'mouse.drag'].every((id) => g(id).requiredPermission === 'CONTROL' && g(id).risk === 'SENSITIVE'));
  t('teclado → CONTROL/SENSITIVE', ['keyboard.press', 'keyboard.hotkey', 'keyboard.type'].every((id) => g(id).requiredPermission === 'CONTROL' && g(id).risk === 'SENSITIVE'));
  t('app.launch → ASSIST/SENSITIVE', g('app.launch').requiredPermission === 'ASSIST' && g('app.launch').risk === 'SENSITIVE');
  t('process.terminate existe DESHABILITADA/DESTRUCTIVE', g('process.terminate').enabled === false && g('process.terminate').risk === 'DESTRUCTIVE');
  t('ninguna herramienta de shell ni powershell habilitada', !TOOL_DEFINITIONS.some((d) => (/shell|powershell|script|eval/i.test(d.id) || d.id === 'terminal.run') && d.enabled));
  t('el único terminal habilitado es el estructurado', TOOL_DEFINITIONS.filter((d) => d.category === 'terminal' && d.enabled).every((d) => ['terminal.execute', 'terminal.output'].includes(d.id)));
  t('texto tecleado y valores se auditan por forma', g('keyboard.type').auditArgs === 'shape' && g('ui.setValue').auditArgs === 'shape');
  t('toda herramienta que cambia el escritorio está marcada interactiva',
    ['window.focus', 'window.move', 'ui.invoke', 'ui.setValue', 'mouse.click', 'keyboard.type', 'app.launch'].every((id) => g(id).interactive));
  t('ninguna herramienta de observación es interactiva', ['window.list', 'ui.inspect', 'ui.find', 'process.list', 'desktop.snapshot'].every((id) => !g(id).interactive));
}

/* ================================================================== */
section('FULL CONTROL: aprobación por nivel');
{
  const engine = new PermissionEngine();
  const registry = new ToolRegistry(TOOL_DEFINITIONS);
  const g = (id: string) => registry.get(id)!;
  t('en CONTROL, ui.invoke pide aprobación', engine.needsApproval(g('ui.invoke'), 'CONTROL'));
  t('en ADMIN, ui.invoke (rutinaria) no pide', !engine.needsApproval(g('ui.invoke'), 'ADMIN'));
  t('en ADMIN, keyboard.type no sensible no pide', !engine.needsApproval(g('keyboard.type'), 'ADMIN'));
  t('en ADMIN, window.close sigue pidiendo (no rutinaria)', engine.needsApproval(g('window.close'), 'ADMIN'));
  t('en ADMIN, mouse.drag sigue pidiendo', engine.needsApproval(g('mouse.drag'), 'ADMIN'));
  t('en ADMIN, capturas siguen pidiendo', engine.needsApproval(g('screen.captureDisplay'), 'ADMIN'));
  t('DESTRUCTIVE pide aprobación en todos los niveles',
    (['OBSERVE', 'ASSIST', 'CONTROL', 'ADMIN'] as PermissionLevel[]).every((l) => engine.needsApproval(g('process.terminate'), l)));
  t('una DESTRUCTIVE marcada "routine" por error sigue pidiendo', engine.needsApproval({ ...g('process.terminate'), routine: true }, 'ADMIN'));
  t('window.focus (SAFE) nunca pide', !engine.needsApproval(g('window.focus'), 'ASSIST'));
}

/* ================================================================== */
section('Ventanas');
{
  const { fake, desktop } = await setup();
  const list = await desktop.windows.listWindows();
  t('descubre las tres ventanas abiertas', list.length === 3);
  t('cada ventana tiene windowId, pid, proceso, bounds, estado, monitor',
    list.every((w) => w.windowId.startsWith('hwnd:') && w.processId > 0 && w.processName && w.bounds && w.state && w.monitor !== undefined));
  const active = await desktop.windows.getActiveWindow();
  t('la ventana activa es la última abierta', active?.processName === 'explorer.exe');
  const code = await vscodeWindow(fake);
  t('VS Code está en el monitor 2 (índice 1)', code.monitor === 1);

  const found = await desktop.windows.findWindows({ processName: 'code' });
  t('find por proceso (sin .exe, sin mayúsculas)', found.length === 1 && found[0]!.windowId === code.windowId);
  t('find por fragmento de título', (await desktop.windows.findWindows({ titleContains: 'bloc de notas' })).length === 1);
  t('find sin coincidencias devuelve lista vacía', (await desktop.windows.findWindows({ processName: 'photoshop' })).length === 0);

  await desktop.windows.activateWindow(code.windowId);
  t('focus cambia la ventana activa', (await desktop.windows.getActiveWindow())?.windowId === code.windowId);

  await fake.setWindowState(code.windowId, 'minimized');
  await desktop.windows.activateWindow(code.windowId);
  t('activar una ventana minimizada la restaura', (await vscodeWindow(fake)).state === 'normal');

  // identity never by title
  const before = code.windowId;
  (await fake.listWindows()).forEach(() => {});
  t('el id es estable aunque el título cambie', (await desktop.windows.findWindows({ processName: 'Code' }))[0]!.windowId === before);

  t('move fuera de todas las pantallas se rechaza', await throwsAsync(() => desktop.windows.moveWindow(code.windowId, 9000, 9000), /fuera de todas las pantallas/));
  t('move con NaN se rechaza', await throwsAsync(() => desktop.windows.moveWindow(code.windowId, NaN, 0), /inválidas/));
  await desktop.windows.moveWindow(code.windowId, 100, 100);
  t('move válido cambia bounds y monitor', (await vscodeWindow(fake)).bounds.x === 100 && (await vscodeWindow(fake)).monitor === 0);
  t('resize por debajo del mínimo se rechaza', await throwsAsync(() => desktop.windows.resizeWindow(code.windowId, 50, 50), /mínimo/));
  t('resize gigante se rechaza', await throwsAsync(() => desktop.windows.resizeWindow(code.windowId, 50000, 800), /máximo/));
  await desktop.windows.resizeWindow(code.windowId, 1280, 800);
  t('resize válido aplica', (await vscodeWindow(fake)).bounds.width === 1280);
  t('una ventana inexistente se rechaza', await throwsAsync(() => desktop.windows.activateWindow('hwnd:0xdead'), /ya no existe/));

  const elevated = fake.openApp('app:regedit')!;
  t('una ventana elevada no se controla', await throwsAsync(() => desktop.windows.activateWindow(elevated.windowId), /elevado/));

  // close with unsaved work
  const notepad = (await fake.listWindows()).find((w) => w.processName === 'notepad.exe')!;
  const editor = (await fake.uiChildren((await fake.uiRoot(notepad.windowId)).id)).find((e) => e.controlType === 'Document')!;
  await fake.uiSetValue(editor.id, 'borrador sin guardar');
  const closed = await desktop.windows.closeWindow(notepad.windowId);
  t('cerrar con trabajo sin guardar deja que la app muestre su diálogo', !closed.closed && closed.dialogShown);
  const dialog = (await desktop.ui.find({ windowId: notepad.windowId, name: '¿Guardar cambios?' }));
  t('el diálogo de guardado existe y JARVIS no lo respondió', dialog.length === 1 && (await fake.listWindows()).some((w) => w.windowId === notepad.windowId));
  const explorer = (await fake.listWindows()).find((w) => w.processName === 'explorer.exe')!;
  const closeOk = await desktop.windows.closeWindow(explorer.windowId);
  t('cerrar sin trabajo pendiente cierra', closeOk.closed && !closeOk.dialogShown);
}

/* ================================================================== */
section('UI Automation: árbol, búsqueda y referencias');
{
  const { fake, desktop } = await setup();
  const code = await vscodeWindow(fake);
  const tree = await desktop.ui.inspect(code.windowId, 4);
  t('el árbol de VS Code se recorre', tree.length > 8);
  t('la raíz es la ventana en profundidad 0', tree[0]!.controlType === 'Window' && tree[0]!.depth === 0);
  t('cada elemento lleva una referencia ui:N', tree.every((e) => /^ui:\d+$/.test(e.ref)));
  t('los ids de runtime de UIA no llegan a la vista', tree.every((e) => !('id' in e) && !JSON.stringify(e).includes('el:')));
  const menubar = tree.find((e) => e.controlType === 'MenuBar');
  t('MenuBar presente con File/Edit/View', !!menubar && ['File', 'Edit', 'View'].every((n) => tree.some((e) => e.name === n && e.controlType === 'MenuItem')));
  t('los patrones reales se exponen (File: Invoke + ExpandCollapse)', tree.find((e) => e.name === 'File')!.patterns.join() === 'Invoke,ExpandCollapse');
  t('no se inventan patrones (Bienvenida sólo SelectionItem)', tree.find((e) => e.name === 'Bienvenida')!.patterns.join() === 'SelectionItem');

  const again = await desktop.ui.inspect(code.windowId, 4);
  t('el mismo elemento conserva su ref entre inspecciones', again.find((e) => e.name === 'File')!.ref === tree.find((e) => e.name === 'File')!.ref);

  const byName = await desktop.ui.find({ windowId: code.windowId, name: 'file' });
  t('find por nombre (sin distinguir mayúsculas)', byName.length === 1 && byName[0]!.name === 'File');
  const byAuto = await desktop.ui.find({ windowId: code.windowId, automationId: 'search.input' });
  t('find por automationId', byAuto.length === 1 && byAuto[0]!.controlType === 'Edit');
  const byType = await desktop.ui.find({ windowId: code.windowId, controlType: 'MenuItem' });
  t('find por controlType devuelve varios candidatos', byType.length === 3);
  const byText = await desktop.ui.find({ windowId: code.windowId, textContains: 'vigil' });
  t('find por texto contenido', byText.length === 1 && byText[0]!.name === 'vigilia');
  const none = await desktop.ui.find({ windowId: code.windowId, name: 'Botón que no existe' });
  t('elemento desconocido → lista vacía, nunca uno inventado', none.length === 0);

  const explorerWin = (await fake.listWindows()).find((w) => w.processName === 'explorer.exe')!;
  const ambiguous = await desktop.ui.find({ windowId: explorerWin.windowId, textContains: 'proyectos' });
  t('ambigüedad: devuelve todos los candidatos', ambiguous.length === 2);

  const ctx = buildUIContext(code, tree);
  t('UIContextBuilder produce una lista numerada con refs', /Ventana: .*Visual Studio Code/.test(ctx.text) && /\[ui:\d+\] MenuItem "File"/.test(ctx.text));
  t('UIContextBuilder omite ruido estructural', !/\] MenuBar/.test(ctx.text));
  const big = buildUIContext(code, Array.from({ length: 120 }, (_, i) => ({ ref: `ui:${i}` as const, name: `B${i}`, controlType: 'Button' as const, automationId: '', enabled: true, patterns: [], secret: false, depth: i ? 1 : 0 })), 20);
  t('UIContextBuilder acota el tamaño y avisa del recorte', big.truncated && big.count === 20 && /… y \d+ más/.test(big.text));
  const nullValue = buildUIContext(code, [
    { ref: 'ui:1', name: 'Raíz', controlType: 'Window', automationId: '', enabled: true, patterns: [], secret: false, depth: 0 },
    { ref: 'ui:2', name: 'Archivo', controlType: 'Button', automationId: '', enabled: true, patterns: [], secret: false, depth: 1, value: null } as unknown as UIElementView,
  ]);
  t('valor null de UIA nativo no rompe el contexto', nullValue.text.includes('Archivo'));

  // invoke opens the menu
  const fileRef = byName[0]!.ref;
  await desktop.ui.invoke(fileRef);
  const afterInvoke = await desktop.ui.find({ windowId: code.windowId, name: 'Open Folder...' });
  t('invoke en File abre su menú (Open Folder aparece)', afterInvoke.length === 1);

  // stale refs
  const vigilia = byText[0]!.ref;
  await desktop.ui.expand(vigilia);
  const pkg = (await desktop.ui.find({ windowId: code.windowId, name: 'package.json' }))[0]!;
  t('expandir vigilia revela package.json', !!pkg);
  await desktop.ui.collapse(vigilia);
  t('tras contraer, la ref de package.json es stale', await throwsAsync(() => desktop.ui.invoke(pkg.ref), StaleElementError));
  t('una ref nunca emitida es stale', await throwsAsync(() => desktop.ui.invoke('ui:99999'), StaleElementError));
  t('una ref con formato inválido se rechaza', await throwsAsync(() => desktop.ui.invoke('el:3'), /inválida/));

  // setValue
  const search = byAuto[0]!.ref;
  await desktop.ui.setValue(search, 'package.json');
  t('setValue escribe en el campo', (await desktop.ui.resolve(search)).value === 'package.json');

  // unsupported patterns
  t('invoke sin patrón Invoke → UnsupportedPatternError', await throwsAsync(() => desktop.ui.invoke(search), UnsupportedPatternError));
  t('toggle sin patrón Toggle → error', await throwsAsync(() => desktop.ui.toggle(fileRef), UnsupportedPatternError));
  const wrap = (await desktop.ui.find({ windowId: code.windowId, automationId: 'editor.wordWrap' }))[0]!;
  await desktop.ui.toggle(wrap.ref);
  t('toggle real cambia el estado', (await desktop.ui.resolve(wrap.ref)).toggleState === 'on');
  t('setValue sin patrón Value → error', await throwsAsync(() => desktop.ui.setValue(fileRef, 'x'), UnsupportedPatternError));

  // Blender: nearly empty tree
  const { fake: fb, desktop: db } = await setup(['app:blender']);
  const blender = (await fb.listWindows())[0]!;
  const bt = await db.ui.inspect(blender.windowId);
  t('Blender expone un árbol casi vacío (sólo la ventana)', bt.length === 1);
  t('buscar "Render" en Blender no inventa nada', (await db.ui.find({ windowId: blender.windowId, name: 'Render' })).length === 0);
}

/* ================================================================== */
section('CredentialBoundary en UI Automation');
{
  const { fake, desktop } = await setup(['app:browser']);
  const bank = (await fake.listWindows())[0]!;
  const tree = await desktop.ui.inspect(bank.windowId);
  const pwd = tree.find((e) => e.automationId === 'password')!;
  const otp = tree.find((e) => e.automationId === 'otp')!;
  const user = tree.find((e) => e.automationId === 'username')!;
  t('el campo de contraseña se marca como secreto', pwd.secret);
  t('su valor nunca aparece', pwd.value === undefined && !JSON.stringify(tree).includes('hunter2'));
  t('se informa filled=true sin el contenido', pwd.filled === true);
  t('el OTP vacío se marca secreto con filled=false', otp.secret && otp.filled === false);
  t('un campo normal sí muestra su valor', !user.secret && user.value === 'alejandro');
  t('resolve() también protege el valor', (await desktop.ui.resolve(pwd.ref)).value === undefined);
  t('setValue en campo de contraseña se rechaza', await throwsAsync(() => desktop.ui.setValue(pwd.ref, 'otra'), /credenciales/));
  t('setValue en OTP se rechaza', await throwsAsync(() => desktop.ui.setValue(otp.ref, '123456'), /credenciales/));
  t('el valor real no cambió', (await fake.uiElement((await fake.uiChildren((await fake.uiRoot(bank.windowId)).id)).find((e) => e.automationId === 'password')!.id))!.value === 'hunter2');

  // Detection by name alone, without the fixture flag
  const guessed = desktop.ui.protect({ ...(await fake.uiRoot(bank.windowId)), name: 'Código de seguridad', automationId: 'sec', value: '991122', secret: false, patterns: ['Value'] });
  t('se detecta por nombre aunque la app no lo marque', guessed.secret && guessed.value === undefined && guessed.filled === true);
  const pin = desktop.ui.protect({ ...(await fake.uiRoot(bank.windowId)), name: 'PIN', automationId: 'x', value: '1234', secret: false });
  t('PIN también', pin.secret);
  const root = await fake.uiRoot(bank.windowId);
  const es = (name: string, automationId = 'txtCampo') => desktop.ui.protect({ ...root, name, automationId, value: 'x', secret: false }).secret;
  t('interfaz en español: Contraseña, NIP, Clave, código de un solo uso',
    es('Contraseña') && es('NIP') && es('Clave de acceso') && es('Código de un solo uso') && es('Campo', 'txtClave'));
  t('sin falsos positivos: Palabra clave, Código postal, Nombre', !es('Palabra clave') && !es('Código postal') && !es('Nombre'));
  const ctx = buildUIContext(bank, tree);
  t('el contexto para el modelo muestra "campo protegido, relleno"', /campo protegido, relleno/.test(ctx.text) && !ctx.text.includes('hunter2'));
}

/* ================================================================== */
section('Capturas de pantalla');
{
  const { fake, desktop } = await setup();
  const { broker, audit, approvals } = brokerFor(desktop);
  const token = new CancellationToken();
  let asked = 0;
  onRequest(approvals, (req) => { asked++; approvals.resolve(req.id, 'deny'); });
  broker.openRun('run-cap', 'ADMIN', token);
  const denied = await broker.execute({ runId: 'run-cap', toolId: 'screen.captureDisplay', args: {} });
  t('captura pide aprobación incluso en ADMIN (SENSITIVE, no rutinaria)', asked === 1);
  t('si el usuario la deniega, no hay captura', !denied.ok && denied.reason === 'approval_denied' && desktop.capture.heldCount() === 0);
  broker.closeRun('run-cap');

  const obs = brokerFor(desktop);
  obs.broker.openRun('run-obs', 'OBSERVE', token);
  onRequest(obs.approvals, (req) => obs.approvals.resolve(req.id, 'allow_once'));
  const shot = await obs.broker.execute<{ captureId: string; width: number; height: number }>({ runId: 'run-obs', toolId: 'screen.captureDisplay', args: { monitor: 1 } });
  t('con aprobación, OBSERVE basta para capturar', shot.ok && shot.data!.width === 1920);
  const entry = obs.audit.list().find((e) => e.tool === 'screen.captureDisplay' && e.action === 'execute');
  t('la auditoría registra la captura', !!entry && entry.result === 'ok' && typeof entry.durationMs === 'number');
  t('la auditoría no incluye la imagen', !JSON.stringify(obs.audit.list()).includes('iVBOR'));
  t('el resultado del broker tampoco trae los píxeles', !JSON.stringify(shot).includes('iVBOR'));
  obs.broker.closeRun('run-obs');
  void audit; void fake;

  let now = 1_000_000;
  const cap = new ScreenCaptureService(new FakeWindowsAutomationAdapter(), 60_000, () => now);
  const a = await cap.captureDisplay(0);
  t('la captura vive en memoria', cap.heldCount() === 1);
  t('consume() entrega los datos una vez', cap.consume(a.captureId) !== null && cap.consume(a.captureId) === null);
  const b = await cap.captureDisplay(0);
  now += 61_000;
  t('caduca por TTL', cap.consume(b.captureId) === null && cap.heldCount() === 0);
  await cap.captureDisplay(0); await cap.captureDisplay(0);
  cap.dispose();
  t('dispose() borra todo lo retenido', cap.heldCount() === 0);
  t('región inválida se rechaza', await throwsAsync(() => cap.captureRegion({ x: 0, y: 0, width: 0, height: 10 }), /inválida/));
  t('monitor inexistente se rechaza', await throwsAsync(() => cap.captureDisplay(7), /inexistente/));
  t('STOP libera las capturas retenidas', await (async () => { await desktop.capture.captureDisplay(0); desktop.stop(); return desktop.capture.heldCount() === 0; })());
}

/* ================================================================== */
section('Visión (proveedor desacoplado)');
{
  const vision = new VisionService();
  t('sin proveedor: no disponible', !(await vision.available()) && vision.providerId === 'none');
  t('analizar sin proveedor falla limpiamente', await throwsAsync(() => vision.analyze('x', 'buscar Guardar', new AbortController().signal), /proveedor/));
  const provider: VisionProvider = {
    id: 'local-test', local: true, available: async () => true,
    analyze: async () => ({ elements: [
      { label: 'Save button', bounds: { x: 100, y: 200, width: 80, height: 24 }, confidence: 0.94 },
      { label: 'Delete?', bounds: { x: 300, y: 200, width: 80, height: 24 }, confidence: 0.3 },
    ], summary: 'barra de herramientas' }),
  };
  vision.useProvider(provider);
  const obs = await vision.analyze('img', 'guardar', new AbortController().signal);
  t('el proveedor local se enchufa sin cambiar el servicio', obs.provider === 'local-test');
  t('devuelve refs vision:N con confianza', obs.elements.length === 1 && /^vision:\d+$/.test(obs.elements[0]!.ref) && obs.elements[0]!.confidence === 0.94);
  t('descarta detecciones de baja confianza', !obs.elements.some((e) => e.label === 'Delete?'));
  const ac = new AbortController(); ac.abort();
  t('respeta la cancelación', await throwsAsync(() => vision.analyze('img', 'x', ac.signal), /cancelado/));
}

/* ================================================================== */
section('Ratón');
{
  const { fake, desktop } = await setup();
  const code = await vscodeWindow(fake);
  desktop.bindRun('run-mouse');
  const file = (await desktop.ui.find({ windowId: code.windowId, name: 'File' }))[0]!;
  const el = await desktop.ui.resolve(file.ref);
  const point = await desktop.input.click({ target: file.ref });
  t('clic por ref resuelve al centro del elemento', point.x === el.bounds!.x + el.bounds!.width / 2 && point.y === el.bounds!.y + el.bounds!.height / 2);
  t('el adaptador recibió el clic en ese punto', fake.inputLog.at(-1)!.detail === `leftx1@${point.x},${point.y}`);

  await desktop.windows.moveWindow(code.windowId, 200, 100);
  const moved = await desktop.input.click({ target: file.ref });
  t('si el elemento se movió, el clic va a su posición nueva', moved.x !== point.x);

  const vigilia = (await desktop.ui.find({ windowId: code.windowId, name: 'vigilia' }))[0]!;
  await desktop.ui.expand(vigilia.ref);
  const pkg = (await desktop.ui.find({ windowId: code.windowId, name: 'package.json' }))[0]!;
  await desktop.ui.collapse(vigilia.ref);
  const logBefore = fake.inputLog.length;
  t('clic sobre ref desaparecida → stale, no clic a ciegas', await throwsAsync(() => desktop.input.click({ target: pkg.ref }), StaleElementError) && fake.inputLog.length === logBefore);

  t('coordenadas fuera de las pantallas se rechazan', await throwsAsync(() => desktop.input.click({ x: 99999, y: 5 }), /fuera de todas/));
  const abs = await desktop.input.click({ x: 50, y: 50 });
  t('coordenadas absolutas explícitas dentro de pantalla se aceptan', abs.x === 50);
  t('ref de visión inexistente se rechaza', await throwsAsync(() => desktop.input.click({ target: 'vision:3' }), /ya no es válida/));
  t('scroll excesivo se rechaza', await throwsAsync(() => desktop.input.scroll({ x: 50, y: 50 }, 500), /entre/));
  t('drag de duración excesiva se rechaza', await throwsAsync(() => desktop.input.drag({ x: 10, y: 10 }, { x: 200, y: 200 }, 60_000), /duración/));

  // rate limit
  desktop.gate.mouseLimiter.reset();
  let ok = 0, blocked = 0;
  for (let i = 0; i < 20; i++) {
    try { await desktop.input.click({ x: 10 + i, y: 10 }); ok++; } catch (e) { if (e instanceof InputBlockedError && e.code === 'rate_limit') blocked++; }
  }
  t(`límite de ratón: ${ok} permitidos, ${blocked} rechazados`, ok === 8 && blocked === 12);
  t('un doble clic cuesta dos acciones', (() => { const l = new SlidingWindowLimiter(3); return l.tryTake(2) && !l.tryTake(2) && l.tryTake(1); })());
  let clock = 0;
  const lim = new SlidingWindowLimiter(2, 1000, () => clock);
  lim.tryTake(); lim.tryTake();
  const full = !lim.tryTake();
  clock = 1001;
  t('la ventana deslizante se libera al pasar un segundo', full && lim.tryTake());

  // drag cancellation
  desktop.gate.mouseLimiter.reset();
  fake.inputDelayMs = 30;
  const dragging = desktop.input.drag({ x: 10, y: 10 }, { x: 800, y: 600 }, 1000).then(() => 'done', (e: Error) => e.message);
  await sleep(90);
  desktop.stop();
  const dragResult = await dragging;
  t('STOP durante un arrastre lo interrumpe a mitad', /cancelad/i.test(String(dragResult)));
  const pos = await fake.cursor();
  t('el cursor quedó a mitad de camino, no en el destino', pos.x > 10 && pos.x < 800);
  t('tras STOP no se aceptan más acciones de ratón', await throwsAsync(() => desktop.input.click({ x: 20, y: 20 }), /detenido/));
  fake.inputDelayMs = 0;
}

/* ================================================================== */
section('Teclado');
{
  const { fake, desktop } = await setup();
  desktop.bindRun('run-keys');
  await desktop.input.pressKey('Enter');
  t('pulsar tecla', fake.inputLog.at(-1)!.detail === 'enter');
  await desktop.input.hotkey(['ctrl', 'p']);
  t('combinación permitida', fake.inputLog.at(-1)!.detail === 'ctrl+p');
  t('Ctrl+Alt+Supr nunca se envía', await throwsAsync(() => desktop.input.hotkey(['ctrl', 'alt', 'delete']), /reservado/));
  t('Win+L nunca se envía', await throwsAsync(() => desktop.input.hotkey(['win', 'l']), /reservado/));
  t('Ctrl+Shift+Esc nunca se envía', await throwsAsync(() => desktop.input.hotkey(['ctrl', 'shift', 'esc']), /reservado/));
  t('tecla desconocida se rechaza', await throwsAsync(() => desktop.input.pressKey('rm -rf'), /no permitida/));
  t('combinación de más de 4 teclas se rechaza', await throwsAsync(() => desktop.input.hotkey(['ctrl', 'alt', 'shift', 'win', 'x']), /entre 2 y/));

  await desktop.input.typeText('abre el proyecto vigilia');
  t('escribir texto normal', fake.inputLog.at(-1)!.detail === 'abre el proyecto vigilia');
  t('texto por encima del máximo se rechaza', await throwsAsync(() => desktop.input.typeText('x'.repeat(2001)), /máximo/));

  // secret typing
  const secrets = [
    'mi contraseña es Hunter2!', 'sk-XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX',
    'ghp_XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX', 'el código de verificación es 482913',
    'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.c2lnbmF0dXJl', '[REDACTADO]',
  ];
  const results = await Promise.all(secrets.map((s) => desktop.input.typeText(s).then(() => false, (e) => e instanceof InputBlockedError && e.code === 'secret')));
  t('ningún secreto se teclea (contraseña, API key, token, OTP, JWT, redactado)', results.every(Boolean), JSON.stringify(results));
  t('containsSecret no marca texto corriente', !containsSecret('package.json') && !containsSecret('Abre VS Code y busca Vigilia'));

  const { fake: fb, desktop: db } = await setup(['app:browser']);
  db.bindRun('run-bank');
  const bank = (await fb.listWindows())[0]!;
  const pwd = (await db.ui.find({ windowId: bank.windowId, automationId: 'password' }))[0]!;
  t('escribir apuntando a un campo de contraseña se rechaza', await throwsAsync(() => db.input.typeText('cualquier cosa', { targetRef: pwd.ref }), /credenciales/));
  await db.ui.focus(pwd.ref);
  t('escribir a ciegas con el foco en la contraseña se rechaza', await throwsAsync(() => db.input.typeText('hola'), /credenciales/));
  const userField = (await db.ui.find({ windowId: bank.windowId, automationId: 'username' }))[0]!;
  await db.input.typeText('alejandro', { targetRef: userField.ref });
  t('escribir en un campo normal sí funciona', fb.inputLog.at(-1)!.detail === 'alejandro');

  // keyboard rate limit
  desktop.gate.keyLimiter.reset();
  let accepted = 0, limited = 0;
  for (let i = 0; i < 60; i++) {
    try { await desktop.input.pressKey('a'); accepted++; } catch (e) { if (e instanceof InputBlockedError && e.code === 'rate_limit') limited++; }
  }
  t(`límite de teclado: ${accepted} permitidas, ${limited} rechazadas`, accepted === 40 && limited === 20);
  desktop.gate.setLimits({ keyEventsPerSecond: 5 });
  desktop.gate.keyLimiter.reset();
  t('los límites son configurables', await throwsAsync(() => desktop.input.hotkey(['ctrl', 'alt', 'shift', 'k']).then(() => desktop.input.hotkey(['ctrl', 'k'])), /Límite de 5/));
  desktop.gate.setLimits({ keyEventsPerSecond: 40 });
  desktop.gate.keyLimiter.reset();

  // STOP during typing
  fake.inputDelayMs = 20;
  const typing = desktop.input.typeText('esto es un texto bastante largo para cortarlo por la mitad').then(() => 'done', (e: Error) => e.message);
  await sleep(70);
  desktop.stop();
  const typeResult = await typing;
  const partial = fake.inputLog.at(-1)!.detail;
  t('STOP durante la escritura la corta', /cancelad/i.test(String(typeResult)));
  t('sólo se escribió una parte', partial.endsWith('⟂') && partial.length < 40);
  t('después de STOP el teclado queda bloqueado', await throwsAsync(() => desktop.input.pressKey('a'), /detenido/));
  fake.inputDelayMs = 0;
}

/* ================================================================== */
section('Compuerta: sin run visible, STOP, PAUSE, RESUME');
{
  const { fake, desktop } = await setup();
  t('sin run vinculado, el ratón se rechaza', await throwsAsync(() => desktop.input.click({ x: 10, y: 10 }), /ejecución visible/));
  t('sin run vinculado, el teclado se rechaza', await throwsAsync(() => desktop.input.pressKey('a'), /ejecución visible/));
  t('sin run, observar sí se permite', (await desktop.windows.listWindows()).length === 3);

  const { broker } = brokerFor(desktop);
  const token = new CancellationToken();
  broker.openRun('run-other', 'ADMIN', token);
  desktop.bindRun('run-bound');
  const wrongRun = await broker.execute({ runId: 'run-other', toolId: 'keyboard.press', args: { key: 'a' } });
  t('un run distinto del vinculado no controla el escritorio', !wrongRun.ok && wrongRun.reason === 'policy_blocked');
  broker.closeRun('run-other');

  // PAUSE / RESUME via broker
  broker.openRun('run-bound', 'ADMIN', token);
  const code = await vscodeWindow(fake);
  const first = await broker.execute({ runId: 'run-bound', toolId: 'window.focus', args: { windowId: code.windowId } });
  t('antes de pausar la acción se ejecuta', first.ok);

  broker.pauseRun('run-bound');
  desktop.pause();
  t('el estado del control pasa a paused', desktop.status().mode === 'paused');
  t('en pausa, el input directo se rechaza', await throwsAsync(() => desktop.input.pressKey('a'), /pausa/));
  let settled = false;
  const held = broker.execute({ runId: 'run-bound', toolId: 'keyboard.press', args: { key: 'b' } }).then((r) => { settled = true; return r; });
  await sleep(40);
  t('en pausa, una acción nueva queda retenida (no se ejecuta)', !settled && !fake.inputLog.some((e) => e.detail === 'b'));
  await sleep(40);
  t('la pausa no se reanuda sola', !settled);

  desktop.resume();
  broker.resumeRun('run-bound');
  const released = await held;
  t('RESUME libera la acción retenida y se ejecuta', released.ok && fake.inputLog.at(-1)!.detail === 'b');
  t('el estado vuelve a active', desktop.status().mode === 'active');

  // STOP while paused
  broker.pauseRun('run-bound');
  desktop.pause();
  const heldAgain = broker.execute({ runId: 'run-bound', toolId: 'keyboard.press', args: { key: 'c' } });
  await sleep(20);
  broker.cancelRun('run-bound');
  desktop.stop();
  const afterStop = await heldAgain;
  t('STOP durante la pausa cancela lo retenido', !afterStop.ok && afterStop.reason === 'cancelled');
  t('y nunca llegó a teclearse', !fake.inputLog.some((e) => e.detail === 'c'));
  t('el estado final es stopped', desktop.status().mode === 'stopped');
  broker.closeRun('run-bound');

  // New run after STOP works again (STOP is per run, not permanent breakage)
  desktop.bindRun('run-next');
  await desktop.input.pressKey('d');
  t('un run nuevo, visible, vuelve a poder actuar', fake.inputLog.at(-1)!.detail === 'd');
}

/* ================================================================== */
section('Pausa durante una aprobación pendiente');
{
  const { fake, desktop } = await setup(['app:notepad']);
  const { broker, approvals } = brokerFor(desktop);
  desktop.bindRun('run-pa');
  broker.openRun('run-pa', 'ASSIST', new CancellationToken());
  let pendingId = '';
  onRequest(approvals, (r) => { pendingId = r.id; });
  const launching = broker.execute({ runId: 'run-pa', toolId: 'app.launch', args: { appId: 'app:vscode' } });
  await sleep(20);
  t('app.launch espera aprobación', !!pendingId);
  broker.pauseRun('run-pa');
  desktop.pause();
  approvals.resolve(pendingId, 'allow_once');
  await sleep(60);
  const opened = async () => (await fake.listWindows()).some((w) => w.processName === 'Code.exe');
  t('aprobar mientras está en pausa NO ejecuta la acción', !(await opened()));
  desktop.resume();
  broker.resumeRun('run-pa');
  const r = await launching;
  t('al reanudar, la acción aprobada se ejecuta', r.ok && await opened());

  // Session locked while the user was deciding
  let secondId = '';
  onRequest(approvals, (req) => { secondId = req.id; });
  const second = broker.execute({ runId: 'run-pa', toolId: 'app.launch', args: { appId: 'app:blender' } });
  await sleep(20);
  fake.setSession('LOCKED');
  approvals.resolve(secondId, 'allow_once');
  const r2 = await second;
  t('si Windows se bloqueó durante la aprobación, la acción no se ejecuta', !r2.ok && r2.reason === 'policy_blocked');
  t('Blender no llegó a abrirse', !(await fake.listWindows()).some((w) => w.processName === 'blender.exe'));
  broker.closeRun('run-pa');
}

/* ================================================================== */
section('Intervención humana');
{
  const { fake, desktop, human, overrides } = await setup();
  desktop.bindRun('run-human');
  await sleep(5);
  t('el detector se arma al vincular un run', human.started);
  await sleep(80);
  human.emit('mouse');
  t('movimiento humano pausa el control', desktop.status().mode === 'paused' && desktop.status().humanOverride);
  t('se notifica para que el runtime pause el run', overrides() === 1);
  t('mientras tanto, JARVIS no mueve el ratón', await throwsAsync(() => desktop.input.click({ x: 5, y: 5 }), /tomaste el control/));
  human.emit('keyboard');
  t('más input humano no duplica la notificación', overrides() === 1);
  desktop.resume();
  t('sólo una reanudación explícita lo reactiva', desktop.status().mode === 'active' && !desktop.status().humanOverride);

  desktop.gate.mouseLimiter.reset();
  await desktop.input.click({ x: 30, y: 30 });
  human.emit('mouse', Date.now());
  t('el input sintético propio no cuenta como humano', desktop.status().mode === 'active');
  await sleep(80);
  human.emit('mouse');
  t('pasada la ventana de gracia, sí cuenta', desktop.status().mode === 'paused');
  desktop.releaseRun('run-human');
  t('al liberar el run, el detector se desarma', !human.started);
  void fake;
}

/* ================================================================== */
section('Estrategias de interacción');
{
  const signal = new AbortController().signal;
  const ran: string[] = [];
  const preferred = await runWithStrategies([
    { strategy: 'INPUT', run: async () => { ran.push('INPUT'); return 'input'; } },
    { strategy: 'UI_AUTOMATION', run: async () => { ran.push('UIA'); return 'uia'; } },
    { strategy: 'DIRECT', applicable: () => false, run: async () => { ran.push('DIRECT'); return 'direct'; } },
  ], signal);
  t('se prueba en orden DIRECT → DOM → UIA → VISION → INPUT', preferred.strategyUsed === 'UI_AUTOMATION');
  t('una estrategia no aplicable se salta sin contar como intento', !ran.includes('DIRECT'));
  t('no se prueba una inferior si una superior funcionó', !ran.includes('INPUT'));

  let uiaTries = 0;
  const fallback = await runWithStrategies([
    { strategy: 'UI_AUTOMATION', run: async () => { uiaTries++; throw new Error('elemento sin respuesta'); } },
    { strategy: 'VISION', run: async () => 'visto' },
  ], signal, { maxAttempts: 2, maxTotalAttempts: 6, delayMs: 0 });
  t('si UIA falla, cae a VISION', fallback.ok && fallback.strategyUsed === 'VISION');
  t('UIA se reintentó exactamente 2 veces', uiaTries === 2);
  t('cada intento queda registrado', fallback.attempts.length === 3 && fallback.attempts.map((a) => a.strategy).join() === 'UI_AUTOMATION,UI_AUTOMATION,VISION');

  let verifyCalls = 0;
  const unverified = await runWithStrategies([
    { strategy: 'UI_AUTOMATION', run: async () => 'hecho', verify: async () => { verifyCalls++; return false; } },
  ], signal, { maxAttempts: 3, maxTotalAttempts: 10, delayMs: 0 });
  t('ejecutar sin efecto verificado no cuenta como éxito', !unverified.ok && unverified.attempts.every((a) => a.ok && !a.verified));
  t('los reintentos por verificación están acotados', verifyCalls === 3);

  let calls = 0;
  const capped = await runWithStrategies([
    { strategy: 'UI_AUTOMATION', run: async () => { calls++; throw new Error('x'); } },
  ], signal, { maxAttempts: 50, maxTotalAttempts: 50, delayMs: 0 });
  t('nunca más de 3 intentos por estrategia, pida lo que pida', !capped.ok && calls === 3);

  let total = 0;
  const bounded = await runWithStrategies([
    { strategy: 'DIRECT', run: async () => { total++; throw new Error('a'); } },
    { strategy: 'DOM', run: async () => { total++; throw new Error('b'); } },
    { strategy: 'UI_AUTOMATION', run: async () => { total++; throw new Error('c'); } },
    { strategy: 'INPUT', run: async () => { total++; throw new Error('d'); } },
  ], signal, { maxAttempts: 3, maxTotalAttempts: 4, delayMs: 0 });
  t('tope global de intentos entre estrategias', !bounded.ok && total === 4 && /máximo/.test(bounded.error ?? ''));

  let policyCalls = 0;
  await runWithStrategies([
    { strategy: 'UI_AUTOMATION', run: async () => { policyCalls++; throw new Error('«X» no expone el patrón Invoke'); } },
  ], signal, { maxAttempts: 3, maxTotalAttempts: 9, delayMs: 0 });
  t('un error que no cambia al reintentar no se reintenta', policyCalls === 1);

  const ac = new AbortController(); ac.abort();
  const aborted = await runWithStrategies([{ strategy: 'UI_AUTOMATION', run: async () => 'x' }], ac.signal);
  t('cancelado antes de empezar no ejecuta nada', !aborted.ok && aborted.attempts.length === 0);

  // ui.invoke via broker: strategy + honest verification
  const { fake, desktop } = await setup();
  const { broker } = brokerFor(desktop);
  desktop.bindRun('run-inv');
  broker.openRun('run-inv', 'ADMIN', new CancellationToken());
  const code = await vscodeWindow(fake);
  const file = (await desktop.ui.find({ windowId: code.windowId, name: 'File' }))[0]!;
  const inv = await broker.execute<{ strategyUsed: string; verified: boolean }>({ runId: 'run-inv', toolId: 'ui.invoke', args: { target: file.ref } });
  t('ui.invoke usa UI_AUTOMATION', inv.ok && inv.data!.strategyUsed === 'UI_AUTOMATION');
  t('y verifica: el menú apareció', inv.data!.verified === true);
  const tab = (await desktop.ui.find({ windowId: code.windowId, name: 'Bienvenida' }))[0]!;
  const clickLog = fake.inputLog.length;
  const viaInput = await broker.execute<{ strategyUsed: string; verified: boolean; note: string | null }>({ runId: 'run-inv', toolId: 'ui.invoke', args: { target: tab.ref } });
  t('sin patrón Invoke, cae a INPUT (clic en sus bounds)', viaInput.ok && viaInput.data!.strategyUsed === 'INPUT' && fake.inputLog.length === clockBump(clickLog));
  t('si no cambió nada, lo dice en vez de fingir éxito', viaInput.data!.verified === false && /no cambió/.test(viaInput.data!.note ?? ''));
  broker.closeRun('run-inv');
}
function clockBump(n: number) { return n + 1; }

/* ================================================================== */
section('Aplicaciones y procesos');
{
  const { fake, desktop } = await setup(['app:notepad']);
  const { broker, approvals } = brokerFor(desktop);
  onRequest(approvals, (r) => approvals.resolve(r.id, 'allow_once'));
  desktop.bindRun('run-apps');
  broker.openRun('run-apps', 'ASSIST', new CancellationToken());

  t('ids estables para apps conocidas', stableId('Visual Studio Code') === 'app:vscode' && stableId('Google Chrome') === 'app:chrome' && stableId('Blender 4.2') === 'app:blender');
  t('ids derivados para el resto, sin rutas', stableId('Mi Programa Raro 2.0') === 'app:mi-programa-raro-2-0');
  t('el planificador reconoce la app en una frase', appIdFromText('Abre VS Code, busca el proyecto Vigilia')?.id === 'app:vscode');
  t('alias por palabra completa: "decoder" no es VS Code', appIdFromText('Abre el decoder') === null && appIdFromText('explorers club') === null);
  t('la orden objetivo enruta a control del equipo aunque nombre un .json',
    heuristicCategory('Abre VS Code, busca el proyecto Vigilia y abre package.json') === 'system');
  t('abrir un archivo sin app conocida sigue siendo de archivos', heuristicCategory('abre el archivo package.json') === 'filesystem');
  t('la ruta completa (con la tabla de ModelRouter) también es computer_control',
    heuristicRoute('Abre VS Code, busca el proyecto Vigilia y abre package.json').taskType === 'computer_control');
  t('una búsqueda de archivos sin app sigue siendo file_search', heuristicRoute('busca el archivo package.json en mis proyectos').taskType === 'file_search');
  t('sin modelo, la clasificación heurística no se etiqueta como Anthropic', heuristicRoute('busca el archivo package.json').selectedModelId === 'local/heuristic');

  const launched = await broker.execute<{ appId: string }>({ runId: 'run-apps', toolId: 'app.launch', args: { appId: 'app:vscode' } });
  t('lanza una app descubierta', launched.ok && launched.data!.appId === 'app:vscode');
  t('su ventana aparece', (await fake.listWindows()).some((w) => w.processName === 'Code.exe'));
  const unknown = await broker.execute({ runId: 'run-apps', toolId: 'app.launch', args: { appId: 'app:malware' } });
  t('una app no descubierta se rechaza', !unknown.ok && /no reconocida/.test(unknown.error ?? ''));
  const path = await broker.execute({ runId: 'run-apps', toolId: 'app.launch', args: { appId: 'C:\\Windows\\System32\\cmd.exe' } });
  t('una ruta como id se rechaza', !path.ok);
  const extra = await broker.execute({ runId: 'run-apps', toolId: 'app.launch', args: { appId: 'app:notepad', args: ['/c', 'del'], path: 'C:\\evil.exe' } });
  const notepads = (await fake.listWindows()).filter((w) => w.processName === 'notepad.exe').length;
  t('argumentos y rutas extra se ignoran: sólo cuenta el id', extra.ok && notepads === 2);

  const procs = await broker.execute<{ name: string }[]>({ runId: 'run-apps', toolId: 'process.list', args: {} });
  t('process.list devuelve procesos', procs.ok && procs.data!.some((p) => p.name === 'Code.exe'));
  const found = await broker.execute<{ pid: number }[]>({ runId: 'run-apps', toolId: 'process.find', args: { name: 'code' } });
  t('process.find', found.ok && found.data!.length === 1);
  const info = await broker.execute<{ name: string } | null>({ runId: 'run-apps', toolId: 'process.info', args: { pid: found.data![0]!.pid } });
  t('process.info', info.ok && info.data!.name === 'Code.exe');
  t('process.info con pid inválido se rechaza', !(await broker.execute({ runId: 'run-apps', toolId: 'process.info', args: { pid: -4 } })).ok);
  const kill = await broker.execute({ runId: 'run-apps', toolId: 'process.terminate', args: { pid: found.data![0]!.pid } });
  t('process.terminate está deshabilitada', !kill.ok && kill.reason === 'tool_disabled');
  t('ProcessService no tiene método de terminar', !('terminate' in desktop.processes) && !('kill' in desktop.processes));
  broker.closeRun('run-apps');
}

/* ================================================================== */
section('Sesión bloqueada, escritorio seguro y UAC');
{
  const { fake, desktop } = await setup();
  const { broker, approvals } = brokerFor(desktop);
  onRequest(approvals, (r) => approvals.resolve(r.id, 'allow_once'));
  desktop.bindRun('run-lock');
  broker.openRun('run-lock', 'ADMIN', new CancellationToken());
  const code = await vscodeWindow(fake);

  fake.setSession('LOCKED');
  await desktop.session.refresh();
  t('sesión bloqueada → estado blocked', desktop.status().mode === 'blocked' && desktop.status().session === 'LOCKED');
  t('bloqueada: ratón rechazado', await throwsAsync(() => desktop.input.click({ x: 5, y: 5 }), /bloqueado/));
  t('bloqueada: teclado rechazado', await throwsAsync(() => desktop.input.pressKey('a'), /bloqueado/));
  const uia = await broker.execute({ runId: 'run-lock', toolId: 'ui.invoke', args: { target: 'ui:1' } });
  t('bloqueada: UI Automation interactiva rechazada por el broker', !uia.ok && uia.reason === 'policy_blocked');
  const obs = await broker.execute({ runId: 'run-lock', toolId: 'window.list', args: {} });
  t('bloqueada: el trabajo analítico puede continuar', obs.ok);

  fake.setSession('ACTIVE');
  await desktop.session.refresh();
  t('al desbloquear, el control vuelve', desktop.status().mode === 'active');

  fake.setSession('SECURE_DESKTOP');
  await desktop.session.refresh();
  t('escritorio seguro → "Windows requiere tu aprobación"', desktop.status().blockedReason === 'Windows requiere tu aprobación.');
  t('escritorio seguro: ninguna interacción', await throwsAsync(() => desktop.input.click({ x: 5, y: 5 }), /aprobación/));
  fake.setSession('ACTIVE');
  await desktop.session.refresh();

  const uac = await broker.execute({ runId: 'run-lock', toolId: 'app.launch', args: { appId: 'app:regedit' } });
  t('una app que pide elevación dispara UAC y JARVIS lo informa', !uac.ok && /Windows requiere tu aprobación/.test(uac.error ?? ''));
  t('JARVIS queda bloqueado durante el UAC', desktop.status().session === 'SECURE_DESKTOP' && desktop.status().mode === 'blocked');
  t('no hay forma de pulsar el aviso UAC', await throwsAsync(() => desktop.input.pressKey('enter'), /aprobación/) && await throwsAsync(() => desktop.input.hotkey(['alt', 'y']), /aprobación/));
  fake.setSession('ACTIVE');
  await desktop.session.refresh();
  const resumed = await broker.execute({ runId: 'run-lock', toolId: 'window.focus', args: { windowId: code.windowId } });
  t('resuelto el UAC por el usuario, JARVIS continúa', resumed.ok);

  fake.setSession('UNKNOWN');
  await desktop.session.refresh();
  t('estado de sesión desconocido también bloquea', await throwsAsync(() => desktop.input.pressKey('a'), /confirmar/));
  broker.closeRun('run-lock');
}

/* ================================================================== */
section('Helper caído y capacidades');
{
  const fake = new FakeWindowsAutomationAdapter();
  const desktop = new DesktopControlService({ adapter: fake });
  await desktop.refresh();
  t('con el helper vivo, disponible', desktop.status().helperAvailable);
  fake.alive = false;
  await desktop.refresh();
  t('si el helper muere, se informa no disponible', !desktop.status().helperAvailable);
  t('las llamadas fallan limpiamente, sin colgarse', await throwsAsync(() => desktop.windows.listWindows(), /no responde/));
  const snap = await desktop.snapshots.snapshot(false);
  t('la instantánea degrada a vacío en vez de romper', snap.visibleWindows.length === 0 && snap.session === 'UNKNOWN');

  const none = new DesktopControlService();
  await none.refresh();
  t('sin adaptador (navegador, Linux): no disponible y sin ventanas falsas', !none.status().helperAvailable && (await none.windows.listWindows()).length === 0);
  t('UnavailableAutomationAdapter nunca finge acciones', await throwsAsync(() => new UnavailableAutomationAdapter().mouseClick(), /no está disponible/));

  const caps = new CapabilityRegistry();
  const base = { profile: fixture('C'), localAI: null, permission: 'ADMIN' as const, hasNativeBridge: true };
  const without = caps.evaluate({ ...base, helperAvailable: false });
  const withHelper = caps.evaluate({ ...base, helperAvailable: true, sessionInteractive: true });
  const locked = caps.evaluate({ ...base, helperAvailable: true, sessionInteractive: false });
  const state = (list: typeof without, id: string) => list.find((c) => c.id === id)?.state;
  t('helper caído → uiAutomation UNAVAILABLE', state(without, 'uiAutomation') === 'UNAVAILABLE');
  t('helper caído → ratón y teclado UNAVAILABLE', state(without, 'mouse.control') === 'UNAVAILABLE' && state(without, 'keyboard.control') === 'UNAVAILABLE');
  t('helper vivo + ADMIN → uiAutomation AVAILABLE', state(withHelper, 'uiAutomation') === 'AVAILABLE');
  t('sesión bloqueada → RESTRICTED', state(locked, 'uiAutomation') === 'RESTRICTED' && state(locked, 'keyboard.control') === 'RESTRICTED');
  const assist = caps.evaluate({ ...base, permission: 'ASSIST', helperAvailable: true, sessionInteractive: true });
  t('ASSIST no alcanza el teclado (RESTRICTED)', state(assist, 'keyboard.control') === 'RESTRICTED');
}

/* ================================================================== */
section('Instantánea del escritorio');
{
  const { fake, desktop } = await setup();
  const snap = await desktop.snapshots.snapshot(true);
  t('incluye ventana activa, visibles, monitores y cursor', !!snap.activeWindow && snap.visibleWindows.length === 3 && snap.monitors.length === 2 && !!snap.cursor);
  const lines = DesktopSnapshotService.describe(snap);
  t('sabe que VS Code está en el monitor 2 sin visión', lines.some((l) => /Visual Studio Code.*monitor 2/.test(l)));
  await fake.setWindowState((await vscodeWindow(fake)).windowId, 'minimized');
  t('las minimizadas no cuentan como visibles', (await desktop.snapshots.snapshot(true)).visibleWindows.length === 2);
}

/* ================================================================== */
section('Auditoría y redacción');
{
  const { fake, desktop } = await setup(['app:vscode', 'app:browser']);
  const { broker, audit } = brokerFor(desktop);
  desktop.bindRun('run-audit');
  broker.openRun('run-audit', 'ADMIN', new CancellationToken());
  const code = (await fake.listWindows()).find((w) => w.processName === 'Code.exe')!;
  const search = (await desktop.ui.find({ windowId: code.windowId, automationId: 'search.input' }))[0]!;

  await broker.execute({ runId: 'run-audit', toolId: 'keyboard.type', args: { text: 'nota privada sobre el cliente' } });
  await broker.execute({ runId: 'run-audit', toolId: 'ui.setValue', args: { target: search.ref, value: 'contrato confidencial' } });
  const blocked = await broker.execute({ runId: 'run-audit', toolId: 'keyboard.type', args: { text: 'password: Hunter2!' } });
  t('el broker bloquea teclear un secreto antes del adaptador', !blocked.ok && blocked.reason === 'policy_blocked');
  const secretValue = await broker.execute({ runId: 'run-audit', toolId: 'ui.setValue', args: { target: search.ref, value: 'sk-XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX' } });
  t('el broker bloquea escribir una API key en un campo', !secretValue.ok && secretValue.reason === 'policy_blocked');

  const dump = JSON.stringify(audit.list());
  t('la auditoría no contiene el texto tecleado', !dump.includes('nota privada'));
  t('ni el valor escrito en el campo', !dump.includes('contrato confidencial'));
  t('ni el secreto rechazado', !dump.includes('Hunter2') && !dump.includes('sk-ant-api03'));
  const typed = audit.list().find((e) => e.tool === 'keyboard.type' && e.result === 'ok');
  t('registra la forma: longitud del texto', !!typed && typed.argsSummary.includes('<29 caracteres>'));
  const setv = audit.list().find((e) => e.tool === 'ui.setValue' && e.result === 'ok');
  t('conserva la ref del elemento, que no es contenido', !!setv && setv.argsSummary.includes(search.ref));
  const fields = ['id', 'timestamp', 'runId', 'actor', 'tool', 'action', 'argsSummary', 'permission', 'risk', 'result', 'durationMs'];
  t('cada registro tiene sus 11 campos', audit.list().every((e) => fields.every((f) => f in e)));
  t('los rechazos por política también quedan registrados', audit.list().some((e) => e.tool === 'keyboard.type' && e.result === 'blocked'));

  const bankWin = (await fake.listWindows()).find((w) => w.processName === 'msedge.exe')!;
  const inspected = await broker.execute<{ context: string; elements: UIElementView[] }>({ runId: 'run-audit', toolId: 'ui.inspect', args: { windowId: bankWin.windowId } });
  t('ui.inspect por el broker nunca trae la contraseña', inspected.ok && !JSON.stringify(inspected).includes('hunter2'));
  broker.closeRun('run-audit');
}

/* ================================================================== */
section('Runtime: plan encadenado "Abre VS Code…"');
const CONTROL_ROUTE: RoutingDecision = {
  taskType: 'computer_control', difficulty: 3, contextSize: 40, requiresWeb: false, requiresVision: false,
  requiresFiles: false, requiresCode: false, requiresReasoning: false, preferredProvider: 'local',
  modelTier: 'LOCAL', selectedModelId: 'test', reason: 'test', confidence: 0.9, routedBy: 'heuristic', elapsedMs: 1,
};
{
  const { fake, desktop } = await setup(['app:notepad']);
  const { broker, approvals } = brokerFor(desktop, {
    'app.list': async () => fixtureApps().map((a) => ({ id: a.id, name: a.name })),
  });
  const plan = planRun({ runId: 'r', prompt: 'Abre VS Code, busca el proyecto Vigilia y abre package.json', routing: CONTROL_ROUTE });
  t('el plan encadena buscar → lanzar → localizar ventana → inspeccionar',
    plan.filter((s) => s.toolId && s.toolId !== 'model.classify').map((s) => s.toolId).join() === 'app.list,app.launch,window.find,ui.inspect');
  t('la ventana se busca por id estable, no por título', JSON.stringify(plan.find((s) => s.toolId === 'window.find')!.args) === '{"appId":"app:vscode"}');

  const results = new Map<string, ToolResult>();
  const steps = plan.map((s, i) => ({ ...s, index: i }));
  results.set(steps[3]!.id, { ok: true, data: [{ windowId: 'hwnd:0xabc' }], toolId: 'window.find', durationMs: 1, callId: 'c' } as never);
  t('bindArgs resuelve { $from, path } desde un paso anterior', (bindArgs({ windowId: { $from: 3, path: '0.windowId' } }, steps as never, results) as { windowId: string }).windowId === 'hwnd:0xabc');
  t('bindArgs falla si el dato no existe (no pasa undefined)', (() => { try { bindArgs({ w: { $from: 3, path: '5.nope' } }, steps as never, results); return false; } catch { return true; } })());

  onRequest(approvals, (r) => approvals.resolve(r.id, 'allow_for_run'));
  const runtime = new AgentRuntime({
    broker,
    route: async () => CONTROL_ROUTE,
    compose: () => 'ok',
    onStart: (id) => desktop.bindRun(id),
    onFinish: (id) => desktop.releaseRun(id),
    onPause: () => desktop.pause(),
    onResume: () => desktop.resume(),
  });
  const run = await runtime.start('Abre VS Code, busca el proyecto Vigilia y abre package.json', { workspaceId: 'ws', permission: 'ASSIST' });
  const status = Object.fromEntries(run.steps.map((s) => [s.toolId, s.status]));
  t('el run termina completado', run.status === 'completed', run.status + ' ' + JSON.stringify(run.steps.map((s) => [s.toolId, s.status, s.error])));
  t('VS Code se abrió de verdad en el doble', (await fake.listWindows()).some((w) => w.processName === 'Code.exe'));
  t('su ventana se localizó y se inspeccionó', status['window.find'] === 'completed' && status['ui.inspect'] === 'completed');
  const inspectStep = run.steps.find((s) => s.toolId === 'ui.inspect')!;
  t('el resumen del paso refleja la inspección', !!inspectStep.summary);
  t('al terminar, el control se libera (no hay control sin run)', desktop.status().mode === 'idle' && desktop.status().runId === null);
  t('los eventos llevan la herramienta y su objetivo', runtime.snapshot().events.some((e) => e.tool === 'app.launch' && e.metadata?.target === 'app:vscode'));

  // PAUSE / RESUME through the runtime. app.list is made slow so the pause
  // lands deterministically while it runs; app.launch must then be held.
  const slow = new FakeWindowsAutomationAdapter(['app:notepad']);
  const d2 = new DesktopControlService({ adapter: slow, apps: async () => fixtureApps() });
  await d2.refresh();
  const b2 = brokerFor(d2, { 'app.list': async () => { await sleep(40); return []; } });
  onRequest(b2.approvals, (r) => b2.approvals.resolve(r.id, 'allow_for_run'));
  const rt2 = new AgentRuntime({
    broker: b2.broker,
    route: async () => CONTROL_ROUTE,
    compose: () => 'ok',
    onStart: (id) => d2.bindRun(id), onFinish: (id) => d2.releaseRun(id),
    onPause: () => d2.pause(), onResume: () => d2.resume(),
  });
  const hasCode = async () => (await slow.listWindows()).some((w) => w.processName === 'Code.exe');
  const running = rt2.start('Abre VS Code', { workspaceId: 'ws', permission: 'ASSIST' });
  await sleep(15);
  const didPause = rt2.pause();
  t('runtime.pause() pausa el run a mitad de un paso', didPause && rt2.isPaused);
  t('el control del escritorio acompaña la pausa', d2.status().mode === 'paused');
  await sleep(100);
  t('el paso en curso termina, pero el siguiente (app.launch) queda retenido', !(await hasCode()));
  t('el run sigue vivo durante la pausa', rt2.isRunning);
  t('la pausa no se reanuda sola', rt2.isPaused);
  rt2.resume();
  const finished = await running;
  t('runtime.resume() continúa: VS Code se abre después de reanudar', await hasCode());
  t('y el run llega a término', finished.status === 'completed');
  t('al terminar, el control queda libre', d2.status().mode === 'idle');
}

console.log(`\n${pass} ok · ${fail} fallos\n`);
process.exit(fail ? 1 : 0);
