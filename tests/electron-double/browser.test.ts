import { View } from 'electron';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { TabManager } from '../../electron/browser/TabManager';
import { PROFILES, sessionFor } from '../../electron/browser/profiles';
import { normalizeInput, titleFromUrl } from '../../src/services/browser/omnibox';

fs.rmSync(path.join(os.tmpdir(), 'jarvis-test-userdata'), { recursive: true, force: true });

let pass = 0, fail = 0;
const t = (name: string, cond: boolean, extra = '') => {
  if (cond) { pass++; console.log('  ok  ', name); }
  else { fail++; console.log('  FAIL', name, extra); }
};

/* Ventana falsa: sólo lo que TabManager toca. */
const contentView = new View();
const sent: { channel: string; payload: unknown }[] = [];
const win = {
  contentView,
  isDestroyed: () => false,
  webContents: { send: () => {} },
} as never;

const manager = new TabManager(win, { send: (channel, payload) => sent.push({ channel, payload }) });
const wc = (id: string) => {
  const tab = (manager as never as { tabs: { id: string; view: { webContents: never } }[] }).tabs.find((x) => x.id === id);
  return tab!.view.webContents as never as {
    _commit(url: string, push?: boolean): void;
    openHandler: ((d: { url: string; disposition: string }) => unknown) | null;
    emit(event: string, ...args: unknown[]): boolean;
    navigationHistory: { canGoBack(): boolean; canGoForward(): boolean };
  };
};

console.log('\n— Omnibox —');
t('dominio desnudo → https', normalizeInput('github.com').url === 'https://github.com/'.slice(0, -1) || normalizeInput('github.com').url === 'https://github.com', normalizeInput('github.com').url);
t('esquema explícito intacto', normalizeInput('http://a.dev/x').url === 'http://a.dev/x');
t('localhost con puerto', normalizeInput('localhost:5273').url === 'http://localhost:5273', normalizeInput('localhost:5273').url);
t('ip local', normalizeInput('127.0.0.1:8080').kind === 'url');
t('una palabra → búsqueda', normalizeInput('electron').kind === 'search');
t('búsqueda se codifica', normalizeInput('a b').url.includes('a%20b') || normalizeInput('a b').url.includes('a+b'), normalizeInput('a b').url);
t('verbo → orden', normalizeInput('analiza nvidia').kind === 'command');
t('frase larga → orden', normalizeInput('cual es el precio de las acciones hoy').kind === 'command');
t('about:blank es url', normalizeInput('about:blank').kind === 'url');
t('motor configurable', normalizeInput('gatos', 'google').url.startsWith('https://www.google.com'));
t('título desde url', titleFromUrl('https://www.electronjs.org/docs') === 'electronjs.org', titleFromUrl('https://www.electronjs.org/docs'));

console.log('\n— Perfiles —');
t('cuatro perfiles', PROFILES.length === 4, String(PROFILES.length));
t('todas las particiones persisten', PROFILES.every((p) => p.partition.startsWith('persist:')));
t('particiones únicas', new Set(PROFILES.map((p) => p.partition)).size === 4);
t('la sesión se reutiliza', sessionFor('personal') === sessionFor('personal'));
t('perfiles distintos, sesiones distintas', sessionFor('personal') !== sessionFor('trading'));

console.log('\n— Ciclo de vida de pestañas —');
manager.setVisible(true);
manager.setBounds({ x: 204, y: 78, width: 1000, height: 700 });

manager.create('electronjs.org', 'ws-personal');
let snap = manager.snapshot();
const a = snap.tabs[0]!;
t('se crea una pestaña', snap.tabs.length === 1);
t('la url se normaliza', a.url === 'https://electronjs.org', a.url);
t('queda activa', snap.activeId === a.id);
t('perfil por defecto', a.profileId === 'personal');
t('la vista se adjunta a la ventana', contentView.children.length === 1);
t('la vista recibe los bounds', JSON.stringify(contentView.children[0]!.getBounds()) === JSON.stringify({ x: 204, y: 78, width: 1000, height: 700 }));

