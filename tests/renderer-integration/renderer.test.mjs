import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { build, serve, OUT_DIR } from './build.mjs';

const SHOTS = path.join(OUT_DIR, 'shots');
fs.mkdirSync(SHOTS, { recursive: true });

let pass = 0, fail = 0;
const failures = [];
const t = (name, cond, extra = '') => {
  if (cond) { pass++; console.log('  ok  ', name); }
  else { fail++; failures.push(`${name} ${extra}`); console.log('  FAIL', name, extra); }
};
const section = (s) => console.log(`\n— ${s} —`);

/** A crashing section must not abort the rest of the run. */
const ONLY = process.env.ONLY ? new RegExp(process.env.ONLY) : null;
async function run(name, fn) {
  if (ONLY && !ONLY.test(name)) return;
  section(name);
  try { await fn(); }
  catch (e) { fail++; failures.push(`${name} (excepción)`); console.log('  FAIL sección lanzó:', String(e).split('\n')[0]); }
}

build();
const { server, url } = await serve();
const browser = await chromium.launch({ args: ['--no-sandbox'] });

/** What an already-configured install looks like on disk. */
const COMPLETED_FIRST_RUN = JSON.stringify({
  completed: true, completedAt: Date.now(), version: 1,
  permissionPreset: 'ASSIST', sessionPolicy: 'keep', localAIChoice: 'skipped', fingerprint: null,
});

/**
 * Fresh page with error capture, seeded as an existing install so the shell is
 * what renders. Onboarding gets its own helper — see firstRunPage.
 */
