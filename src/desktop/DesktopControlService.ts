import type {
  Bounds, ControlStatus, DiscoveredApp, MouseButton, MouseTarget, UIFindQuery, WindowInfo,
} from '@/types';
import type { AdapterMap } from '@/agent/adapters/types';
import type { ToolPolicy } from '@/agent/ToolBroker';
import type { ToolDefinition } from '@/types';
import type { WindowsAutomationAdapter } from './adapter';
import { UnavailableAutomationAdapter } from './adapter';
import { ControlGate } from './ControlGate';
import { WindowService } from './WindowService';
import { UIAutomationService } from './UIAutomationService';
import { buildUIContext } from './UIContextBuilder';
import { ScreenCaptureService } from './ScreenCaptureService';
import { VisionService } from './VisionService';
import { InputService, containsSecret } from './InputService';
import { HumanOverrideDetector } from './HumanOverrideDetector';
import type { HumanInputSource } from './HumanOverrideDetector';
import { SessionStateService } from './SessionStateService';
import { ProcessService } from './ProcessService';
import { DesktopSnapshotService } from './DesktopSnapshotService';
import { runWithStrategies } from './InteractionStrategy';

export interface DesktopControlOptions {
  adapter?: WindowsAutomationAdapter;
  humanInput?: HumanInputSource | null;
  /** Apps from ApplicationService. Only these can ever be launched. */
  apps?: () => Promise<DiscoveredApp[]>;
  /** Called when the user grabs the mouse, so the runtime can pause. */
  onHumanOverride?: () => void;
}

/* Argument guards: every tool validates its own shape, nothing is passed raw. */
const str = (v: unknown, name: string): string => {
  if (typeof v !== 'string' || !v.trim()) throw new Error(`Falta el argumento «${name}».`);
  return v;
};
const num = (v: unknown, name: string): number => {
  if (typeof v !== 'number' || !Number.isFinite(v)) throw new Error(`«${name}» debe ser un número.`);
  return v;
};
const rec = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' ? v as Record<string, unknown> : {});

function mouseTarget(args: Record<string, unknown>): MouseTarget {
  if (typeof args.target === 'string') {
    if (!/^(ui|vision):\d+$/.test(args.target)) throw new Error('El objetivo debe ser una referencia ui:N o vision:N.');
    return { target: args.target as MouseTarget extends { target: infer T } ? T : never };
  }
  if (typeof args.x === 'number' && typeof args.y === 'number') return { x: args.x, y: args.y };
  throw new Error('Indica un objetivo: una referencia ui:N / vision:N o coordenadas x, y.');
}

/**
 * Coordinates every desktop service and is the only thing the broker talks to.
 * The model never reaches this class: it produces intents, the broker checks
 * them, and the adapters built here turn an approved intent into an action.
 */
export class DesktopControlService {
  readonly gate: ControlGate;
  readonly windows: WindowService;
  readonly ui: UIAutomationService;
  readonly capture: ScreenCaptureService;
  readonly vision: VisionService;
  readonly input: InputService;
  readonly human: HumanOverrideDetector;
  readonly session: SessionStateService;
  readonly processes: ProcessService;
  readonly snapshots: DesktopSnapshotService;
  private adapter: WindowsAutomationAdapter;
  private apps: () => Promise<DiscoveredApp[]>;
  private unsubHuman: (() => void) | null = null;

  constructor(options: DesktopControlOptions = {}) {
    this.adapter = options.adapter ?? new UnavailableAutomationAdapter();
    this.apps = options.apps ?? (async () => []);
    this.gate = new ControlGate();
    this.windows = new WindowService(this.adapter);
    this.ui = new UIAutomationService(this.adapter);
    this.capture = new ScreenCaptureService(this.adapter);
    this.vision = new VisionService();
    this.human = new HumanOverrideDetector(options.humanInput ?? null);
    this.input = new InputService(this.adapter, this.gate, this.ui, this.vision, this.human);
    this.session = new SessionStateService(this.adapter);
    this.processes = new ProcessService(this.adapter);
    this.snapshots = new DesktopSnapshotService(this.adapter);

    this.session.subscribe((s) => this.gate.setSession(s));
    this.unsubHuman = this.human.onHumanInput(() => {
      if (this.gate.status().mode !== 'active') return;
      this.gate.pause('human_override');
      options.onHumanOverride?.();
    });
  }