manager.create('https://investor.nvidia.com', 'ws-personal', 'trading');
snap = manager.snapshot();
const b = snap.tabs[1]!;
t('segunda pestaña', snap.tabs.length === 2);
t('respeta el perfil pedido', b.profileId === 'trading');
t('sólo la activa está adjunta', contentView.children.length === 1);

manager.create('https://tradingview.com', 'ws-personal', 'trading', { background: true });
t('la de fondo no roba el foco', manager.snapshot().activeId === b.id);
t('siguen 3 pestañas', manager.snapshot().tabs.length === 3);

manager.activate(a.id);
t('activar cambia la activa', manager.snapshot().activeId === a.id);
t('sigue habiendo una sola vista adjunta', contentView.children.length === 1);

console.log('\n— Navegación —');
manager.navigate(a.id, 'zustand.docs.pmnd.rs');
let tabA = manager.snapshot().tabs.find((x) => x.id === a.id)!;
t('navega a la nueva url', tabA.url === 'https://zustand.docs.pmnd.rs', tabA.url);
t('ahora puede ir atrás', tabA.canGoBack);
manager.back(a.id);
tabA = manager.snapshot().tabs.find((x) => x.id === a.id)!;
t('atrás vuelve a la anterior', tabA.url === 'https://electronjs.org', tabA.url);
t('y habilita adelante', tabA.canGoForward);
manager.forward(a.id);
tabA = manager.snapshot().tabs.find((x) => x.id === a.id)!;
t('adelante avanza', tabA.url === 'https://zustand.docs.pmnd.rs', tabA.url);

console.log('\n— Estado de la página —');
wc(a.id).emit('page-title-updated', {}, 'Zustand · documentación');
t('el título real llega al estado', manager.snapshot().tabs.find((x) => x.id === a.id)!.title === 'Zustand · documentación');
wc(a.id).emit('page-favicon-updated', {}, ['https://zustand.docs.pmnd.rs/favicon.ico']);
t('el favicon llega al estado', manager.snapshot().tabs.find((x) => x.id === a.id)!.favicon === 'https://zustand.docs.pmnd.rs/favicon.ico');
wc(a.id).emit('did-start-loading');
t('indicador de carga activo', manager.snapshot().tabs.find((x) => x.id === a.id)!.loading);
wc(a.id).emit('did-stop-loading');
t('indicador de carga apagado', !manager.snapshot().tabs.find((x) => x.id === a.id)!.loading);
wc(a.id).emit('did-fail-load', {}, -105, 'ERR_NAME_NOT_RESOLVED', 'https://nope.invalid', true);
t('el fallo de carga se registra', manager.snapshot().tabs.find((x) => x.id === a.id)!.error?.code === -105);
wc(a.id).emit('did-fail-load', {}, -3, 'ERR_ABORTED', '', true);
t('un stop del usuario no es un error', manager.snapshot().tabs.find((x) => x.id === a.id)!.error?.code === -105);

console.log('\n— Ventanas emergentes —');
const before = manager.snapshot().tabs.length;
wc(a.id).openHandler?.({ url: 'https://popup.example.com/x', disposition: 'foreground-tab' });
t('el popup se convierte en pestaña', manager.snapshot().tabs.length === before + 1);
t('hereda el perfil de origen', manager.snapshot().tabs.at(-1)!.profileId === 'personal');
const denied = wc(a.id).openHandler?.({ url: 'https://popup.example.com/y', disposition: 'new-window' }) as { action: string };
t('nunca se abre una ventana real', denied.action === 'deny');

console.log('\n— Cambio de perfil —');
const beforeSwitch = manager.snapshot().tabs.findIndex((x) => x.id === b.id);
const countBefore = manager.snapshot().tabs.length;
manager.setProfile(b.id, 'work');
const afterTabs = manager.snapshot().tabs;
const moved = afterTabs[beforeSwitch]!;
t('la pestaña conserva su posición', moved.url === 'https://investor.nvidia.com', `índice ${beforeSwitch}: ${moved.url}`);
t('no se pierde ni se duplica ninguna pestaña', afterTabs.length === countBefore, `${afterTabs.length} vs ${countBefore}`);
t('la vieja pestaña ya no existe', !afterTabs.some((x) => x.id === b.id));
t('cambia de perfil', moved.profileId === 'work');
t('conserva la url', moved.url === 'https://investor.nvidia.com', moved.url);
t('recibe un id nuevo (sesión nueva)', moved.id !== b.id);