async function newPage(viewport = { width: 1366, height: 768 }) {
  const page = await browser.newPage({ viewport });
  page.__errors = [];
  page.on('pageerror', (e) => page.__errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') page.__errors.push('console: ' + m.text()); });
  await page.addInitScript((value) => {
    try { localStorage.setItem('jarvis.firstRun', value); } catch { /* sin storage */ }
  }, COMPLETED_FIRST_RUN);
  await page.goto(url, { waitUntil: 'load' });
  await page.waitForSelector('#root > *', { timeout: 10000 });
  await page.waitForTimeout(250);
  return page;
}

const uiState = (page, key) => page.evaluate((k) => window.__harness.stores.useUIStore.getState()[k], key);
const jarvisState = (page, k) => page.evaluate((k) => {
  const s = window.__harness.stores.useJarvisStore.getState();
  return typeof s[k] === 'function' ? null : s[k];
}, k);
const notBlank = async (page) => (await page.evaluate(() => document.getElementById('root').innerHTML.length)) > 1000;

/* ================================================================== */
await run('Render inicial', async () => {
  const page = await newPage();
  t('el árbol se monta', await notBlank(page));
  t('sin errores de página', page.__errors.length === 0, page.__errors.slice(0, 2).join(' | '));
  t('el saludo de Home aparece', (await page.locator('body').innerText()).includes('Alejandro'));
  t('el sidebar lista los módulos', await page.getByText('Markets', { exact: true }).first().isVisible());
  t('no hay error boundary activado', (await page.locator('[data-testid="error-boundary"]').count()) === 0);
  await page.screenshot({ path: path.join(SHOTS, '01-home.png') });
  await page.close();
});

await run('Navegación entre módulos', async () => {
  const page = await newPage();
  const modules = ['Browser', 'Markets', 'Trading', 'Research', 'Projects', 'Coding', 'Files', 'Vault', 'Storage', 'Automations', 'History', 'Settings'];
  let ok = 0;
  for (const label of modules) {
    await page.getByRole('button', { name: label, exact: true }).first().click();
    await page.waitForTimeout(120);
    const mod = await uiState(page, 'module');
    if (mod === label.toLowerCase() && await notBlank(page)) ok += 1;
    else console.log(`      (${label} -> ${mod})`);
  }
  t('los 12 módulos navegan y renderizan', ok === modules.length, `${ok}/${modules.length}`);
  t('ninguno dejó la app en blanco', await notBlank(page));
  t('ningún módulo lanzó al error boundary', (await page.locator('[data-testid="error-boundary"]').count()) === 0);
  t('sin errores acumulados', page.__errors.length === 0, page.__errors.slice(0, 2).join(' | '));
  await page.screenshot({ path: path.join(SHOTS, '02-settings.png') });
  await page.close();
});

await run('Workspaces', async () => {
  const page = await newPage();
  const before = await page.evaluate(() => window.__harness.stores.useWorkspaceStore.getState().activeId);
  await page.getByRole('button', { name: 'Cambiar workspace' }).click();
  await page.waitForTimeout(150);
  await page.waitForTimeout(200);
  // Sin Tailwind compilado no hay z-index ni posicionamiento absoluto, así que
  // el desplegable queda solapado por el nav y un clic real impacta debajo. El
  // solapamiento es del arnés, no del producto: se despacha el evento sobre el
  // nodo correcto para probar la lógica, no el stacking.
  const option = page.getByRole('button', { name: 'Trading', exact: true }).first();
  if (await option.count()) await option.dispatchEvent('click');
  await page.waitForTimeout(250);
  const after = await page.evaluate(() => window.__harness.stores.useWorkspaceStore.getState().activeId);
  t('el workspace cambia', after !== before, `${before} -> ${after}`);
  t('la app sigue viva', await notBlank(page));

  const bogus = await page.evaluate(() => {
    try { window.__harness.stores.useWorkspaceStore.getState().setActive('ws-inexistente'); return 'sin-lanzar'; }
    catch (e) { return 'lanzó: ' + e.message; }
  });
  await page.waitForTimeout(150);
  t('un workspace inexistente no rompe la UI', bogus === 'sin-lanzar' && await notBlank(page), bogus);
  t('sin errores tras el workspace inválido', page.__errors.length === 0, page.__errors.slice(0, 2).join(' | '));
  await page.close();
});

await run('Atajos de teclado', async () => {
  const page = await newPage();
  await page.keyboard.press('Alt+Space');
  await page.waitForTimeout(150);
  t('Alt+Space abre la paleta', await uiState(page, 'paletteOpen'));
  t('la paleta está en el DOM una sola vez',
    (await page.getByPlaceholder('Busca, ordena o pregunta').count()) === 1,
    String(await page.getByPlaceholder('Busca, ordena o pregunta').count()));
  await page.screenshot({ path: path.join(SHOTS, '03-palette.png') });
  await page.keyboard.press('Escape');
  await page.waitForTimeout(150);
  t('Escape cierra la paleta', !(await uiState(page, 'paletteOpen')));
  t('la paleta se desmonta del DOM', (await page.getByPlaceholder('Busca, ordena o pregunta').count()) === 0);

  await page.keyboard.press('Control+l');
  await page.waitForTimeout(120);
  const focused = await page.evaluate(() => document.activeElement?.getAttribute('placeholder') ?? '');
  t('Ctrl+L enfoca el omnibox', focused.includes('JARVIS') || focused.includes('Dirección'), focused);

  const tabsBefore = await page.evaluate(() => window.__harness.stores.useTabsStore.getState().tabs.length);
  await page.keyboard.press('Control+t');
  await page.waitForTimeout(300);
  const tabsAfter = await page.evaluate(() => window.__harness.stores.useTabsStore.getState().tabs.length);
  t('Ctrl+T abre una pestaña', tabsAfter === tabsBefore + 1, `${tabsBefore} -> ${tabsAfter}`);
  t('Ctrl+T lleva al módulo Browser', (await uiState(page, 'module')) === 'browser');

  await page.keyboard.press('Control+w');
  await page.waitForTimeout(300);
  const tabsClosed = await page.evaluate(() => window.__harness.stores.useTabsStore.getState().tabs.length);
  t('Ctrl+W cierra la pestaña', tabsClosed === tabsAfter - 1, `${tabsAfter} -> ${tabsClosed}`);

  const panelBefore = await uiState(page, 'jarvisOpen');
  await page.keyboard.press('Control+Shift+j');
  await page.waitForTimeout(150);
  t('Ctrl+Shift+J alterna el panel', (await uiState(page, 'jarvisOpen')) !== panelBefore);
  await page.keyboard.press('Control+Shift+j');
  await page.waitForTimeout(150);
  t('vuelve a alternar', (await uiState(page, 'jarvisOpen')) === panelBefore);

  await page.keyboard.press('Control+Shift+f');
  await page.waitForTimeout(200);
  t('Ctrl+Shift+F abre la búsqueda universal', await uiState(page, 'searchOpen'));
  await page.keyboard.press('Escape');
  await page.waitForTimeout(150);

  await page.keyboard.press('Control+Shift+m');
  await page.waitForTimeout(200);
  t('Ctrl+Shift+M abre Markets', (await uiState(page, 'module')) === 'markets');
  t('sin errores tras todos los atajos', page.__errors.length === 0, page.__errors.slice(0, 2).join(' | '));
  await page.close();
});

await run('Panel JARVIS', async () => {
  const page = await newPage();
  await page.evaluate(() => window.__harness.stores.useUIStore.getState().setJarvisOpen(true));
  await page.waitForTimeout(200);
  t('el panel se abre', (await page.getByPlaceholder('Pide algo a JARVIS', { exact: true }).count()) === 1);
  await page.screenshot({ path: path.join(SHOTS, '04-jarvis-panel.png') });

  await page.getByRole('button', { name: 'Minimizar' }).click();
  await page.waitForTimeout(200);
  t('minimizar desmonta el panel', (await page.getByPlaceholder('Pide algo a JARVIS', { exact: true }).count()) === 0);
  t('aparece el orbe flotante', (await page.getByRole('button', { name: 'Abrir JARVIS' }).count()) === 1);

  await page.getByRole('button', { name: 'Abrir JARVIS' }).click();
  await page.waitForTimeout(200);
  t('el orbe restaura el panel', (await page.getByPlaceholder('Pide algo a JARVIS', { exact: true }).count()) === 1);

  await page.getByRole('button', { name: 'Cerrar panel' }).click();
  await page.waitForTimeout(200);
  t('cerrar desmonta el panel por completo', (await page.getByPlaceholder('Pide algo a JARVIS', { exact: true }).count()) === 0);
  await page.close();
});

await run('Universal Search', async () => {
  const page = await newPage();
  await page.keyboard.press('Control+Shift+f');
  await page.waitForTimeout(200);
  const input = page.getByPlaceholder('Busca en todo el equipo');
  t('el campo aparece', (await input.count()) === 1);
  await input.fill('vigilia');
  await page.waitForTimeout(500);
  const text = await page.locator('body').innerText();
  t('devuelve resultados de los mocks', text.toLowerCase().includes('vigilia'));
  t('marca la fuente de cada fila', text.includes('mock') || text.includes('equipo'));
  await page.screenshot({ path: path.join(SHOTS, '05-search.png') });

  await input.fill('zzzzqqqqxxxx-no-existe');
  await page.waitForTimeout(600);
  const empty = await page.locator('body').innerText();
  t('búsqueda sin resultados muestra estado vacío', empty.includes('Nada coincide') || empty.includes('Buscando'));
  t('sin resultados no deja la app en blanco', await notBlank(page));
  await page.keyboard.press('Escape');
  await page.waitForTimeout(150);
  t('Escape cierra la búsqueda', (await page.getByPlaceholder('Busca en todo el equipo').count()) === 0);
  await page.close();
});

await run('Browser UI (sin motor nativo)', async () => {
  const page = await newPage();
  await page.evaluate(() => window.__harness.stores.useUIStore.getState().setModule('browser'));
  await page.waitForTimeout(250);
  t('el módulo Browser renderiza', await notBlank(page));

  await page.evaluate(() => window.__harness.stores.useTabsStore.getState().open('https://example.com', 'ws-personal'));
  await page.waitForTimeout(500);
  t('declara que no hay motor nativo', (await page.locator('body').innerText()).includes('Sin motor'));
  const tabs = await page.evaluate(() => window.__harness.stores.useTabsStore.getState().tabs.map((x) => x.url));
  t('la pestaña se crea con url normalizada', tabs.some((u) => u.startsWith('https://example.com')), JSON.stringify(tabs));
  await page.screenshot({ path: path.join(SHOTS, '06-browser.png') });

  const before = await page.evaluate(() => window.__harness.stores.useTabsStore.getState().tabs.length);
  await page.evaluate(() => {
    const s = window.__harness.stores.useTabsStore.getState();
    s.activate('tab-inexistente'); s.close('tab-inexistente'); s.navigate('tab-inexistente', 'x'); s.reload('tab-inexistente');
  });
  await page.waitForTimeout(250);
  const after = await page.evaluate(() => window.__harness.stores.useTabsStore.getState().tabs.length);
  t('operar sobre una pestaña inexistente no altera el estado', before === after, `${before} -> ${after}`);
  t('ni rompe la UI', await notBlank(page) && page.__errors.length === 0, page.__errors.slice(0, 2).join(' | '));
  await page.close();
});

await run('AgentRun completo: UI → store → runtime → broker', async () => {
  const page = await newPage();
  await page.evaluate(() => window.__harness.stores.useUIStore.getState().setJarvisOpen(true));
  await page.waitForTimeout(200);

  const composer = page.getByPlaceholder('Pide algo a JARVIS', { exact: true });
  await composer.fill('Encuentra el proyecto Vigilia');
  await composer.press('Enter');
  await page.waitForTimeout(150);
  t('la petición del usuario aparece en la conversación',
    (await page.locator('body').innerText()).includes('Encuentra el proyecto Vigilia'));

  await page.waitForFunction(
    () => window.__harness.stores.useJarvisStore.getState().status === 'completed',
    null, { timeout: 8000 },
  ).catch(() => {});

  const run = await page.evaluate(() => {
    const s = window.__harness.stores.useJarvisStore.getState();
    return { status: s.status, steps: s.run?.steps.map((x) => ({ t: x.title, s: x.status, tool: x.toolId })) ?? [], events: s.events.length, routing: s.routing, audit: s.audit.length };
  });
  t('el run llega a completado', run.status === 'completed', run.status);
  t('el plan tiene varios pasos', run.steps.length >= 3, String(run.steps.length));
  t('todos los pasos terminaron', run.steps.every((x) => x.s === 'completed'), JSON.stringify(run.steps.map((x) => x.s)));
  t('el plan usó filesystem.search', run.steps.some((x) => x.tool === 'filesystem.search'));
  t('el runtime emitió eventos', run.events >= 3, String(run.events));
  t('el broker dejó auditoría', run.audit >= 1, String(run.audit));
  t('el routing cayó al heurístico (sin Ollama)', run.routing?.routedBy === 'heuristic', String(run.routing?.routedBy));
  t('el heurístico clasificó búsqueda de archivos', run.routing?.taskType === 'file_search', String(run.routing?.taskType));
  t('la respuesta llegó a la conversación',
    (await page.locator('body').innerText()).includes('coincidencia') || (await page.locator('body').innerText()).includes('No encontré'));

  await page.evaluate(() => window.__harness.stores.useJarvisStore.getState().setActivityExpanded(true));
  await page.waitForTimeout(250);
  const activity = await page.locator('body').innerText();
  t('Activity muestra el router local', activity.includes('Local Router'));
  t('Activity muestra la auditoría', activity.includes('Audit'));
  await page.screenshot({ path: path.join(SHOTS, '07-activity.png') });
  t('sin errores durante el run', page.__errors.length === 0, page.__errors.slice(0, 2).join(' | '));
  await page.close();
});

await run('Approval Dialog: los cuatro veredictos', async () => {
  // Ninguna herramienta habilitada hoy es SENSITIVE o superior, así que el
  // diálogo no puede dispararse por un run normal. Se inyecta la solicitud en
  // el ApprovalEngine real: el diálogo, el store y los botones son producción.
  const page = await newPage();
  const ask = async (id) => page.evaluate((rid) => {
    const { approvalEngine } = window.__harness.agent;
    window.__verdict = null;
    approvalEngine.request({
      id: rid, runId: 'run-harness', toolId: 'filesystem.delete', target: 'D:\\Projects\\OldBuild',
      risk: 'DESTRUCTIVE', requiredPermission: 'ADMIN',
      reason: 'Liberar 18.4 GB solicitados por el usuario', argsSummary: '{"path":"D:\\\\Projects\\\\OldBuild"}',
      createdAt: Date.now(),
    }).then((v) => { window.__verdict = v; });
  }, id);

  await ask('ap-1');
  await page.waitForTimeout(250);
  const dialog = page.locator('[role="alertdialog"]');
  t('el diálogo aparece', (await dialog.count()) === 1);
  const dtext = await dialog.innerText();
  t('nombra la herramienta', dtext.includes('filesystem.delete'));
  t('muestra el objetivo', dtext.includes('OldBuild'));
  t('muestra el riesgo', dtext.includes('DESTRUCTIVE'));
  t('muestra el motivo', dtext.includes('18.4 GB'));
  await page.screenshot({ path: path.join(SHOTS, '08-approval.png') });

  await page.getByRole('button', { name: 'Permitir una vez' }).click();
  await page.waitForTimeout(200);
  t('Allow once resuelve allow_once', (await page.evaluate(() => window.__verdict)) === 'allow_once');
  t('el diálogo se desmonta', (await page.locator('[role="alertdialog"]').count()) === 0);

  await ask('ap-2'); await page.waitForTimeout(200);
  await page.getByRole('button', { name: 'Permitir en esta tarea' }).click();
  await page.waitForTimeout(200);
  t('Allow for run resuelve allow_for_run', (await page.evaluate(() => window.__verdict)) === 'allow_for_run');

  await ask('ap-3'); await page.waitForTimeout(200);
  await page.getByRole('button', { name: 'Denegar' }).click();
  await page.waitForTimeout(200);
  t('Deny resuelve deny', (await page.evaluate(() => window.__verdict)) === 'deny');

  await ask('ap-4'); await page.waitForTimeout(200);
  await page.getByRole('button', { name: 'Cancelar la tarea completa' }).click();
  await page.waitForTimeout(200);
  t('Cancel entire run resuelve cancel_run', (await page.evaluate(() => window.__verdict)) === 'cancel_run');
  t('no queda ningún diálogo colgado', (await page.locator('[role="alertdialog"]').count()) === 0);
  t('ninguna aprobación pendiente', (await page.evaluate(() => window.__harness.agent.approvalEngine.pendingCount())) === 0);
  await page.close();
});

await run('STOP AGENT real', async () => {
  const page = await newPage();
  // Se sustituye el adaptador de una herramienta habilitada por uno lento, a
  // través de la API pública del broker de producción. Runtime, store y UI son
  // producción sin tocar.
  await page.evaluate(() => {
    window.__harness.agent.toolBroker.register('filesystem.search', (args, ctx) =>
      new Promise((resolve, reject) => {
        const timer = setTimeout(() => resolve([{ name: 'tarde', path: 'x', kind: 'file' }]), 4000);
        ctx.signal.addEventListener('abort', () => { clearTimeout(timer); reject(new Error('abortado')); });
      }));
  });
  await page.evaluate(() => window.__harness.stores.useUIStore.getState().setJarvisOpen(true));
  await page.waitForTimeout(150);
  const composer = page.getByPlaceholder('Pide algo a JARVIS', { exact: true });
  await composer.fill('Encuentra el proyecto Vigilia');
  await composer.press('Enter');
  await page.waitForTimeout(600);

  t('el run está corriendo', await jarvisState(page, 'running'));
  const stop = page.locator('[data-testid="stop-agent"]');
  t('el botón STOP AGENT se muestra', (await stop.count()) === 1);
  t('hay un paso en ejecución',
    (await page.evaluate(() => window.__harness.stores.useJarvisStore.getState().run?.steps.some((s) => s.status === 'running'))) === true);
  await page.screenshot({ path: path.join(SHOTS, '09-running.png') });

  await stop.click();
  await page.waitForTimeout(400);
  const after = await page.evaluate(() => {
    const s = window.__harness.stores.useJarvisStore.getState();
    return { status: s.status, running: s.running, steps: s.run?.steps.map((x) => x.status) ?? [], msg: s.messages.at(-1)?.content ?? '' };
  });
  t('el run queda cancelado', after.status === 'cancelled', after.status);
  t('running vuelve a false', after.running === false);
  t('ningún paso queda en running', !after.steps.includes('running'), JSON.stringify(after.steps));
  t('la conversación avisa de la detención', after.msg.includes('detenido'), after.msg.slice(0, 60));
  t('el botón STOP desaparece', (await page.locator('[data-testid="stop-agent"]').count()) === 0);

  const blocked = await page.evaluate(async () => {
    const runId = window.__harness.stores.useJarvisStore.getState().run?.id;
    const r = await window.__harness.agent.toolBroker.execute({ runId, toolId: 'system.getInfo', args: {} });
    return { ok: r.ok, reason: r.reason };
  });
  t('tras cancelar no se ejecutan nuevos ToolCalls', blocked.ok === false, JSON.stringify(blocked));
  t('la app sigue usable', await notBlank(page) && page.__errors.length === 0, page.__errors.slice(0, 2).join(' | '));

  // doble Escape
  await page.evaluate(() => {
    window.__harness.agent.toolBroker.register('filesystem.search', (args, ctx) =>
      new Promise((resolve, reject) => {
        const timer = setTimeout(() => resolve([]), 4000);
        ctx.signal.addEventListener('abort', () => { clearTimeout(timer); reject(new Error('abortado')); });
      }));
  });
  await composer.fill('Encuentra Vigilia otra vez');
  await composer.press('Enter');
  await page.waitForTimeout(500);
  t('arranca un segundo run', await jarvisState(page, 'running'));
  await page.keyboard.press('Escape');
  await page.waitForTimeout(80);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(400);
  t('doble Escape cancela el run', (await jarvisState(page, 'status')) === 'cancelled', String(await jarvisState(page, 'status')));
  await page.close();
});

await run('Errores internos y estados degradados', async () => {
  const page = await newPage();
  // tool error
  await page.evaluate(() => {
    window.__harness.agent.toolBroker.register('filesystem.search', () => { throw new Error('disco ilegible'); });
  });
  await page.evaluate(() => window.__harness.stores.useUIStore.getState().setJarvisOpen(true));
  await page.waitForTimeout(150);
  const composer = page.getByPlaceholder('Pide algo a JARVIS', { exact: true });
  await composer.fill('Encuentra el proyecto Vigilia');
  await composer.press('Enter');
  await page.waitForFunction(() => ['completed', 'failed'].includes(window.__harness.stores.useJarvisStore.getState().status), null, { timeout: 8000 }).catch(() => {});
  const failed = await page.evaluate(() => {
    const s = window.__harness.stores.useJarvisStore.getState();
    return { status: s.status, step: s.run?.steps.find((x) => x.toolId === 'filesystem.search'), audit: s.audit[0] };
  });
  t('un fallo de herramienta no aborta el run', failed.status === 'completed', failed.status);
  t('el paso queda marcado como fallido', failed.step?.status === 'failed', String(failed.step?.status));
  t('el error se propaga al paso', String(failed.step?.error).includes('disco ilegible'), String(failed.step?.error));
  t('el fallo queda auditado como error', failed.audit?.result === 'error', String(failed.audit?.result));
  t('la app no queda en blanco', await notBlank(page));

  // permisos
  for (const level of ['OBSERVE', 'ASSIST', 'CONTROL', 'ADMIN']) {
    await page.evaluate((l) => window.__harness.stores.useJarvisStore.getState().setPermission(l), level);
    await page.waitForTimeout(80);
    const applied = await jarvisState(page, 'permission');
    t(`permiso ${level} se aplica`, applied === level, String(applied));
  }
  await page.evaluate(() => window.__harness.stores.useJarvisStore.getState().setPermission('OBSERVE'));
  const denied = await page.evaluate(async () => {
    const { toolBroker } = window.__harness.agent;
    const runId = 'run-perm';
    toolBroker.openRun(runId, 'OBSERVE', new (window.AbortController ? Object : Object)(), 'x');
    return null;
  }).catch(() => null);
  t('cambiar de permiso no rompe la UI', await notBlank(page));

  // router inválido -> heurístico
  const invalid = await page.evaluate(() => {
    const s = window.__harness.stores.useJarvisStore.getState();
    return s.routing?.routedBy;
  });
  t('con Ollama ausente el routing es heurístico', invalid === 'heuristic', String(invalid));
  t('sin errores de página en toda la sección', page.__errors.length === 0, page.__errors.slice(0, 3).join(' | '));
  await page.close();
});

await run('Error Boundary', async () => {
  const page = await newPage();
  const result = await page.evaluate(async () => {
    const { ErrorBoundary, React } = window.__harness;
    const host = document.createElement('div');
    host.id = 'eb-host';
    document.body.appendChild(host);
    const root = React.createRoot(host);
    const e = window.__harness.React.createElement;
    return new Promise((resolve) => {
      const Thrower = () => { throw new Error('fallo deliberado de render'); };
      root.render(e(ErrorBoundary, { label: 'El módulo de prueba' }, e(Thrower, null)));
      setTimeout(() => resolve({ html: host.innerText, hasFallback: !!host.querySelector('[data-testid="error-boundary"]') }), 300);
    });
  }).catch((e) => ({ error: String(e) }));
  if (result.error) {
    // createElement no expuesto: se prueba por el camino del propio Shell.
    t('Error Boundary evaluable', false, result.error.slice(0, 120));
  } else {
    t('el Error Boundary captura el fallo', result.hasFallback === true);
    t('muestra el módulo que falló', String(result.html).includes('El módulo de prueba'));
    t('muestra el mensaje del error', String(result.html).includes('fallo deliberado'));
    t('ofrece reintentar', String(result.html).includes('Reintentar'));
    t('la app principal sigue montada', await notBlank(page));
  }
  await page.close();
});

await run('Configuración corrupta', async () => {
  for (const payload of ['{{{no es json', '"una cadena"', '[1,2,3]', '{"state":null}', '{"state":{"module":"inexistente"}}']) {
    const page = await browser.newPage({ viewport: { width: 1366, height: 768 } });
    page.__errors = [];
    page.on('pageerror', (e) => page.__errors.push(String(e)));
    await page.addInitScript((value) => {
      try { localStorage.setItem('jarvis.firstRun', value); } catch { /* sin storage */ }
    }, COMPLETED_FIRST_RUN);
    await page.goto(url, { waitUntil: 'load' });
    await page.evaluate((p) => {
      localStorage.setItem('jarvis.ui', p);
      localStorage.setItem('jarvis.settings', p);
      localStorage.setItem('jarvis.workspace', p);
    }, payload);
    await page.reload({ waitUntil: 'load' });
    await page.waitForTimeout(500);
    const alive = (await page.evaluate(() => document.getElementById('root').innerHTML.length)) > 500;
    t(`config corrupta ${payload.slice(0, 18)} no rompe el arranque`, alive && page.__errors.length === 0,
      page.__errors.slice(0, 1).join(' | '));
    await page.close();
  }
});

await run('Fugas: listeners, overlays y suscripciones', async () => {
  const page = await newPage();
  // Montar y desmontar tres veces debe dejar exactamente un listener global.
  for (let i = 0; i < 3; i++) {
    await page.evaluate(() => window.__harness.unmount());
    await page.waitForTimeout(150);
    await page.evaluate(() => window.__harness.remount());
    await page.waitForTimeout(300);
  }
  t('la app sigue montada tras 3 ciclos', await notBlank(page));

  await page.evaluate(() => window.__harness.stores.useUIStore.getState().setPalette(false));
  await page.waitForTimeout(120);
  await page.keyboard.press('Alt+Space');
  await page.waitForTimeout(200);
  const openedOnce = await uiState(page, 'paletteOpen');
  t('Alt+Space abre una sola vez tras remontar', openedOnce === true, String(openedOnce));
  t('sólo existe una paleta en el DOM', (await page.getByPlaceholder('Busca, ordena o pregunta').count()) === 1);
  await page.keyboard.press('Alt+Space');
  await page.waitForTimeout(200);
  t('Alt+Space alterna, no dispara múltiple', (await uiState(page, 'paletteOpen')) === false);

  await page.keyboard.press('Escape');
  await page.waitForTimeout(150);
  const overlays = await page.evaluate(() => {
    const nodes = [...document.querySelectorAll('[role="dialog"],[role="alertdialog"]')];
    const center = document.elementFromPoint(window.innerWidth / 2, window.innerHeight / 2);
    return { count: nodes.length, centerTag: center?.tagName ?? 'none' };
  });
  t('no quedan overlays en el DOM', overlays.count === 0, String(overlays.count));
  t('el centro de la pantalla es clicable', overlays.centerTag !== 'none', overlays.centerTag);

  // Suscripciones: dos runs no deben duplicar eventos ni mensajes.
  await page.evaluate(() => window.__harness.stores.useJarvisStore.getState().clearConversation());
  await page.evaluate(() => window.__harness.stores.useUIStore.getState().setJarvisOpen(true));
  await page.waitForTimeout(200);
  const composer = page.getByPlaceholder('Pide algo a JARVIS', { exact: true });
  for (let i = 0; i < 2; i++) {
    await composer.fill(`Encuentra Vigilia ${i}`);
    await composer.press('Enter');
    await page.waitForFunction(() => window.__harness.stores.useJarvisStore.getState().status === 'completed', null, { timeout: 8000 }).catch(() => {});
    await page.waitForTimeout(200);
  }
  const counts = await page.evaluate(() => {
    const s = window.__harness.stores.useJarvisStore.getState();
    const assistant = s.messages.filter((m) => m.role === 'assistant').length;
    const ids = s.events.map((e) => e.id);
    return { assistant, user: s.messages.filter((m) => m.role === 'user').length, dupEvents: ids.length - new Set(ids).size, runs: s.runs.length };
  });
  t('dos peticiones producen dos mensajes de usuario', counts.user === 2, String(counts.user));
  t('cada run produce exactamente una respuesta', counts.assistant === 3, `saludo + 2 = 3, obtenido ${counts.assistant}`);
  t('no hay eventos duplicados', counts.dupEvents === 0, String(counts.dupEvents));
  t('el historial guarda los dos runs', counts.runs === 2, String(counts.runs));
  await page.close();
});

await run('Connected AI sin main en Settings', async () => {
  const page = await newPage();
  await page.evaluate(() => window.__harness.stores.useUIStore.getState().setModule('settings'));
  await page.waitForTimeout(200);
  await page.getByRole('button', { name: 'Proveedores de IA' }).click();
  await page.waitForTimeout(400);
  const text = await page.locator('body').innerText();
  t('la tarjeta de Ollama se muestra', text.includes('Ollama'));
  t('sin main no inventa conexión ni estado Offline', text.includes('UNKNOWN') && !text.includes('· AVAILABLE'));
  t('explica que no hay proceso principal conectado', text.includes('no hay proceso principal conectado'));
  t('credencial fuera del formulario normal de chat', (await page.locator('input[type=password]').count()) === 0 && text.includes('Guardar credencial privada'));
  t('Settings no se rompe sin proceso principal', await notBlank(page) && page.__errors.length === 0, page.__errors.slice(0, 2).join(' | '));
  await page.screenshot({ path: path.join(SHOTS, '10-ollama-offline.png') });
  await page.close();
});

await run('Responsive', async () => {
  for (const vp of [{ width: 1366, height: 768 }, { width: 1920, height: 1080 }, { width: 2560, height: 1440 }]) {
    const page = await newPage(vp);
    const label = `${vp.width}x${vp.height}`;
    t(`${label}: renderiza`, await notBlank(page));
    t(`${label}: sin errores`, page.__errors.length === 0, page.__errors.slice(0, 1).join(' | '));
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    t(`${label}: sin desbordamiento horizontal`, overflow <= 1, String(overflow));
    await page.evaluate(() => window.__harness.stores.useUIStore.getState().setJarvisOpen(true));
    await page.evaluate(() => window.__harness.stores.useUIStore.getState().setModule('markets'));
    await page.waitForTimeout(300);
    t(`${label}: Markets con panel abierto`, await notBlank(page));
    await page.screenshot({ path: path.join(SHOTS, `11-responsive-${vp.width}.png`) });
    await page.close();
  }
});


/* ================================================================== */
/* First Run y machine intelligence                                    */
/* ================================================================== */

/** Página con el onboarding forzado desde cero. */
async function firstRunPage(fixtureId = 'C') {
  const page = await browser.newPage({ viewport: { width: 1366, height: 768 } });
  page.__errors = [];
  page.on('pageerror', (e) => page.__errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') page.__errors.push('console: ' + m.text()); });
  await page.goto(url, { waitUntil: 'load' });
  await page.evaluate(() => localStorage.removeItem('jarvis.firstRun'));
  await page.reload({ waitUntil: 'load' });
  await page.waitForSelector('#root > *', { timeout: 10000 });
  await page.evaluate((id) => window.__harness.stores.useMachineStore.getState().useFixtureProfile(id), fixtureId);
  await page.waitForTimeout(350);
  return page;
}

const machine = (page, key) => page.evaluate((k) => {
  const s = window.__harness.stores.useMachineStore.getState();
  return typeof s[k] === 'function' ? null : s[k];
}, key);

await run('First Run: bienvenida y análisis', async () => {
  const page = await firstRunPage('C');
  t('el onboarding aparece', (await page.locator('[data-testid="first-run"]').count()) === 1);
  const text = await page.locator('[data-testid="first-run"]').innerText();
  t('saluda al usuario', text.includes('Hola'));
  t('no pide crear una cuenta', !/crear cuenta|sign in|iniciar sesi[oó]n|correo|email|contrase[nñ]a/i.test(text));
  await page.screenshot({ path: path.join(SHOTS, '12-firstrun-welcome.png') });

  await page.getByRole('button', { name: 'Continuar' }).first().click();
  await page.waitForTimeout(700);
  t('llega al análisis del sistema', (await machine(page, 'firstRunStep')) === 'system');
  const analysis = await page.locator('[data-testid="first-run"]').innerText();
  t('muestra la CPU', analysis.includes('CPU'));
  t('muestra la memoria', analysis.includes('Memoria'));
  t('muestra los gráficos', analysis.includes('Gráficos'));
  t('muestra el disco', analysis.includes('Disco'));
  t('describe el equipo en lenguaje neutral', (await page.locator('[data-testid="performance-wording"]').count()) === 1);
  const wording = await page.locator('[data-testid="performance-wording"]').innerText();
  t('no le dice al usuario que su PC es LOW', !/VERY_LOW|LOW|HIGH|EXTREME|BALANCED/.test(wording), wording);
  await page.screenshot({ path: path.join(SHOTS, '13-firstrun-system.png') });
  t('sin errores', page.__errors.length === 0, page.__errors.slice(0, 2).join(' | '));
  await page.close();
});

await run('First Run: IA local no encontrada', async () => {
  const page = await firstRunPage('C');
  await page.evaluate(() => window.__harness.stores.useMachineStore.getState().nextStep());
  await page.evaluate(() => window.__harness.stores.useMachineStore.getState().nextStep());
  await page.waitForTimeout(300);
  t('llega al paso de IA local', (await machine(page, 'firstRunStep')) === 'localAI');
  const text = await page.locator('[data-testid="first-run"]').innerText();
  t('dice que la app funciona igualmente', text.includes('funciona igualmente') || text.includes('reglas locales'));
  await page.screenshot({ path: path.join(SHOTS, '14-firstrun-localai.png') });

  await page.evaluate(() => window.__harness.stores.useMachineStore.getState().nextStep());
  await page.waitForTimeout(300);
  t('llega a la recomendación', (await machine(page, 'firstRunStep')) === 'recommendation');
  const missing = await page.locator('[data-testid="recommendation-missing"]').count();
  t('sin runtime muestra la pantalla de recomendación pendiente', missing === 1);
  t('siempre ofrece continuar sin IA local', (await page.locator('[data-testid="skip-local-ai"]').count()) === 1);
  await page.screenshot({ path: path.join(SHOTS, '15-firstrun-recommendation.png') });

  await page.locator('[data-testid="skip-local-ai"]').click();
  await page.waitForTimeout(300);
  t('continuar sin IA local avanza', (await machine(page, 'firstRunStep')) === 'access');
  t('queda registrado como omitido', (await machine(page, 'firstRunConfig')).localAIChoice === 'skipped');
  await page.close();
});

await run('First Run: permisos y sesiones', async () => {
  const page = await firstRunPage('C');
  await page.evaluate(() => { const s = window.__harness.stores.useMachineStore.getState(); s.nextStep(); s.nextStep(); s.nextStep(); s.nextStep(); });
  await page.waitForTimeout(300);
  t('llega al paso de acceso', (await machine(page, 'firstRunStep')) === 'access');

  const accessText = await page.locator('[data-testid="first-run"]').innerText();
  t('ofrece los dos modos de producto', ['FULL', 'RESTRICTED'].every((l) => accessText.includes(l)));
  t('no presenta niveles antiguos', !['OBSERVE', 'ASSIST', 'CONTROL', 'ADMIN'].some(l => accessText.includes(l)));
  t('avisa de las fronteras Windows y autoridad nativa', accessText.includes('UAC') && accessText.includes('menú'));

  await page.locator('[data-testid="access-RESTRICTED"]').click();
  await page.waitForTimeout(200);
  t('seleccionar propaga al preset del harness sin main', (await machine(page, 'firstRunConfig')).permissionPreset === 'RESTRICTED');
  t('y propaga al agente del harness', (await jarvisState(page, 'permission')) === 'RESTRICTED');
  await page.screenshot({ path: path.join(SHOTS, '16-firstrun-access.png') });

  await page.getByRole('button', { name: 'Continuar' }).first().click();
  await page.waitForTimeout(300);
  t('llega al paso de privacidad', (await machine(page, 'firstRunStep')) === 'privacy');
  const privacyText = await page.locator('[data-testid="first-run"]').innerText();
  t('explica que no guarda contraseñas', privacyText.includes('nunca guarda contraseñas'));
  t('distingue sesión de contraseña', privacyText.includes('sesión no es una contraseña'));
  await page.locator('[data-testid="session-clear_on_exit"]').click();
  await page.waitForTimeout(200);
  t('la política de sesiones se guarda', (await machine(page, 'firstRunConfig')).sessionPolicy === 'clear_on_exit');

  await page.getByRole('button', { name: 'Continuar' }).first().click();
  await page.waitForTimeout(300);
  t('llega al final', (await page.locator('[data-testid="first-run-ready"]').count()) === 1);
  const readyText = await page.locator('[data-testid="first-run-ready"]').innerText();
  t('el resumen dice que no hay cuenta', readyText.includes('Ninguna'));
  t('el resumen muestra el acceso elegido', readyText.includes('RESTRICTED'));
  await page.screenshot({ path: path.join(SHOTS, '17-firstrun-ready.png') });

  await page.locator('[data-testid="finish-first-run"]').click();
  await page.waitForTimeout(400);
  t('terminar cierra el onboarding', (await page.locator('[data-testid="first-run"]').count()) === 0);
  t('la app queda usable', await notBlank(page));
  t('queda marcado como completado', (await machine(page, 'firstRunConfig')).completed === true);

  await page.reload({ waitUntil: 'load' });
  await page.waitForSelector('#root > *');
  await page.waitForTimeout(500);
  t('al reiniciar no vuelve a salir', (await page.locator('[data-testid="first-run"]').count()) === 0);
  t('sin errores en todo el flujo', page.__errors.length === 0, page.__errors.slice(0, 2).join(' | '));
  await page.close();
});

await run('First Run con máquinas distintas', async () => {
  for (const id of ['A', 'D', 'E', 'G', 'H']) {
    const page = await firstRunPage(id);
    await page.evaluate(() => window.__harness.stores.useMachineStore.getState().nextStep());
    await page.waitForTimeout(600);
    const alive = await notBlank(page);
    const errs = page.__errors.length;
    t(`máquina ${id}: el análisis renderiza`, alive && errs === 0, page.__errors.slice(0, 1).join(''));
    const text = await page.locator('[data-testid="first-run"]').innerText();
    t(`máquina ${id}: nunca muestra un valor inventado`, !text.includes('undefined') && !text.includes('NaN'), text.slice(0, 80));
    if (id === 'G') t('máquina G: los datos ausentes se muestran como no disponibles', text.includes('No disponible') || text.includes('No detectados'));
    await page.screenshot({ path: path.join(SHOTS, `18-machine-${id}.png`) });
    await page.close();
  }
});

await run('Settings: System, Local AI y Privacy', async () => {
  const page = await newPage();
  await page.evaluate(() => window.__harness.stores.useUIStore.getState().setModule('settings'));
  await page.waitForTimeout(400);

  await page.getByRole('button', { name: 'Sistema', exact: true }).click();
  await page.waitForTimeout(400);
  const systemText = await page.locator('body').innerText();
  t('Settings > Sistema muestra el equipo', systemText.includes('Este equipo'));
  t('muestra CPU, memoria, gráficos y disco',
    ['CPU', 'Memoria', 'Gráficos', 'Disco'].every((l) => systemText.includes(l)));
  t('resume las capacidades', (await page.locator('[data-testid="capability-summary"]').count()) === 1);
  t('ofrece volver a analizar', (await page.locator('[data-testid="reanalyze"]').count()) === 1);
  // Sin Tailwind los anchos no se acotan y el botón cae fuera del viewport.
  // Es del arnés, no del producto: se despacha el evento sobre el nodo.
  await page.locator('[data-testid="reanalyze"]').dispatchEvent('click');
  await page.waitForTimeout(600);
  t('volver a analizar no rompe nada', await notBlank(page) && page.__errors.length === 0, page.__errors.slice(0, 1).join(''));
  await page.screenshot({ path: path.join(SHOTS, '19-settings-system.png') });

  await page.getByRole('button', { name: 'IA local', exact: true }).click();
  await page.waitForTimeout(400);
  const aiText = await page.locator('body').innerText();
  t('Settings > IA local muestra el runtime', aiText.includes('Sin runtime') || aiText.includes('Ollama'));
  t('muestra el router', aiText.includes('Router'));
  t('muestra el estado del benchmark', aiText.includes('Benchmark'));
  t('deja claro que no instala nada', aiText.includes('no instala ni ejecuta'));
  await page.screenshot({ path: path.join(SHOTS, '20-settings-localai.png') });

  await page.getByRole('button', { name: 'Privacidad', exact: true }).click();
  await page.waitForTimeout(400);
  const privacyText = await page.locator('[data-testid="privacy-rows"]').innerText();
  t('Privacidad dice que no hay cuenta JARVIS', privacyText.includes('Cuenta JARVIS') && privacyText.includes('Ninguna'));
  t('la identidad es el perfil del sistema', privacyText.includes('Perfil del sistema'));
  t('la nube está desactivada', privacyText.includes('Sincronización en la nube') && privacyText.includes('Desactivada'));
  t('la telemetría está desactivada', privacyText.includes('Telemetría'));
  t('el almacenamiento de contraseñas está deshabilitado', privacyText.includes('Deshabilitado'));
  t('la información del sistema se queda aquí', privacyText.includes('Sólo en este equipo'));
  await page.screenshot({ path: path.join(SHOTS, '21-settings-privacy.png') });

  await page.locator('[data-testid="reconfigure"]').dispatchEvent('click');
  await page.waitForTimeout(500);
  t('Reconfigurar reabre el onboarding', (await page.locator('[data-testid="first-run"]').count()) === 1);
  t('y vuelve a empezar por la bienvenida', (await machine(page, 'firstRunStep')) === 'welcome');
  await page.close();
});

await run('El contexto de máquina no se filtra a cualquier prompt', async () => {
  const page = await newPage();
  await page.waitForTimeout(300);

  const result = await page.evaluate(() => {
    const store = window.__harness.stores.useMachineStore.getState();
    const builder = window.__harness.machineContext;
    if (!builder) return null;
    const sources = { profile: store.profile, localAI: store.localAI, capabilities: store.capabilities };
    return {
      page: builder.build('Resume esta página', sources),
      model: builder.build('¿Qué modelo local puedo usar?', sources),
      chat: builder.build('hola', sources),
    };
  });
  if (!result) { t('constructor de contexto expuesto', false, 'no disponible en el arnés'); }
  else {
    t('una página no recibe hardware', !result.page.lines.some((l) => l.startsWith('CPU')));
    t('la pregunta por modelos sí lo recibe', result.model.lines.some((l) => l.startsWith('CPU')));
    t('una charla no recibe nada', result.chat.lines.length === 0);
    t('el contexto es acotado', result.model.approxTokens < 200, String(result.model.approxTokens));
  }
  await page.close();
});

/* ================================================================== */
/* Computer control                                                    */
/* The Windows backend is the double; every component, store, broker   */
/* and runtime below it is production code running in real Chromium.  */
/* ================================================================== */

/** Waits until the agent run reaches a terminal state. */
const runSettled = (page) => page.waitForFunction(() => {
  const st = window.__harness.agent.agentRuntime.snapshot().run?.status;
  return st === 'completed' || st === 'failed' || st === 'cancelled';
}, null, { timeout: 8000 }).catch(() => {});
const desktopStatus = (page) => page.evaluate(() => window.__harness.stores.useDesktopStore.getState().status);
const installWindows = (page, apps) => page.evaluate((a) => window.__harness.desktop.install(a), apps ?? null);
const openDeveloper = async (page) => {
  await page.evaluate(() => {
    window.__harness.stores.useUIStore.getState().setModule('settings');
    window.__harness.stores.useSettingsStore.getState().setSection?.('developer');
  });
  await page.waitForTimeout(200);
  if ((await page.locator('[data-testid="ui-inspector"]').count()) === 0) {
    await page.getByRole('button', { name: /Desarrollador|Developer/ }).first().click().catch(() => {});
    await page.waitForTimeout(200);
  }
};

await run('Control del equipo: sin helper nativo', async () => {
  const page = await newPage();
  const status = await desktopStatus(page);
  t('sin helper, el control informa no disponible', status.helperAvailable === false);
  t('el indicador de control no aparece sin run', (await page.locator('[data-testid="control-indicator"]').count()) === 0);
  const caps = await page.evaluate(() => window.__harness.stores.useMachineStore.getState().capabilities);
  const cap = (id) => caps.find((c) => c.id === id);
  t('capacidad uiAutomation = UNAVAILABLE', cap('uiAutomation')?.state === 'UNAVAILABLE');
  t('ratón y teclado = UNAVAILABLE', cap('mouse.control')?.state === 'UNAVAILABLE' && cap('keyboard.control')?.state === 'UNAVAILABLE');
  // Without Electron the honest reason is the missing main process; with it,
  // the missing helper. Either way the user is told why.
  t('con motivo legible', /helper|proceso principal/.test(cap('uiAutomation')?.reason ?? ''), cap('uiAutomation')?.reason);
  await openDeveloper(page);
  t('el inspector de UI se monta en Settings > Desarrollador', (await page.locator('[data-testid="ui-inspector"]').count()) === 1);
  await page.waitForTimeout(250);
  t('el inspector muestra el estado no disponible', (await page.locator('[data-testid="inspector-unavailable"]').count()) === 1);
  t('sin ventanas inventadas', (await page.locator('[data-testid="inspector-window"] option').allInnerTexts()).join() === 'Sin ventanas');
  t('sin errores de página', page.__errors.length === 0, page.__errors.join(' | '));
  await page.close();
});

await run('Control del equipo: UI Inspector con el doble de Windows', async () => {
  const page = await newPage();
  await installWindows(page, ['app:notepad', 'app:vscode', 'app:browser']);
  await page.waitForTimeout(150);
  const caps = await page.evaluate(() => window.__harness.stores.useMachineStore.getState().capabilities);
  t('con helper, uiAutomation deja de ser UNAVAILABLE', caps.find((c) => c.id === 'uiAutomation')?.state !== 'UNAVAILABLE');
  await openDeveloper(page);
  await page.getByRole('button', { name: 'Actualizar' }).click();
  await page.waitForTimeout(250);
  const options = await page.locator('[data-testid="inspector-window"] option').allInnerTexts();
  t('el selector lista las tres ventanas', options.length === 4 && options[0] === 'Selecciona una ventana', options.join(' / '));
  t('cada opción muestra título y proceso', options.some((o) => o.includes('Visual Studio Code') && o.includes('Code.exe')));

  const codeId = await page.evaluate(async () => (await window.__harness.desktop.fake.listWindows()).find((w) => w.processName === 'Code.exe').windowId);
  await page.locator('[data-testid="inspector-window"]').selectOption(codeId);
  await page.waitForTimeout(300);
  const tree = await page.locator('[data-testid="inspector-tree"]').innerText();
  t('el árbol de VS Code aparece', tree.includes('MenuBar') && tree.includes('File') && tree.includes('Explorer'));
  t('cada nodo muestra su ref ui:N', /ui:\d+/.test(tree));
  const fileNode = page.locator('[data-testid^="inspector-node-ui:"]', { hasText: 'File' }).first();
  await fileNode.click();
  await page.waitForTimeout(100);
  const details = await page.locator('[data-testid="inspector-details"]').innerText();
  t('los detalles muestran name, controlType, automationId, patterns', /name\s+File/.test(details) && /controlType\s+MenuItem/.test(details) && /patterns\s+Invoke, ExpandCollapse/.test(details));
  await page.screenshot({ path: path.join(SHOTS, '20-ui-inspector.png') });

  const bankId = await page.evaluate(async () => (await window.__harness.desktop.fake.listWindows()).find((w) => w.processName === 'msedge.exe').windowId);
  await page.locator('[data-testid="inspector-window"]').selectOption(bankId);
  await page.waitForTimeout(300);
  const bankTree = await page.locator('[data-testid="inspector-tree"]').innerText();
  t('el campo de contraseña se marca protegido', bankTree.includes('Contraseña') && bankTree.includes('protegido'));
  await page.locator('[data-testid^="inspector-node-ui:"]', { hasText: 'Contraseña' }).first().click();
  await page.waitForTimeout(100);
  const pwdDetails = await page.locator('[data-testid="inspector-details"]').innerText();
  t('su valor se muestra como "protegido (relleno)"', pwdDetails.includes('protegido (relleno)'));
  t('la contraseña real no está en ningún lugar del DOM', !(await page.content()).includes('hunter2'));
  t('ni en el estado del store de actividad', !JSON.stringify(await page.evaluate(() => window.__harness.stores.useJarvisStore.getState().audit ?? [])).includes('hunter2'));
  t('sin errores de página', page.__errors.length === 0, page.__errors.join(' | '));
  await page.close();
});

await run('Control del equipo: "Abre VS Code…" de extremo a extremo', async () => {
  const page = await newPage();
  await installWindows(page, ['app:notepad']);
  await page.evaluate(() => window.__harness.stores.useJarvisStore.getState().setPermission('ASSIST'));
  await page.evaluate(() => { window.__harness.stores.useJarvisStore.getState().submit('Abre VS Code, busca el proyecto Vigilia y abre package.json'); });
  await page.waitForSelector('[role="alertdialog"]', { timeout: 5000 }).catch(() => {});
  const dialog = page.locator('[role="alertdialog"]');
  t('app.launch dispara una aprobación real (no inyectada)', (await dialog.count()) === 1);
  const dtext = await dialog.innerText().catch(() => '');
  t('el diálogo nombra app.launch y el objetivo', dtext.includes('app.launch') && dtext.includes('app:vscode'));
  t('muestra el riesgo SENSITIVE', dtext.includes('SENSITIVE'));
  const indicator = page.locator('[data-testid="control-indicator"]');
  t('mientras hay run, el indicador JARVIS CONTROL es visible', (await indicator.count()) === 1 && (await indicator.innerText()).includes('JARVIS CONTROL'));
  t('el indicador ofrece STOP y Pausar', (await page.locator('[data-testid="control-stop"]').count()) === 1 && (await page.locator('[data-testid="control-pause"]').count()) === 1);
  const reachable = await page.evaluate(() => ['control-stop', 'control-pause'].every((id) => {
    const el = document.querySelector(`[data-testid="${id}"]`);
    const r = el.getBoundingClientRect();
    return el.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2));
  }));
  t('STOP y Pausar siguen alcanzables sobre el fondo del diálogo', reachable);
  await page.screenshot({ path: path.join(SHOTS, '21-control-approval.png') });
  t('antes de aprobar, VS Code no se ha abierto', !(await page.evaluate(async () => (await window.__harness.desktop.fake.listWindows()).some((w) => w.processName === 'Code.exe'))));

  await page.getByRole('button', { name: 'Permitir una vez' }).click();
  await runSettled(page);
  await page.waitForTimeout(300);
  t('tras aprobar, VS Code se abre en el doble', await page.evaluate(async () => (await window.__harness.desktop.fake.listWindows()).some((w) => w.processName === 'Code.exe')));
  const run = await page.evaluate(() => window.__harness.agent.agentRuntime.snapshot().run);
  const st = Object.fromEntries(run.steps.filter((s) => s.toolId).map((s) => [s.toolId, s.status]));
  t('los pasos app.launch → window.find → ui.inspect se completan', st['app.launch'] === 'completed' && st['window.find'] === 'completed' && st['ui.inspect'] === 'completed', JSON.stringify(st));
  t('el run termina', run.status === 'completed');
  t('al terminar, el indicador desaparece (no hay control sin run)', (await page.locator('[data-testid="control-indicator"]').count()) === 0);

  // Expanded activity: tool + target with time, like a log.
  await page.evaluate(() => window.__harness.stores.useJarvisStore.getState().setActivityExpanded(true));
  await page.waitForTimeout(200);
  const tools = await page.locator('[data-testid="activity-tool"]').allInnerTexts();
  t('Activity muestra app.launch con su objetivo', tools.some((x) => x.includes('app.launch') && x.includes('app:vscode')), tools.join(' | '));
  t('y window.find y ui.inspect', tools.some((x) => x.startsWith('window.find')) && tools.some((x) => x.startsWith('ui.inspect')));
  const panelText = await page.locator('body').innerText();
  t('el panel describe los pasos en lenguaje natural', /Abriendo vs code/i.test(panelText) && /Localizando su ventana/.test(panelText));
  await page.screenshot({ path: path.join(SHOTS, '22-control-activity.png') });
  t('sin errores de página', page.__errors.length === 0, page.__errors.join(' | '));
  await page.close();
});