  /** Swaps the Windows backend (helper restarted, harness fixture, etc.). */
  async useAdapter(adapter: WindowsAutomationAdapter): Promise<void> {
    this.adapter = adapter;
    [this.windows, this.ui, this.capture, this.input, this.session, this.processes, this.snapshots]
      .forEach((svc) => svc.useAdapter(adapter));
    await this.refresh();
  }

  setAppSource(apps: () => Promise<DiscoveredApp[]>): void { this.apps = apps; }

  async refresh(): Promise<ControlStatus> {
    const available = await this.adapter.available().catch(() => false);
    this.gate.setHelperAvailable(available);
    if (available) await this.session.refresh();
    else this.gate.setSession('UNKNOWN');
    return this.gate.status();
  }

  /* ---------------- run lifecycle ---------------- */

  bindRun(runId: string): void {
    this.gate.bindRun(runId);
    this.ui.clearRefs();
    void this.human.arm();
  }

  releaseRun(runId: string): void {
    this.gate.releaseRun(runId);
    this.human.disarm();
    this.capture.dispose();
  }

  /** STOP: aborts in-flight input and refuses everything after. */
  stop(reason?: string): void {
    this.gate.stop(reason);
    this.human.disarm();
    this.capture.dispose();
  }

  pause(): void { this.gate.pause('user'); }
  resume(): void { this.gate.resume(); }

  status(): ControlStatus { return this.gate.status(); }

  /* ---------------- broker policy ---------------- */

  /**
   * Vetoes interactive desktop tools unless the gate is open. Registered on the
   * broker, so it runs before approval — a locked session never even asks.
   */
  policy(): ToolPolicy {
    return ({ tool, request }) => this.authorize(tool, request.args, request.runId);
  }

  /**
   * The same decision the broker policy makes, callable directly by the main
   * process so both sides enforce identical rules.
   */
  async authorize(tool: ToolDefinition, args: unknown, runId: string): Promise<{ ok: true } | { ok: false; reason: string }> {
    if (!tool.interactive) return { ok: true };
    await this.session.refresh();
    const gate = this.gate.check({ interactive: true, runId });
    if (!gate.ok) return { ok: false, reason: gate.reason };

    // The secret rules are enforced here too, before any adapter runs.
    if (tool.id === 'keyboard.type' || tool.id === 'ui.setValue') {
      const text = rec(args).text ?? rec(args).value;
      if (typeof text === 'string' && containsSecret(text)) {
        return { ok: false, reason: 'JARVIS no escribe contraseñas, tokens ni códigos. Escríbelos tú.' };
      }
    }
    return { ok: true };
  }

  /* ---------------- tool adapters ---------------- */