console.log('\n— Cierre —');
const activeBefore = manager.snapshot().activeId!;
manager.close(activeBefore);
t('la pestaña se cierra', !manager.snapshot().tabs.some((x) => x.id === activeBefore));
t('la activa cae en otra', manager.snapshot().activeId !== activeBefore && manager.snapshot().activeId !== null);
t('sigue habiendo exactamente una vista adjunta', contentView.children.length === 1);

while (manager.snapshot().tabs.length) manager.close(manager.snapshot().tabs[0]!.id);
t('sin pestañas, sin activa', manager.snapshot().activeId === null);
t('sin pestañas, ninguna vista adjunta', contentView.children.length === 0);

console.log('\n— Layout —');
manager.create('https://a.dev', 'ws-personal');
manager.setVisible(false);
t('oculto = vista desmontada', contentView.children.length === 0);
manager.setVisible(true);
t('visible = vista montada', contentView.children.length === 1);
manager.setBounds({ x: 0, y: 0, width: 0, height: 0 });
t('bounds vacíos desmontan la vista', contentView.children.length === 0);
manager.setBounds({ x: 10, y: 20, width: 800, height: 600 });
t('bounds válidos la remontan', contentView.children.length === 1);
t('los bounds se redondean y aplican', contentView.children[0]!.getBounds()!.width === 800);

console.log('\n— Historial y marcadores —');
const hist = manager.historyEntries();
t('el historial registró las visitas', hist.length > 0, String(hist.length));
t('las entradas llevan perfil', hist.every((h) => Boolean(h.profileId)));
t('el historial busca', manager.historyEntries('zustand').length > 0);
t('la búsqueda descarta lo demás', manager.historyEntries('xyz-no-existe').length === 0);
const live = manager.snapshot().tabs[0]!;
manager.addBookmark(live.id, 'Pruebas');
t('se añade un marcador', manager.bookmarkList().length === 1);
manager.addBookmark(live.id, 'Pruebas');
t('no se duplica', manager.bookmarkList().length === 1);
manager.removeBookmark(manager.bookmarkList()[0]!.id);
t('se elimina', manager.bookmarkList().length === 0);

console.log('\n— Permisos —');
const ses = sessionFor('personal') as never as { permissionRequestHandler: (wc: unknown, p: string, cb: (v: boolean) => void) => void };
let granted: boolean | null = null;
const fakeWc = { getURL: () => 'https://a.dev/page' };
ses.permissionRequestHandler(fakeWc, 'geolocation', (v) => { granted = v; });
t('por defecto se deniega', granted === false);
manager.setPermission('https://a.dev', 'geolocation', true, 'personal');
ses.permissionRequestHandler(fakeWc, 'geolocation', (v) => { granted = v; });
t('tras autorizar, se concede', granted === true);
ses.permissionRequestHandler(fakeWc, 'notifications', (v) => { granted = v; });
t('la autorización no se contagia a otro permiso', granted === false);

console.log('\n— Inspección de sólo lectura —');
const text = await manager.pageText(live.id);
t('getPageText devuelve texto', text.length > 0);
const shot = await manager.screenshot(live.id);
t('getScreenshot devuelve data url', shot.startsWith('data:image/png'));

console.log('\n— Persistencia —');
manager.dispose();
const file = path.join(os.tmpdir(), 'jarvis-test-userdata', 'browser', 'history.json');
t('el historial se escribe en disco', fs.existsSync(file));
t('el json es válido', JSON.parse(fs.readFileSync(file, 'utf8')).length > 0);
t('dispose cierra todas las pestañas', manager.snapshot().tabs.length === 0);

console.log('\n— Difusión de estado —');
t('se emitió estado al renderer', sent.some((m) => m.channel === 'state'));

console.log(`\n${pass} ok · ${fail} fallos\n`);
process.exit(fail ? 1 : 0);