await run('Control del equipo: sin indicador en runs que no tocan el escritorio', async () => {
  const page = await newPage();
  await installWindows(page, ['app:notepad']);
  await page.evaluate(() => window.__harness.stores.useJarvisStore.getState().submit('Encuentra el archivo package.json'));
  await page.waitForTimeout(150);
  t('una búsqueda de archivos no muestra JARVIS CONTROL', (await page.locator('[data-testid="control-indicator"]').count()) === 0);
  await runSettled(page);
  t('ni vincula el control del escritorio', (await desktopStatus(page)).runId === null);
  await page.close();
});

await run('Control del equipo: Pausar, Reanudar y STOP desde el indicador', async () => {
  const page = await newPage();
  await installWindows(page, ['app:notepad']);
  const hasCode = () => page.evaluate(async () => (await window.__harness.desktop.fake.listWindows()).some((w) => w.processName === 'Code.exe'));
  const send = () => page.evaluate(() => { window.__harness.stores.useJarvisStore.getState().submit('Abre VS Code'); });

  await send();
  await page.waitForSelector('[role="alertdialog"]', { timeout: 5000 });
  await page.locator('[data-testid="control-pause"]').click();
  await page.waitForTimeout(150);
  t('Pausar pone el control en pausa', (await desktopStatus(page)).mode === 'paused');
  t('el run queda en pausa, vivo', await page.evaluate(() => window.__harness.agent.agentRuntime.isPaused && window.__harness.agent.agentRuntime.isRunning));
  t('el indicador muestra "En pausa" y el botón Reanudar', (await page.locator('[data-testid="control-action"]').innerText()).includes('En pausa') && (await page.locator('[data-testid="control-resume"]').count()) === 1);
  await page.screenshot({ path: path.join(SHOTS, '23-control-paused.png') });
  await page.getByRole('button', { name: 'Permitir una vez' }).click();
  await page.waitForTimeout(250);
  t('aprobar en pausa NO ejecuta: VS Code no se abre', !(await hasCode()));
  t('la pausa no se reanuda sola', (await desktopStatus(page)).mode === 'paused');
  await page.locator('[data-testid="control-resume"]').click();
  await runSettled(page);
  await page.waitForTimeout(250);
  t('Reanudar continúa: VS Code se abre', await hasCode());
  t('y el run termina', await page.evaluate(() => window.__harness.agent.agentRuntime.snapshot().run.status === 'completed'));

  // STOP while waiting for approval
  const before = await page.evaluate(async () => (await window.__harness.desktop.fake.listWindows()).length);
  await page.evaluate(() => { window.__harness.stores.useJarvisStore.getState().submit('Abre Blender'); });
  await page.waitForSelector('[role="alertdialog"]', { timeout: 5000 });
  await page.locator('[data-testid="control-stop"]').click();
  await runSettled(page);
  await page.waitForTimeout(200);
  t('STOP cancela el run', await page.evaluate(() => window.__harness.agent.agentRuntime.snapshot().run.status === 'cancelled'));
  t('STOP descarta la aprobación pendiente', (await page.locator('[role="alertdialog"]').count()) === 0);
  t('nada se lanzó', (await page.evaluate(async () => (await window.__harness.desktop.fake.listWindows()).length)) === before);
  t('el indicador desaparece tras STOP', (await page.locator('[data-testid="control-indicator"]').count()) === 0);
  t('sin errores de página', page.__errors.length === 0, page.__errors.join(' | '));
  await page.close();
});