  /** One adapter per tool id. Each validates its own arguments. */
  adapters(): AdapterMap {
    /**
     * Every interactive adapter goes through here: the gate is checked once
     * more at the last moment (defence in depth behind the broker policy), and
     * the indicator shows what is happening while it happens.
     */
    const track = async <T>(label: string, fn: () => Promise<T>): Promise<T> => {
      const gate = this.gate.check({ interactive: true });
      if (!gate.ok) throw new Error(gate.reason);
      this.gate.setAction(label);
      try { return await fn(); } finally { this.gate.setAction(null); }
    };

    const findWindow = async (args: Record<string, unknown>): Promise<WindowInfo> => {
      const id = str(args.windowId, 'windowId');
      return this.windows.require(id);
    };

    return {
      /* ---------- snapshot / processes / apps ---------- */
      'desktop.snapshot': async () => this.snapshots.snapshot(this.gate.status().helperAvailable),
      'process.list': async () => this.processes.list(),
      'process.find': async (a: unknown) => this.processes.find(str(rec(a).name, 'name')),
      'process.info': async (a: unknown) => this.processes.info(num(rec(a).pid, 'pid')),

      'app.launch': async (a: unknown) => track('Abriendo aplicación', async () => {
        const appId = str(rec(a).appId, 'appId');
        // Only ids already discovered locally. A path or an argument from the
        // model has no way in: the lookup is by id, and nothing else is read.
        const app = (await this.apps()).find((x) => x.id === appId);
        if (!app) throw new Error(`Aplicación no reconocida: ${appId}. Sólo se lanzan aplicaciones descubiertas en este equipo.`);
        const result = await this.adapter.launch(app, { requireOwnership: rec(a).requireOwnership === true });
        if (result.uacPrompted) {
          await this.session.refresh();
          throw new Error('Windows requiere tu aprobación. Responde al aviso de Control de cuentas de usuario; JARVIS no lo toca.');
        }
        return { appId: app.id, name: app.name, ...result };
      }),

      /* ---------- windows ---------- */
      'window.list': async () => this.windows.listWindows(),
      'window.active': async () => this.windows.getActiveWindow(),
      'window.find': async (a: unknown) => {
        const r = rec(a);
        return this.windows.findWindows({
          ...(typeof r.appId === 'string' ? { appId: r.appId } : {}),
          ...(typeof r.processName === 'string' ? { processName: r.processName } : {}),
          ...(typeof r.titleContains === 'string' ? { titleContains: r.titleContains } : {}),
          ...(typeof r.appName === 'string' ? { appName: r.appName } : {}),
          visibleOnly: r.visibleOnly !== false,
        });
      },
      'window.focus': async (a: unknown) => track('Enfocando ventana', async () => {
        const w = await findWindow(rec(a));
        await this.windows.activateWindow(w.windowId);
        const active = await this.windows.getActiveWindow();
        if (active?.windowId !== w.windowId) throw new Error('La ventana no recibió el foco.');
        return { windowId: w.windowId, focused: true };
      }),
      'window.minimize': async (a: unknown) => track('Minimizando ventana', async () => { const w = await findWindow(rec(a)); await this.windows.minimizeWindow(w.windowId); return { windowId: w.windowId }; }),
      'window.maximize': async (a: unknown) => track('Maximizando ventana', async () => { const w = await findWindow(rec(a)); await this.windows.maximizeWindow(w.windowId); return { windowId: w.windowId }; }),
      'window.restore': async (a: unknown) => track('Restaurando ventana', async () => { const w = await findWindow(rec(a)); await this.windows.restoreWindow(w.windowId); return { windowId: w.windowId }; }),
      'window.move': async (a: unknown) => track('Moviendo ventana', async () => {
        const r = rec(a); const w = await findWindow(r);
        await this.windows.moveWindow(w.windowId, num(r.x, 'x'), num(r.y, 'y'));
        return { windowId: w.windowId };
      }),
      'window.resize': async (a: unknown) => track('Redimensionando ventana', async () => {
        const r = rec(a); const w = await findWindow(r);
        await this.windows.resizeWindow(w.windowId, num(r.width, 'width'), num(r.height, 'height'));
        return { windowId: w.windowId };
      }),
      'window.close': async (a: unknown) => track('Cerrando ventana', async () => {
        const w = await findWindow(rec(a));
        const result = await this.windows.closeWindow(w.windowId);
        return {
          ...result,
          note: result.dialogShown ? 'La aplicación pidió confirmación. Ese diálogo es tuyo; JARVIS no lo responde.' : null,
        };
      }),

      /* ---------- UI Automation ---------- */
      'ui.inspect': async (a: unknown) => {
        const r = rec(a);
        const w = await findWindow(r);
        const elements = await this.ui.inspect(w.windowId, typeof r.depth === 'number' ? r.depth : 4);
        const context = buildUIContext(w, elements);
        return { windowId: w.windowId, context: context.text, count: context.count, truncated: context.truncated, elements };
      },
      'ui.find': async (a: unknown) => {
        const r = rec(a);
        const query: UIFindQuery = { windowId: str(r.windowId, 'windowId') };
        for (const k of ['name', 'automationId', 'controlType', 'role', 'textContains'] as const) {
          if (typeof r[k] === 'string') (query as unknown as Record<string, unknown>)[k] = r[k];
        }
        if (typeof r.enabled === 'boolean') query.enabled = r.enabled;
        if (typeof r.limit === 'number') query.limit = r.limit;
        const candidates = await this.ui.find(query);
        return { candidates, ambiguous: candidates.length > 1, found: candidates.length > 0 };
      },
      'ui.focus': async (a: unknown) => track('Enfocando control', async () => { const el = await this.ui.focus(str(rec(a).target, 'target')); return { name: el.name }; }),

      /**
       * Invoke goes through the strategy ladder: UI Automation first, and only
       * if the element has no Invoke pattern, a click on its live bounds.
       *
       * Invoke is not idempotent — pressing "Enviar" twice sends twice — so an
       * unverified invoke is NOT retried automatically. Instead the outcome says
       * honestly whether the UI changed, and the agent re-inspects and decides.
       */
      'ui.invoke': async (a: unknown) => track('Activando control', async () => {
        const ref = str(rec(a).target, 'target');
        const before = await this.ui.resolve(ref);
        const windowBefore = await this.ui.inspect(before.windowId, 6).catch(() => []);

        const outcome = await runWithStrategies<void>([
          {
            strategy: 'UI_AUTOMATION',
            applicable: () => before.patterns.includes('Invoke'),
            run: async () => { await this.ui.invoke(ref); },
          },
          {
            strategy: 'INPUT',
            applicable: () => !before.patterns.includes('Invoke'),
            run: async () => { await this.input.click({ target: ref as `ui:${number}` }); },
          },
        ], this.gate.signal, { maxAttempts: 1, maxTotalAttempts: 2, delayMs: 0 });
        if (!outcome.ok) throw new Error(outcome.error ?? 'No se pudo activar el control.');

        // Observable change: new or removed elements in the window, or the
        // element itself gone (a dialog that closed).
        const after = await this.adapter.uiElement(before.id).catch(() => null);
        const windowAfter = await this.ui.inspect(before.windowId, 6).catch(() => []);
        const changed = !after
          || after.childCount !== before.childCount
          || windowAfter.length !== windowBefore.length;

        return {
          name: before.name,
          strategyUsed: outcome.strategyUsed,
          verified: changed,
          note: changed ? null : 'La interfaz no cambió de forma visible. Vuelve a inspeccionar antes de repetir la acción.',
        };
      }),

      'ui.setValue': async (a: unknown) => track('Escribiendo en un campo', async () => {
        const r = rec(a);
        const ref = str(r.target, 'target');
        const value = typeof r.value === 'string' ? r.value : '';
        if (value.length > this.gate.inputLimits.maxTextLength) throw new Error('Texto demasiado largo.');
        const el = await this.ui.setValue(ref, value);
        // Verify by reading back — unless the field is one we may not read.
        const after = await this.ui.resolve(ref);
        const verified = after.secret ? null : after.value === value;
        if (verified === false) throw new Error(`El valor de «${el.name}» no quedó como se esperaba.`);
        return { name: el.name, verified: verified ?? 'no verificable' };
      }),
      'ui.toggle': async (a: unknown) => track('Alternando control', async () => {
        const ref = str(rec(a).target, 'target');
        const before = await this.ui.resolve(ref);
        await this.ui.toggle(ref);
        const after = await this.ui.resolve(ref);
        if (after.toggleState === before.toggleState) throw new Error('El control no cambió de estado.');
        return { name: after.name, state: after.toggleState };
      }),
      'ui.select': async (a: unknown) => track('Seleccionando', async () => { const el = await this.ui.select(str(rec(a).target, 'target')); return { name: el.name }; }),
      'ui.expand': async (a: unknown) => track('Expandiendo', async () => {
        const ref = str(rec(a).target, 'target');
        await this.ui.expand(ref);
        const after = await this.ui.resolve(ref);
        return { name: after.name, children: after.childCount };
      }),
      'ui.collapse': async (a: unknown) => track('Contrayendo', async () => { const el = await this.ui.collapse(str(rec(a).target, 'target')); return { name: el.name }; }),
      'ui.scroll': async (a: unknown) => track('Desplazando', async () => {
        const r = rec(a);
        const dir = r.direction;
        if (dir !== 'up' && dir !== 'down' && dir !== 'left' && dir !== 'right') throw new Error('Dirección inválida.');
        const amount = Math.min(this.gate.inputLimits.maxScrollAmount, Math.max(1, typeof r.amount === 'number' ? r.amount : 3));
        const el = await this.ui.scroll(str(r.target, 'target'), dir, amount);
        return { name: el.name };
      }),

      /* ---------- screen ---------- */
      'screen.captureDisplay': async (a: unknown) => this.capture.captureDisplay(typeof rec(a).monitor === 'number' ? rec(a).monitor as number : 0),
      'screen.captureWindow': async (a: unknown) => this.capture.captureWindow((await findWindow(rec(a))).windowId),
      'screen.captureRegion': async (a: unknown) => {
        const r = rec(a);
        const bounds: Bounds = { x: num(r.x, 'x'), y: num(r.y, 'y'), width: num(r.width, 'width'), height: num(r.height, 'height') };
        return this.capture.captureRegion(bounds);
      },

      /* ---------- mouse ---------- */
      'mouse.move': async (a: unknown) => track('Moviendo el ratón', () => this.input.move(mouseTarget(rec(a)))),
      'mouse.click': async (a: unknown) => track('Haciendo clic', () => this.input.click(mouseTarget(rec(a)), buttonOf(rec(a).button), 1)),
      'mouse.doubleClick': async (a: unknown) => track('Doble clic', () => this.input.click(mouseTarget(rec(a)), 'left', 2)),
      'mouse.rightClick': async (a: unknown) => track('Clic derecho', () => this.input.click(mouseTarget(rec(a)), 'right', 1)),
      'mouse.scroll': async (a: unknown) => track('Rueda del ratón', async () => { await this.input.scroll(mouseTarget(rec(a)), num(rec(a).amount, 'amount')); return { ok: true }; }),
      'mouse.drag': async (a: unknown) => track('Arrastrando', async () => {
        const r = rec(a);
        await this.input.drag(mouseTarget(rec(r.from)), mouseTarget(rec(r.to)), typeof r.durationMs === 'number' ? r.durationMs : 400);
        return { ok: true };
      }),

      /* ---------- keyboard ---------- */
      'keyboard.press': async (a: unknown) => track('Pulsando tecla', async () => { await this.input.pressKey(str(rec(a).key, 'key')); return { ok: true }; }),
      'keyboard.hotkey': async (a: unknown) => track('Combinación de teclas', async () => {
        const keys = rec(a).keys;
        if (!Array.isArray(keys) || !keys.every((k) => typeof k === 'string')) throw new Error('«keys» debe ser una lista de teclas.');
        await this.input.hotkey(keys as string[]);
        return { ok: true };
      }),
      'keyboard.type': async (a: unknown) => track('Escribiendo', async () => {
        const r = rec(a);
        return this.input.typeText(str(r.text, 'text'), typeof r.target === 'string' ? { targetRef: r.target } : {});
      }),
    };
  }

  dispose(): void {
    this.unsubHuman?.();
    this.human.disarm();
    this.capture.dispose();
  }
}

function buttonOf(v: unknown): MouseButton {
  return v === 'right' || v === 'middle' ? v : 'left';
}