await run('Control del equipo: intervención humana y sesión bloqueada', async () => {
  const page = await newPage();
  await installWindows(page, ['app:notepad']);
  await page.evaluate(() => { window.__harness.stores.useJarvisStore.getState().submit('Abre VS Code'); });
  await page.waitForSelector('[role="alertdialog"]', { timeout: 5000 });
  await page.waitForTimeout(120);
  await page.evaluate(() => window.__harness.desktop.human.emit('mouse'));
  await page.waitForTimeout(150);
  t('input humano pausa el control', (await desktopStatus(page)).humanOverride === true);
  t('el indicador lo explica', (await page.locator('[data-testid="human-override"]').count()) === 1);
  t('el run también queda en pausa', await page.evaluate(() => window.__harness.agent.agentRuntime.isPaused));
  await page.screenshot({ path: path.join(SHOTS, '24-control-human-override.png') });
  await page.locator('[data-testid="control-resume"]').click();
  await page.waitForTimeout(100);
  t('sólo Reanudar lo reactiva', (await desktopStatus(page)).mode === 'active' && !(await desktopStatus(page)).humanOverride);

  await page.evaluate(async () => {
    window.__harness.desktop.fake.setSession('LOCKED');
    await window.__harness.desktop.controller.refresh();
  });
  await page.waitForTimeout(150);
  const s = await desktopStatus(page);
  t('Windows bloqueado → estado blocked', s.mode === 'blocked' && s.session === 'LOCKED');
  t('el indicador muestra "Windows está bloqueado."', (await page.locator('[data-testid="control-action"]').innerText()).includes('Windows está bloqueado'));
  t('Pausar se deshabilita mientras está bloqueado', await page.locator('[data-testid="control-pause"]').isDisabled());
  const caps = await page.evaluate(() => window.__harness.stores.useMachineStore.getState().capabilities);
  t('capacidades interactivas pasan a RESTRICTED', caps.find((c) => c.id === 'uiAutomation')?.state === 'RESTRICTED');
  await page.screenshot({ path: path.join(SHOTS, '25-control-locked.png') });
  await page.getByRole('button', { name: 'Permitir una vez' }).click();
  await runSettled(page);
  t('con la sesión bloqueada, el lanzamiento aprobado no ocurre', !(await page.evaluate(async () => (await window.__harness.desktop.fake.listWindows()).some((w) => w.processName === 'Code.exe'))));
  const failed = await page.evaluate(() => window.__harness.agent.agentRuntime.snapshot().run.steps.find((x) => x.toolId === 'app.launch'));
  t('el paso falla con el motivo de la sesión', failed?.status === 'failed' && /bloqueado/.test(failed?.error ?? ''), failed?.error);
  t('sin errores de página', page.__errors.length === 0, page.__errors.join(' | '));
  await page.close();
});

await run('Control del equipo: atajo de emergencia en Settings > Atajos', async () => {
  const page = await newPage();
  await page.evaluate(() => {
    window.__harness.stores.useUIStore.getState().setModule('settings');
    window.__harness.stores.useSettingsStore.getState().setSection?.('shortcuts');
  });
  await page.waitForTimeout(200);
  if ((await page.locator('[data-testid="emergency-shortcut"]').count()) === 0) {
    await page.getByRole('button', { name: /Atajos|Shortcuts/ }).first().click().catch(() => {});
    await page.waitForTimeout(200);
  }
  const box = page.locator('[data-testid="emergency-shortcut"]');
  t('la sección de emergencia aparece', (await box.count()) === 1);
  const text = await box.innerText();
  t('describe su propósito: cancelar todo el control', text.includes('Cancelar todo el control del equipo'));
  t('muestra la combinación por defecto', (await page.locator('[data-testid="emergency-input"]').inputValue()) === 'Control+Alt+Escape');
  await page.getByRole('button', { name: 'Guardar' }).click();
  await page.waitForTimeout(150);
  t('fuera de Electron, dice honestamente que no puede registrarlo', (await page.locator('[data-testid="emergency-error"]').innerText()).includes('aplicación de escritorio'));
  await page.screenshot({ path: path.join(SHOTS, '26-emergency-shortcut.png') });
  t('sin errores de página', page.__errors.length === 0, page.__errors.join(' | '));
  await page.close();
});

/* ================================================================== */
/* Developer Agent (in-memory Windows-flavoured ports, real App)       */
/* ================================================================== */
const APP = 'D:\\Projects\\vigilia-app';
const MATH = `${APP}\\src\\math.ts`;
const BUGGY_SUM = 'export const sum = (a: number, b: number) => a - b;\n';
const installDev = async (page) => { await page.evaluate(() => window.__harness.dev.install()); await page.waitForTimeout(80); };
const devh = (page, fn, arg) => page.evaluate(([f, a]) => new Function('h', 'a', `return (${f})(h, a)`)(window.__harness.devh, a), [fn.toString(), arg]);
const diskText = (page, p) => page.evaluate((x) => window.__harness.devh.text(x), p);
const setModule = (page, m) => page.evaluate((x) => window.__harness.stores.useUIStore.getState().setModule(x), m);
const devState = (page, k) => page.evaluate((x) => { const v = window.__harness.stores.useDevStore.getState()[x]; return typeof v === 'function' ? null : JSON.parse(JSON.stringify(v)); }, k);
const submit = (page, prompt, level = 'ADMIN') => page.evaluate(([p, l]) => {
  const s = window.__harness.stores.useJarvisStore.getState();
  s.setPermission(l);
  window.__harness.stores.useUIStore.getState().setJarvisOpen(true);
  s.submit(p);
}, [prompt, level]);
const lastRun = (page) => page.evaluate(() => JSON.parse(JSON.stringify(window.__harness.agent.agentRuntime.snapshot().run)));
const openWorkspace = async (page, name = 'vigilia-app') => {
  await setModule(page, 'projects');
  await page.waitForSelector(`[data-testid="project-row"][data-name="${name}"]`, { timeout: 5000 });
  await page.locator(`[data-testid="project-row"][data-name="${name}"]`).getByRole('button', { name: 'Coding Workspace' }).click({ force: true });
  await page.waitForSelector('[data-testid="coding-workspace"][data-state="open"]', { timeout: 5000 });
};
const openFileInExplorer = async (page, rel) => {
  await page.locator('[data-testid="explorer-search"]').fill(rel.split('/').pop());
  await page.locator(`[data-testid="explorer-file"][data-path="${rel}"]`).first().click();
  await page.waitForSelector(`[data-testid="editor-tab"][data-path="${rel}"]`, { timeout: 3000 });
  await page.locator('[data-testid="explorer-search"]').fill('');
};

await run('Developer Agent: Projects real', async () => {
  const page = await newPage();
  await setModule(page, 'projects');
  await page.waitForTimeout(200);
  t('sin backend: estado honesto, sin datos inventados', (await page.locator('[data-testid="projects-unavailable"]').count()) === 1 && (await page.locator('[data-testid="project-row"]').count()) === 0);
  await installDev(page);
  await page.waitForSelector('[data-testid="project-row"]', { timeout: 5000 });
  const names = await page.locator('[data-testid="project-row"]').evaluateAll((els) => els.map((e) => e.dataset.name));
  t('muestra los proyectos descubiertos en los roots', ['vigilia-app', 'clean-lib', 'reforger-tools', 'monorepo'].every((n) => names.includes(n)), names.join());
  const vig = page.locator('[data-testid="project-row"][data-name="vigilia-app"]');
  const vtext = await vig.innerText();
  t('nombre, ruta y tecnologías', vtext.includes('D:\\Projects\\vigilia-app') && /TypeScript/.test(vtext) && /Vite/.test(vtext) && /React/.test(vtext));
  t('estado Git: cambios previos del usuario', /main/.test(await vig.locator('[data-testid="project-git"]').innerText()) && /2/.test(await vig.locator('[data-testid="project-git"]').innerText()));
  t('clean-lib aparece limpio', /limpio/i.test(await page.locator('[data-testid="project-row"][data-name="clean-lib"] [data-testid="project-git"]').innerText()));
  t('estado del índice antes de abrir', /sin indexar/.test(await vig.locator('[data-testid="project-index"]').innerText()));
  t('los Project Roots se listan', (await page.locator('[data-testid="project-root"]').innerText()).includes('D:\\Projects'));
  await page.locator('[data-testid="root-input"]').fill('C:\\');
  await page.getByRole('button', { name: /Añadir/ }).click();
  await page.waitForTimeout(150);
  t('C:\\ entero se rechaza como root con un error visible', /unidad completa/.test(await page.locator('[data-testid="projects-error"]').innerText().catch(() => '')));
  await page.screenshot({ path: path.join(SHOTS, '30-projects.png') });
  await vig.getByRole('button', { name: 'Coding Workspace' }).click({ force: true });
  await page.waitForSelector('[data-testid="coding-workspace"][data-state="open"]', { timeout: 5000 });
  t('Open Coding Workspace abre el proyecto indexado', (await page.locator('[data-testid="workspace-project"]').innerText()) === 'vigilia-app' && (await uiState(page, 'module')) === 'coding');
  await setModule(page, 'projects');
  await page.waitForTimeout(200);
  t('tras abrirlo, el índice y la última apertura se actualizan', /archivos indexados/.test(await page.locator('[data-testid="project-row"][data-name="vigilia-app"] [data-testid="project-index"]').innerText()));
  await page.locator('[data-testid="project-row"][data-name="clean-lib"]').getByRole('button', { name: 'Pedir a JARVIS' }).click({ force: true });
  await runSettled(page);
  const run = await lastRun(page);
  t('Ask JARVIS: revisión de sólo lectura, sin escrituras', run.prompt.includes('clean-lib') && run.steps.every((s) => !/^(file\.(write|patch|create)|terminal\.)/.test(s.toolId ?? '')));
  t('sin errores de página', page.__errors.length === 0, page.__errors.join(' | '));
  await page.close();
});

await run('Developer Agent: Coding Workspace, editor y pestañas', async () => {
  const page = await newPage();
  await installDev(page);
  await openWorkspace(page);
  t('explorador con carpetas perezosas (no todos los archivos)', (await page.locator('[data-testid="explorer-folder"]').count()) > 0 && (await page.locator('[data-testid="explorer-file"][data-path="src/math.ts"]').count()) === 0);
  await page.locator('[data-testid="explorer-folder"][data-path="src"]').click();
  t('abrir una carpeta muestra su contenido', (await page.locator('[data-testid="explorer-file"][data-path="src/math.ts"]').count()) === 1);
  await page.locator('[data-testid="explorer-file"][data-path="src/math.ts"]').click();
  await page.waitForSelector('[data-testid="editor-tab"][data-path="src/math.ts"]');
  const ta = page.locator('[data-testid="editor-textarea"]');
  t('abrir archivo carga su contenido real', (await ta.inputValue()) === BUGGY_SUM);
  t('pestaña activa y limpia', (await page.locator('[data-testid="editor-tab"][data-path="src/math.ts"]').getAttribute('data-active')) === 'yes' && (await page.locator('[data-testid="tab-modified"]').count()) === 0);
  await ta.click();
  await ta.press('End');
  await page.keyboard.press('Control+End');
  await ta.type('// nota\n');
  t('editar marca el indicador de modificado', (await page.locator('[data-testid="editor-tab"][data-path="src/math.ts"]').getAttribute('data-dirty')) === 'yes' && (await page.locator('[data-testid="tab-modified"]').count()) === 1);
  t('línea y columna del cursor', /Ln 3, Col 1/.test(await page.locator('[data-testid="editor-cursor"]').innerText()), await page.locator('[data-testid="editor-cursor"]').innerText());
  await page.keyboard.press('Control+s');
  await page.waitForTimeout(200);
  t('Ctrl+S guarda en disco (escritura atómica del servicio)', (await diskText(page, MATH)) === BUGGY_SUM + '// nota\n');
  t('…y limpia el indicador', (await page.locator('[data-testid="tab-modified"]').count()) === 0);
  t('un guardado del usuario NO entra en los cambios de JARVIS', (await devh(page, (h) => h.service.files.changes.list().length)) === 0);
  await openFileInExplorer(page, 'src/browser/TabManager.ts');
  t('varias pestañas abiertas', (await page.locator('[data-testid="editor-tab"]').count()) === 2);
  await page.locator('[data-testid="editor-tab"][data-path="src/math.ts"]').click();
  t('cambiar de pestaña cambia el archivo activo', (await ta.inputValue()).startsWith('export const sum'));
  await page.locator('[data-testid="editor-tab"][data-path="src/browser/TabManager.ts"] [data-testid="tab-close"]').click();
  t('cerrar una pestaña', (await page.locator('[data-testid="editor-tab"]').count()) === 1);
  await page.locator('[data-testid="explorer-search"]').fill('TabMan');
  t('búsqueda en el explorador', (await page.locator('[data-testid="explorer-file"][data-path="src/browser/TabManager.ts"]').count()) === 1);
  await page.locator('[data-testid="explorer-search"]').fill('zzzz-nada');
  t('búsqueda sin resultados lo dice', (await page.locator('[data-testid="explorer-no-results"]').count()) === 1);
  await page.locator('[data-testid="explorer-search"]').fill('');
  // Conflict: a human edits the file on disk while it is open and modified here.
  await ta.type('x');
  await devh(page, (h) => h.userEdit('D:\\Projects\\vigilia-app\\src\\math.ts', 'editado fuera\n'));
  await page.locator('[data-testid="editor-save"]').click();
  await page.waitForTimeout(200);
  t('guardar sobre un archivo cambiado fuera → conflicto visible, no sobrescribe', (await page.locator('[data-testid="editor-conflict"]').count()) === 1 && (await diskText(page, MATH)) === 'editado fuera\n');
  await page.locator('[data-testid="editor-reload"]').click();
  await page.waitForTimeout(150);
  t('recargar trae la versión del disco', (await ta.inputValue()) === 'editado fuera\n' && (await page.locator('[data-testid="editor-conflict"]').count()) === 0);
  await devh(page, (h) => h.userEdit('D:\\Projects\\vigilia-app\\src\\math.ts', 'export const sum = (a: number, b: number) => a - b;\n'));
  await openFileInExplorer(page, '.env');
  t('.env se abre de sólo lectura y redactado', (await page.locator('[data-testid="editor-readonly"]').count()) === 1 && !(await ta.inputValue()).includes('sk-live') && (await ta.inputValue()).includes('[redactado]'));
  await page.screenshot({ path: path.join(SHOTS, '31-coding-workspace.png') });
  t('sin errores de página', page.__errors.length === 0, page.__errors.join(' | '));
  await page.close();
});

await run('Developer Agent: UNDERSTAND → CHANGE → VERIFY con reparación', async () => {
  const page = await newPage();
  await installDev(page);
  await openWorkspace(page);
  await devh(page, (h) => h.setProposer('repair'));
  await submit(page, 'Corrige las pruebas del proyecto vigilia-app', 'ADMIN');
  await runSettled(page);
  const run = await lastRun(page);
  const delegate = run.steps.find((s) => s.kind === 'delegate');
  t('el fixture termina con checks pasados tras 2 intentos sin fingir recibo main', run.status === 'completed' && /Comprobaciones pasan/.test(delegate?.summary ?? '') && /2 intento/.test(delegate?.summary ?? '') && delegate?.outcome === 'unverified', delegate?.summary ?? delegate?.error);
  t('la respuesta final diferencia fixture de resultado verificado por main', /Resultado no verificado/.test(run.answer ?? '') && !/aprobaci[oó]n/.test(run.answer ?? ''), run.answer ?? '');
  t('el disco tiene la corrección', (await diskText(page, MATH)).includes('a + b'));
  const phases = await page.locator('[data-testid="substep"]').evaluateAll((els) => [...new Set(els.map((e) => e.dataset.phase))]);
  t('el panel agrupa sub-pasos en Entender, Cambiar y Verificar', ['Entender', 'Cambiar', 'Verificar'].every((p) => phases.includes(p)), phases.join());
  const subs = await page.locator('[data-testid="substep"]').allInnerTexts();
  t('sub-pasos en lenguaje natural', subs.some((x) => /Aplicando parche a src\/math\.ts/.test(x)) && subs.some((x) => /Verificando/.test(x)));
  await page.evaluate(() => window.__harness.stores.useJarvisStore.getState().setActivityExpanded(true));
  await page.waitForTimeout(150);
  const tools = await page.locator('[data-testid="activity-tool"]').allInnerTexts();
  t('Activity expandido muestra los ToolCalls reales', ['project.open', 'git.status', 'code.context', 'file.read', 'file.patch', 'terminal.execute'].every((x) => tools.some((y) => y.startsWith(x))), tools.slice(0, 8).join(' | '));
  await page.screenshot({ path: path.join(SHOTS, '32-coding-run.png') });

  // Review Changes
  await page.locator('[data-testid="bottom-changes"]').click();
  await page.waitForSelector('[data-testid="changeset"]', { timeout: 5000 });
  const cs = page.locator(`[data-testid="changeset"][data-run="${run.id}"]`);
  t('Review Changes del run: M src/math.ts', (await cs.locator('[data-testid="changeset-file"][data-status="M"]').innerText()).includes('src/math.ts'));
  t('líneas añadidas/eliminadas', /\+1/.test(await cs.innerText()) && /−1|-1/.test(await cs.innerText()));
  const pre = await cs.locator('[data-testid="preexisting"]').innerText().catch(() => '');
  t('los cambios previos del usuario se muestran aparte (no son de JARVIS)', pre.includes('README.md') && pre.includes('notes.md') && !(await cs.locator('[data-testid="changeset-file"]').allInnerTexts()).some((x) => /README|notes/.test(x)));
  const ver = await cs.locator('[data-testid="verifications"]').innerText().catch(() => '');
  t('comprobaciones del fixture realizadas; falta prueba main', /npm test/.test(ver) && /npm run typecheck/.test(ver) && /Sin verificar/.test(await cs.locator('[data-testid="changeset-state"]').innerText()));
  await cs.locator('[data-testid="review-file"]').first().click();
  await page.waitForSelector('[data-testid="diff-viewer"]');
  const unified = await page.locator('[data-testid="diff-table-unified"]').innerText();
  t('Diff unificado con la línea antes y después', unified.includes('a - b') && unified.includes('a + b'));
  t('contadores +1 / −1', (await page.locator('[data-testid="diff-added"]').innerText()) === '+1' && (await page.locator('[data-testid="diff-removed"]').innerText()) === '−1');
  await page.locator('[data-testid="diff-split"]').click();
  t('vista antes / después', (await page.locator('[data-testid="diff-table-split"]').count()) === 1);
  await page.screenshot({ path: path.join(SHOTS, '33-diff.png') });
  await page.locator('[data-testid="diff-revert-file"]').click();
  await page.waitForTimeout(200);
  t('Revert File devuelve math.ts al estado previo', (await diskText(page, MATH)) === BUGGY_SUM);
  t('…con resultado de éxito visible', (await page.locator('[data-testid="revert-result"]').getAttribute('data-kind')) === 'success');

  // Terminal
  await page.locator('[data-testid="bottom-terminal"]').click();
  const cmds = page.locator('[data-testid="terminal-command"]');
  const statuses = await cmds.evaluateAll((els) => els.map((e) => e.dataset.status));
  t('terminal: comandos con éxito y con fallo', statuses.includes('passed') && statuses.includes('failed'), statuses.join());
  const first = await cmds.first().innerText();
  t('muestra comando, cwd, exit code y duración', /npm/.test(first) && first.includes('D:\\Projects\\vigilia-app') && (await cmds.first().locator('[data-testid="terminal-exit"]').count()) === 1 && (await cmds.first().locator('[data-testid="terminal-duration"]').count()) === 1);
  const failed = page.locator('[data-testid="terminal-command"][data-status="failed"]').first();
  const outputOf = async () => (await failed.locator('[data-testid="terminal-output"]').count()) ? failed.locator('[data-testid="terminal-output"]').innerText() : null;
  t('un comando fallido muestra su error sin pedirlo', /debería ser 5, dio (-1|6)/.test((await outputOf()) ?? ''));
  await failed.locator('[data-testid="terminal-label"]').click();
  t('…se puede plegar', (await outputOf()) === null);
  await failed.locator('[data-testid="terminal-label"]').click();
  t('…y volver a expandir', /debería ser 5, dio (-1|6)/.test((await outputOf()) ?? ''));
  t('sin errores de página', page.__errors.length === 0, page.__errors.join(' | '));
  await page.close();
});

await run('Developer Agent: límite de reparación, sin modelo y Undo', async () => {
  const page = await newPage();
  await installDev(page);
  await openWorkspace(page);
  await devh(page, (h) => { h.setProposer('never'); h.setMaxRepair(2); });
  await submit(page, 'Corrige las pruebas del proyecto vigilia-app');
  await runSettled(page);
  let run = await lastRun(page);
  let d = run.steps.find((s) => s.kind === 'delegate');
  t('se detiene en el límite y explica qué cambió y qué falla', d.status === 'failed' && /Me detuve tras 2 intentos/.test(d.error) && /Último error/.test(d.error), d.error);
  t('el panel lo muestra', /Me detuve tras 2 intentos/.test(await page.locator('body').innerText()));
  await devh(page, (h) => h.setMaxRepair(3));

  await devh(page, (h) => h.userEdit('D:\\Projects\\vigilia-app\\src\\math.ts', 'export const sum = (a: number, b: number) => a - b;\n'));
  await devh(page, (h) => h.setProposer('none'));
  await submit(page, 'Arregla el build del proyecto vigilia-app');
  await runSettled(page);
  run = await lastRun(page);
  d = run.steps.find((s) => s.kind === 'delegate');
  t('sin modelo: lo dice, no inventa cambios', /No hay un modelo configurado/.test(d.error ?? '') && (await diskText(page, MATH)) === BUGGY_SUM);

  await devh(page, (h) => h.setProposer('fix'));
  await submit(page, 'Corrige las pruebas del proyecto vigilia-app');
  await runSettled(page);
  t('corrección aplicada', (await diskText(page, MATH)).includes('a + b'));
  await page.locator('[data-testid="bottom-changes"]').click();
  await page.locator('[data-testid="undo-last"]').click();
  await page.waitForTimeout(200);
  t('Undo Last JARVIS Change: éxito', (await diskText(page, MATH)) === BUGGY_SUM && (await page.locator('[data-testid="revert-result"]').getAttribute('data-kind')) === 'success');

  await submit(page, 'Corrige las pruebas del proyecto vigilia-app');
  await runSettled(page);
  run = await lastRun(page);
  await devh(page, (h) => h.userEdit('D:\\Projects\\vigilia-app\\src\\math.ts', 'export const sum = (a: number, b: number) => a + b + 0; // usuario\n'));
  await page.waitForTimeout(100);
  await page.locator(`[data-testid="changeset"][data-run="${run.id}"] [data-testid="revert-run"]`).click();
  await page.waitForTimeout(250);
  const res = page.locator('[data-testid="revert-result"]');
  t('Revert Run sobre una línea reescrita por el usuario → conflicto visible', (await res.getAttribute('data-kind')) === 'conflict' && /conflicto/i.test(await res.innerText()));
  t('…y el trabajo del usuario se conserva', (await diskText(page, MATH)).includes('// usuario'));
  await page.screenshot({ path: path.join(SHOTS, '34-revert-conflict.png') });
  t('sin errores de página', page.__errors.length === 0, page.__errors.join(' | '));
  await page.close();
});

await run('Developer Agent: terminal (salida larga, cancelar, servicios)', async () => {
  const page = await newPage();
  await installDev(page);
  await openWorkspace(page);
  await page.locator('[data-testid="bottom-terminal"]').click();
  await devh(page, (h) => { h.setTests('long'); h.setProposer('none'); });
  await submit(page, 'Ejecuta las pruebas del proyecto vigilia-app');
  await runSettled(page);
  const big = page.locator('[data-testid="terminal-command"]').filter({ hasText: 'npm test' }).last();
  t('salida larga: indicada como truncada', (await big.locator('[data-testid="terminal-truncated"]').count()) === 1);
  // Failed commands open by themselves; open it only if it is not already.
  if ((await big.locator('[data-testid="terminal-search"]').count()) === 0) await big.locator('[data-testid="terminal-label"]').click();
  await big.locator('[data-testid="terminal-search"]').fill('caso 4321');
  await big.locator('[data-testid="terminal-search"]').press('Enter');
  await page.waitForTimeout(250);
  t('búsqueda dentro de la salida completa guardada', /caso 4321/.test(await big.locator('[data-testid="terminal-search-results"]').innerText().catch(() => '')));

  await devh(page, (h) => h.setTests('slow'));
  const spawnedBefore = await devh(page, h => h.port.spawned.filter(s => s.command === 'npm test').length);
  await submit(page, 'Ejecuta las pruebas del proyecto vigilia-app');
  await page.waitForSelector('[data-testid="terminal-command"][data-status="running"]', { timeout: 5000 });
  // UI running precedes async executable resolution. This assertion tests STOP
  // on an actually spawned process; pre-spawn cancellation correctly creates none.
  await page.waitForFunction(before => window.__harness.devh.port.spawned.filter(s => s.command === 'npm test').length > before, spawnedBefore, { timeout: 5000 });
  t('comando en curso visible con botón Stop', (await page.locator('[data-testid="terminal-command"][data-status="running"] [data-testid="terminal-stop"]').count()) === 1);
  await page.locator('[data-testid="terminal-stop"]').first().click();
  await runSettled(page);
  t('Stop cancela el comando y el run', (await page.locator('[data-testid="terminal-command"][data-status="cancelled"]').count()) >= 1 && (await lastRun(page)).status === 'cancelled');
  // STOP settles the run first and tears the tree down right after, so poll.
  let killed = false;
  for (let i = 0; i < 30 && !killed; i++) {
    killed = await devh(page, (h) => h.port.spawned.some((s) => s.command === 'npm test' && s.killed));
    if (!killed) await page.waitForTimeout(100);
  }
  t('el árbol del proceso se mató (killTree en el puerto)', killed);

  await devh(page, (h) => h.service.managed.start({ executable: 'npm', args: ['run', 'dev'], cwd: 'D:\\Projects\\vigilia-app' }, { runId: null, label: 'npm run dev' }));
  await page.locator('[data-testid="terminal-services"]').click().catch(() => {});
  await page.waitForSelector('[data-testid="managed-process"][data-status="running"]', { timeout: 3000 }).catch(() => {});
  t('proceso largo: Running', (await page.locator('[data-testid="managed-process"][data-status="running"]').count()) === 1);
  await page.locator('[data-testid="process-logs"]').click();
  t('View logs muestra su salida', /localhost:5173/.test(await page.locator('[data-testid="process-log-output"]').innerText().catch(() => '')));
  await page.locator('[data-testid="process-stop"]').click();
  await page.waitForTimeout(200);
  t('Stop detiene el servicio', (await page.locator('[data-testid="managed-process"][data-status="stopped"]').count()) === 1);
  await page.screenshot({ path: path.join(SHOTS, '35-terminal.png') });
  t('sin errores de página', page.__errors.length === 0, page.__errors.join(' | '));
  await page.close();
});

await run('Developer Agent: permisos, aprobación, cambios masivos, .env', async () => {
  const page = await newPage();
  await installDev(page);
  await openWorkspace(page);
  await devh(page, (h) => h.setProposer('fix'));
  await submit(page, 'Corrige las pruebas del proyecto vigilia-app', 'OBSERVE');
  await runSettled(page);
  t('OBSERVE: ninguna escritura ni comando', (await diskText(page, MATH)) === BUGGY_SUM && (await lastRun(page)).steps.filter((s) => s.toolId === 'file.patch' || s.toolId === 'terminal.execute').every((s) => s.status !== 'completed'));
  await submit(page, 'Corrige las pruebas del proyecto vigilia-app', 'ASSIST');
  await runSettled(page);
  t('ASSIST: propone pero no aplica', (await diskText(page, MATH)) === BUGGY_SUM);

  await submit(page, 'Corrige las pruebas del proyecto vigilia-app', 'CONTROL');
  await page.waitForSelector('[role="alertdialog"]', { timeout: 5000 });
  const dtext = await page.locator('[role="alertdialog"]').innerText();
  t('CONTROL: aprobación real para ejecutar comandos', /terminal\.execute/.test(dtext));
  await page.getByRole('button', { name: /Permitir en esta tarea|Permitir para esta tarea/ }).click();
  await page.waitForSelector('[role="alertdialog"]', { timeout: 5000 });
  t('…y otra para escribir', /file\.patch/.test(await page.locator('[role="alertdialog"]').innerText()));
  await page.getByRole('button', { name: /Permitir en esta tarea|Permitir para esta tarea/ }).click();
  await runSettled(page);
  t('tras aprobar, corrige y verifica', (await diskText(page, MATH)).includes('a + b') && (await lastRun(page)).status === 'completed');

  await devh(page, (h) => h.setProposer('mass'));
  await submit(page, 'Renombra los valores en los módulos del proyecto vigilia-app', 'ADMIN');
  await page.waitForSelector('[role="alertdialog"]', { timeout: 6000 }).catch(() => {});
  const mtext = await page.locator('[role="alertdialog"]').innerText().catch(() => '');
  t('FULL CONTROL: el 5.º archivo de la tarea exige aprobación (cambio masivo)', /Cambio masivo/.test(mtext) && /DESTRUCTIVE/.test(mtext), mtext.slice(0, 200));
  await page.screenshot({ path: path.join(SHOTS, '36-mass-change.png') });
  await page.getByRole('button', { name: /Denegar/ }).click();
  await runSettled(page);
  const m = await Promise.all([0, 1, 2, 3, 4].map((i) => diskText(page, `${APP}\\src\\mods\\m${i}.ts`)));
  t('denegado: el archivo que excedía el límite no se tocó', m.filter((x) => x.includes('= 10')).length <= 4 && m[4] === 'export const v4 = 4;\n', JSON.stringify(m));

  const envTools = await page.evaluate(async () => {
    const { toolBroker } = window.__harness.agent;
    return (await toolBroker.execute({ runId: 'no-open', toolId: 'file.read', args: { path: '.env' } })).ok;
  });
  t('una llamada fuera de un run abierto se rechaza', envTools === false);
  t('el audit nunca contiene el secreto del .env', !(await page.evaluate(() => JSON.stringify(window.__harness.agent.auditService.list()))).includes('sk-live'));
  t('sin errores de página', page.__errors.length === 0, page.__errors.join(' | '));
  await page.close();
});

await run('Developer Agent: PAUSE / RESUME / STOP y Git mixto', async () => {
  const page = await newPage();
  await installDev(page);
  await openWorkspace(page);
  await devh(page, (h) => h.setProposer('pause'));
  await submit(page, 'Corrige las pruebas del proyecto vigilia-app');
  await page.waitForFunction(() => window.__harness.agent.agentRuntime.snapshot().run?.status === 'paused', null, { timeout: 5000 }).catch(() => {});
  await page.waitForTimeout(300);
  t('PAUSE: el parche propuesto no se escribe mientras está en pausa', (await lastRun(page)).status === 'paused' && (await diskText(page, MATH)) === BUGGY_SUM);
  await page.evaluate(() => window.__harness.stores.useJarvisStore.getState().resume());
  await runSettled(page);
  t('RESUME: continúa, escribe y verifica', (await lastRun(page)).status === 'completed' && (await diskText(page, MATH)).includes('a + b'));
  // Mixed: the user edits another tracked file after JARVIS.
  await devh(page, (h) => h.userEdit('D:\\Projects\\vigilia-app\\src\\App.tsx', '// cambio del usuario\n'));
  const review = await page.evaluate(async () => {
    const { toolBroker } = window.__harness.agent;
    const { CancellationToken } = window.__harness.agent.cancellation ?? {};
    void CancellationToken;
    const c = window.__harness.devh.service;
    const run = window.__harness.agent.agentRuntime.snapshot().run;
    const summary = c.files.changes.summary(run.id);
    const now = await c.git.dirtyPaths('D:\\Projects\\vigilia-app');
    return { files: summary.files.map((f) => f.path), now, pre: c.files.changes.get(run.id).preExisting };
  });
  t('Git mixto: previos = README/notes; JARVIS = math.ts; usuario después = App.tsx', review.pre.includes('README.md') && review.files.length === 1 && review.files[0].endsWith('math.ts') && review.now.includes('src/App.tsx') && !review.pre.includes('src/App.tsx'), JSON.stringify(review));
  await devh(page, (h) => h.setTests('slow'));
  await submit(page, 'Ejecuta las pruebas del proyecto vigilia-app');
  await page.waitForSelector('[data-testid="terminal-command"][data-status="running"]', { timeout: 5000 }).catch(() => {});
  await page.evaluate(() => window.__harness.stores.useJarvisStore.getState().stop());
  await runSettled(page);
  t('STOP global detiene el comando en curso', (await lastRun(page)).status === 'cancelled' && (await devh(page, (h) => h.service.terminal.runningCount())) === 0);
  t('sin errores de página', page.__errors.length === 0, page.__errors.join(' | '));
  await page.close();
});

await run('Developer Agent: paleta de comandos', async () => {
  const page = await newPage();
  await installDev(page);
  await openWorkspace(page);
  const palette = async (q) => {
    await page.evaluate(() => window.__harness.stores.useUIStore.getState().setPalette(true));
    await page.waitForTimeout(100);
    await page.keyboard.type(q);
    await page.waitForTimeout(500);
    return page.locator('body').innerText();
  };
  const close = async () => { await page.keyboard.press('Escape'); await page.waitForTimeout(80); };
  t('open project', /vigilia-app/.test(await palette('open project vigilia')));
  await close();
  t('open coding workspace', /Abrir Coding Workspace/.test(await palette('open coding workspace')));
  await close();
  t('run tests usa el proyecto activo', /Ejecutar pruebas de vigilia-app/.test(await palette('run tests')));
  await close();
  t('git status', /git status/.test(await palette('git status')));
  await close();
  t('show changes', /Mostrar cambios de JARVIS/.test(await palette('show changes')));
  await close();
  t('undo JARVIS changes (pasa por aprobación)', /Deshacer cambios de JARVIS/.test(await palette('undo jarvis')));
  await close();
  t('find file sobre el índice real', /TabManager\.ts/.test(await palette('find file tabmanager')));
  await page.keyboard.press('Enter');
  await page.waitForTimeout(200);
  t('…Enter abre el archivo en el editor', (await page.locator('[data-testid="editor-tab"][data-path="src/browser/TabManager.ts"]').count()) === 1);
  t('find symbol', /Buscar símbolo TabManager/.test(await palette('find symbol TabManager')));
  await page.keyboard.press('Enter');
  await runSettled(page);
  const run = await lastRun(page);
  t('…ejecuta definición + referencias por el broker', run.steps.some((s) => s.toolId === 'code.findDefinition' && s.status === 'completed'));
  await palette('open terminal');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(150);
  t('open terminal', (await page.locator('[data-testid="terminal-panel"]').count()) === 1);
  t('sin errores de página', page.__errors.length === 0, page.__errors.join(' | '));
  await page.close();
});

await run('Developer Agent: robustez, rendimiento e higiene', async () => {
  const page = await newPage();
  await installDev(page);
  await openWorkspace(page, 'monorepo');
  await page.locator('[data-testid="explorer-folder"][data-path="src"]').click();
  await page.locator('[data-testid="explorer-folder"][data-path="src/gen"]').click();
  const shown = await page.locator('[data-testid="explorer-file"][data-path^="src/gen/"]').count();
  t(`1.500 archivos: el explorador no los pinta todos (${shown} de src/gen)`, shown > 0 && shown <= 300 && (await page.locator('[data-testid="explorer-more"]').count()) === 1);
  await page.locator('[data-testid="explorer-search"]').fill('file1499');
  t('…pero la búsqueda los alcanza', (await page.locator('[data-testid="explorer-file"][data-path="src/gen/file1499.ts"]').count()) === 1);
  await page.locator('[data-testid="explorer-search"]').fill('');

  // Corrupt / stale situations must never blank the app.
  await page.evaluate(() => window.__harness.stores.useDevStore.getState().openProject('proj_no_existe'));
  await page.waitForTimeout(150);
  t('project ID obsoleto: error visible, app viva', (await page.locator('[data-testid="dev-error"]').count()) >= 1 && await notBlank(page));
  await openWorkspace(page);
  await openFileInExplorer(page, 'src/browser/TabManager.ts');
  await devh(page, (h) => h.vanish('D:\\Projects\\vigilia-app\\src\\browser\\TabManager.ts'));
  await page.evaluate(() => window.__harness.stores.useDevStore.getState().reloadTab('src/browser/TabManager.ts'));
  await page.waitForTimeout(150);
  t('archivo desaparecido: error en el editor, app viva', (await page.locator('[data-testid="editor-error"]').count()) === 1 && await notBlank(page));
  await page.evaluate(() => window.__harness.stores.useDevStore.getState().showChangeDiff('run-inexistente', 'D:\\x.ts'));
  await page.waitForTimeout(150);
  t('ChangeSet inexistente: diff con error, app viva', (await page.locator('[data-testid="dev-error"]').innerText()).includes('ya no está disponible') && await notBlank(page));
  await page.evaluate(() => window.__harness.stores.useDevStore.setState({ diff: { title: 'roto', runId: null, path: 'x', before: null, after: undefined, diff: 42 } }));
  await page.waitForTimeout(150);
  t('diff inválido: lo contiene el Error Boundary, app viva', await notBlank(page) && (await page.locator('[data-testid="coding-workspace"]').count()) === 1);
  await page.evaluate(() => window.__harness.stores.useDevStore.getState().closeDiff());
  const stopGone = await page.evaluate(() => window.__harness.dev.controller().stopProcess('svc_desaparecido').then(() => 'ok', (e) => e.message));
  t('proceso desaparecido: error claro, sin romper', /no inició/.test(stopGone) && await notBlank(page));

  // Hygiene: mount/unmount the workspace repeatedly.
  for (let i = 0; i < 10; i++) { await setModule(page, i % 2 ? 'coding' : 'projects'); await page.waitForTimeout(30); }
  await setModule(page, 'coding');
  await page.waitForTimeout(100);
  t('una sola suscripción al backend tras 10 montajes', (await devState(page, 'subscriptions')) === 1 && (await page.evaluate(() => window.__harness.dev.controller().listeners.size)) <= 2);
  await setModule(page, 'markets');
  await page.waitForTimeout(100);
  t('al salir, la suscripción se libera', (await devState(page, 'subscriptions')) === 0);
  await setModule(page, 'coding');
  await page.waitForTimeout(100);
  await openFileInExplorer(page, 'src/math.ts');
  const saves = await page.evaluate(async () => {
    const c = window.__harness.dev.controller();
    let n = 0;
    const orig = c.saveFile.bind(c);
    c.saveFile = (...a) => { n++; return orig(...a); };
    window.__saves = () => n;
    return true;
  });
  void saves;
  await page.locator('[data-testid="editor-textarea"]').type('// y');
  await page.keyboard.press('Control+s');
  await page.waitForTimeout(200);
  t('Ctrl+S tras 10 montajes guarda una sola vez (sin listeners duplicados)', (await page.evaluate(() => window.__saves())) === 1);
  t('sin errores de página no controlados', page.__errors.filter((e) => !/Error Boundary|ErrorBoundary|roto|42/.test(e)).length === 0, page.__errors.join(' | '));
  await page.close();
});

await browser.close();
server.close();

console.log(`\ncapturas en ${SHOTS}`);
console.log(`\n${pass} ok · ${fail} fallos\n`);
if (failures.length) console.log('fallos:\n' + failures.map((f) => '  · ' + f).join('\n'));
process.exit(fail ? 1 : 0);
