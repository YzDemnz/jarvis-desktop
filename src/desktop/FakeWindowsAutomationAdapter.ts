import type {
  AutomationElement, Bounds, DiscoveredApp, MonitorInfo, MouseButton, ProcessInfo,
  SessionState, WindowInfo, WindowShowState,
} from '@/types';
import type { CaptureBytes, WindowsAutomationAdapter } from './adapter';
import { APP_FIXTURES } from './fixtures/apps';
import type { AppSpec, NodeSpec } from './fixtures/apps';

interface LiveNode extends AutomationElement {
  spec: NodeSpec;
  childIds: string[];
  opened: boolean;
}

interface LiveWindow {
  info: WindowInfo;
  app: AppSpec;
  rootId: string;
}

/** Every input the fake received, so tests can assert on exactly what happened. */
export interface InputLogEntry {
  kind: 'move' | 'click' | 'scroll' | 'drag' | 'key' | 'hotkey' | 'type';
  detail: string;
  at: number;
}

const MONITORS: MonitorInfo[] = [
  { id: 'mon-0', index: 0, bounds: { x: 0, y: 0, width: 1920, height: 1080 }, workArea: { x: 0, y: 0, width: 1920, height: 1040 }, scaleFactor: 1, primary: true },
  { id: 'mon-1', index: 1, bounds: { x: 1920, y: 0, width: 1920, height: 1080 }, workArea: { x: 1920, y: 0, width: 1920, height: 1040 }, scaleFactor: 1.25, primary: false },
];

/**
 * A believable Windows, entirely in memory. Menus open when invoked, values
 * change when set, elements disappear when their parent collapses (so stale
 * refs are real), and elevated apps trip a UAC prompt.
 *
 * It does not simulate Windows perfectly; it simulates the behaviours the
 * services above depend on, which is what the tests need.
 */
export class FakeWindowsAutomationAdapter implements WindowsAutomationAdapter {
  readonly id = 'fake-windows';
  private windows = new Map<string, LiveWindow>();
  private nodes = new Map<string, LiveNode>();
  private activeId: string | null = null;
  private cursorPos = { x: 960, y: 540 };
  private session: SessionState = 'ACTIVE';
  private nextNode = 1;
  private nextWindow = 0x1000;
  private nextPid = 4000;
  /** Toggled by tests to prove the services survive a dead helper. */
  alive = true;
  /** Artificial latency per input step, to make cancellation observable. */
  inputDelayMs = 0;
  readonly inputLog: InputLogEntry[] = [];

  constructor(openApps: string[] = ['app:notepad', 'app:vscode', 'app:explorer']) {
    openApps.forEach((id) => { this.openApp(id); });
  }

  /* ---------------- test controls ---------------- */

  setSession(state: SessionState): void { this.session = state; }

  openApp(appId: string): WindowInfo | null {
    const app = APP_FIXTURES.find((a) => a.appId === appId);
    if (!app) return null;
    const windowId = `hwnd:0x${(this.nextWindow++).toString(16)}`;
    const rootId = this.build(app.root, windowId, null);
    const info: WindowInfo = {
      windowId, processId: this.nextPid++, processName: app.processName, title: app.title,
      bounds: { ...app.bounds }, state: 'normal', visible: true, focused: false,
      monitor: app.monitor, elevated: app.requiresElevation === true,
    };
    this.windows.set(windowId, { info, app, rootId });
    this.focus(windowId);
    return info;
  }

  private build(spec: NodeSpec, windowId: string, parentId: string | null): string {
    const id = `el:${this.nextNode++}`;
    const node: LiveNode = {
      id, windowId, parentId, spec,
      name: spec.name, automationId: spec.automationId ?? '', controlType: spec.controlType,
      className: spec.className ?? '', bounds: { x: 0, y: 0, width: 80, height: 24 },
      enabled: spec.enabled ?? true, visible: spec.visible ?? true,
      focusable: (spec.patterns ?? []).length > 0, focused: false,
      patterns: spec.patterns ?? [],
      ...(spec.value !== undefined ? { value: spec.value } : {}),
      ...(spec.toggle ? { toggleState: spec.toggle } : {}),
      ...(spec.patterns?.includes('ExpandCollapse') ? { expandState: 'collapsed' as const } : {}),
      secret: spec.secret === true,
      childCount: 0, childIds: [], opened: false,
    };
    this.nodes.set(id, node);
    node.childIds = (spec.children ?? []).map((c) => this.build(c, windowId, id));
    node.childCount = node.childIds.length;
    return id;
  }

  private layout(windowId: string): void {
    const w = this.windows.get(windowId);
    if (!w) return;
    let row = 0;
    const walk = (id: string, depth: number) => {
      const n = this.nodes.get(id);
      if (!n) return;
      n.bounds = id === w.rootId
        ? { ...w.info.bounds }
        : { x: w.info.bounds.x + 20 + depth * 16, y: w.info.bounds.y + 40 + row++ * 28, width: 160, height: 24 };
      n.childIds.forEach((c) => walk(c, depth + 1));
    };
    walk(w.rootId, 0);
  }

  private focus(windowId: string): void {
    this.windows.forEach((w) => { w.info.focused = w.info.windowId === windowId; });
    this.activeId = windowId;
  }

  private ensure(): void {
    if (!this.alive) throw new Error('El helper de automatización no responde.');
  }

  private win(windowId: string): LiveWindow {
    this.ensure();
    const w = this.windows.get(windowId);
    if (!w) throw new Error(`Ventana inexistente: ${windowId}`);
    return w;
  }

  private node(elementId: string): LiveNode {
    this.ensure();
    const n = this.nodes.get(elementId);
    if (!n) throw new Error(`Elemento inexistente o ya no disponible: ${elementId}`);
    return n;
  }

  private requirePattern(n: LiveNode, pattern: AutomationElement['patterns'][number]): void {
    if (!n.patterns.includes(pattern)) {
      throw new Error(`«${n.name}» no expone el patrón ${pattern}.`);
    }
  }

  private public(n: LiveNode): AutomationElement {
    const { spec: _s, childIds: _c, opened: _o, ...element } = n;
    return { ...element, bounds: element.bounds ? { ...element.bounds } : null };
  }

  /** Revealing or hiding children is what makes menus and stale refs real. */
  private open(n: LiveNode): void {
    if (n.opened || !n.spec.onOpen) return;
    const added = n.spec.onOpen.map((c) => this.build(c, n.windowId, n.id));
    n.childIds.push(...added);
    n.childCount = n.childIds.length;
    n.opened = true;
    if (n.expandState) n.expandState = 'expanded';
    this.layout(n.windowId);
  }

  private close(n: LiveNode): void {
    if (!n.opened || !n.spec.onOpen) return;
    const keep = (n.spec.children ?? []).length;
    const removed = n.childIds.splice(keep);
    const drop = (id: string) => {
      const child = this.nodes.get(id);
      child?.childIds.forEach(drop);
      this.nodes.delete(id);
    };
    removed.forEach(drop);
    n.childCount = n.childIds.length;
    n.opened = false;
    if (n.expandState) n.expandState = 'collapsed';
  }

  private sleep(ms: number, signal?: AbortSignal): Promise<void> {
    if (ms <= 0) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const t = setTimeout(resolve, ms);
      signal?.addEventListener('abort', () => { clearTimeout(t); reject(new Error('Acción de entrada cancelada.')); }, { once: true });
    });
  }

  /* ---------------- adapter surface ---------------- */

  async available() { return this.alive; }
  async sessionState() { this.ensure(); return this.session; }
  async monitors() { this.ensure(); return MONITORS.map((m) => ({ ...m })); }

  async listWindows() {
    this.ensure();
    return [...this.windows.values()].map((w) => ({ ...w.info, bounds: { ...w.info.bounds } }));
  }

  async activeWindow() {
    this.ensure();
    const w = this.activeId ? this.windows.get(this.activeId) : null;
    return w ? { ...w.info, bounds: { ...w.info.bounds } } : null;
  }

  async activateWindow(windowId: string) {
    const w = this.win(windowId);
    if (w.info.state === 'minimized') w.info.state = 'normal';
    this.focus(windowId);
  }

  async setWindowState(windowId: string, state: Exclude<WindowShowState, 'hidden'>) {
    const w = this.win(windowId);
    w.info.state = state;
    if (state === 'maximized') {
      const mon = MONITORS[w.info.monitor ?? 0] ?? MONITORS[0]!;
      w.info.bounds = { ...mon.workArea };
    }
    if (state === 'minimized' && this.activeId === windowId) this.activeId = null;
  }

  async moveWindow(windowId: string, x: number, y: number) {
    const w = this.win(windowId);
    w.info.bounds = { ...w.info.bounds, x, y };
    w.info.monitor = x >= 1920 ? 1 : 0;
    this.layout(windowId);
  }

  async resizeWindow(windowId: string, width: number, height: number) {
    const w = this.win(windowId);
    w.info.bounds = { ...w.info.bounds, width, height };
    this.layout(windowId);
  }

  async closeWindow(windowId: string) {
    const w = this.win(windowId);
    // Unsaved work: the app raises its own dialog and stays open. The fake
    // never answers that dialog, exactly as JARVIS must not.
    const editor = [...this.nodes.values()].find((n) => n.windowId === windowId && n.patterns.includes('Value') && n.value);
    if (editor && w.app.appId === 'app:notepad') {
      this.openDialog(windowId);
      return;
    }
    [...this.nodes.values()].filter((n) => n.windowId === windowId).forEach((n) => this.nodes.delete(n.id));
    this.windows.delete(windowId);
    if (this.activeId === windowId) this.activeId = null;
  }

  private openDialog(windowId: string): void {
    const w = this.windows.get(windowId);
    if (!w) return;
    const root = this.nodes.get(w.rootId);
    if (!root || root.childIds.some((id) => this.nodes.get(id)?.name === '¿Guardar cambios?')) return;
    const dialog = this.build({
      name: '¿Guardar cambios?', controlType: 'Window', patterns: ['Window'],
      children: [
        { name: 'Guardar', controlType: 'Button', patterns: ['Invoke'] },
        { name: 'No guardar', controlType: 'Button', patterns: ['Invoke'] },
        { name: 'Cancelar', controlType: 'Button', patterns: ['Invoke'] },
      ],
    }, windowId, w.rootId);
    root.childIds.push(dialog);
    root.childCount = root.childIds.length;
  }

  async uiRoot(windowId: string) {
    const w = this.win(windowId);
    this.layout(windowId);
    return this.public(this.node(w.rootId));
  }

  async uiChildren(elementId: string) {
    const n = this.node(elementId);
    return n.childIds.map((id) => this.nodes.get(id)).filter((x): x is LiveNode => !!x).map((c) => this.public(c));
  }

  async uiElement(elementId: string) {
    this.ensure();
    const n = this.nodes.get(elementId);
    return n ? this.public(n) : null;
  }

  async uiFocus(elementId: string) {
    const n = this.node(elementId);
    if (!n.focusable) throw new Error(`«${n.name}» no puede recibir el foco.`);
    this.nodes.forEach((x) => { if (x.windowId === n.windowId) x.focused = false; });
    n.focused = true;
    this.focus(n.windowId);
  }

  async uiInvoke(elementId: string) {
    const n = this.node(elementId);
    this.requirePattern(n, 'Invoke');
    if (!n.enabled) throw new Error(`«${n.name}» está deshabilitado.`);
    // Invoking a menu item opens its submenu; invoking a leaf closes siblings.
    if (n.spec.onOpen) this.open(n);
  }

  async uiSetValue(elementId: string, value: string) {
    const n = this.node(elementId);
    this.requirePattern(n, 'Value');
    n.value = value;
  }

  async uiToggle(elementId: string) {
    const n = this.node(elementId);
    this.requirePattern(n, 'Toggle');
    n.toggleState = n.toggleState === 'on' ? 'off' : 'on';
  }

  async uiSelect(elementId: string) {
    const n = this.node(elementId);
    if (!n.patterns.includes('SelectionItem')) throw new Error(`«${n.name}» no expone el patrón SelectionItem.`);
    n.focused = true;
  }

  async uiExpand(elementId: string) {
    const n = this.node(elementId);
    this.requirePattern(n, 'ExpandCollapse');
    this.open(n);
  }

  async uiCollapse(elementId: string) {
    const n = this.node(elementId);
    this.requirePattern(n, 'ExpandCollapse');
    this.close(n);
  }

  async uiScroll(elementId: string) {
    const n = this.node(elementId);
    this.requirePattern(n, 'Scroll');
  }

  async cursor() { this.ensure(); return { ...this.cursorPos }; }

  async mouseMove(x: number, y: number) {
    this.ensure();
    await this.sleep(this.inputDelayMs);
    this.cursorPos = { x, y };
    this.inputLog.push({ kind: 'move', detail: `${x},${y}`, at: Date.now() });
  }

  async mouseClick(x: number, y: number, button: MouseButton, count: 1 | 2) {
    this.ensure();
    await this.sleep(this.inputDelayMs);
    this.cursorPos = { x, y };
    this.inputLog.push({ kind: 'click', detail: `${button}x${count}@${x},${y}`, at: Date.now() });
  }

  async mouseScroll(x: number, y: number, delta: number) {
    this.ensure();
    this.inputLog.push({ kind: 'scroll', detail: `${delta}@${x},${y}`, at: Date.now() });
  }

  async mouseDrag(from: { x: number; y: number }, to: { x: number; y: number }, durationMs: number, signal: AbortSignal) {
    this.ensure();
    const steps = 10;
    for (let i = 1; i <= steps; i++) {
      if (signal.aborted) throw new Error('Arrastre cancelado.');
      await this.sleep(Math.max(this.inputDelayMs, durationMs / steps), signal);
      this.cursorPos = { x: from.x + ((to.x - from.x) * i) / steps, y: from.y + ((to.y - from.y) * i) / steps };
    }
    this.inputLog.push({ kind: 'drag', detail: `${from.x},${from.y}->${to.x},${to.y}`, at: Date.now() });
  }

  async keyPress(key: string) {
    this.ensure();
    await this.sleep(this.inputDelayMs);
    this.inputLog.push({ kind: 'key', detail: key, at: Date.now() });
  }

  async keyHotkey(keys: string[]) {
    this.ensure();
    await this.sleep(this.inputDelayMs);
    this.inputLog.push({ kind: 'hotkey', detail: keys.join('+'), at: Date.now() });
  }

  async typeText(text: string, signal: AbortSignal) {
    this.ensure();
    let typed = '';
    for (const chunk of text.match(/.{1,4}/gs) ?? []) {
      if (signal.aborted) {
        this.inputLog.push({ kind: 'type', detail: `${typed}⟂`, at: Date.now() });
        throw new Error('Escritura cancelada.');
      }
      await this.sleep(this.inputDelayMs, signal).catch((e) => {
        this.inputLog.push({ kind: 'type', detail: `${typed}⟂`, at: Date.now() });
        throw e;
      });
      typed += chunk;
    }
    this.inputLog.push({ kind: 'type', detail: typed, at: Date.now() });
  }

  async captureDisplay(monitor: number): Promise<CaptureBytes> {
    this.ensure();
    const m = MONITORS[monitor];
    if (!m) throw new Error(`Monitor inexistente: ${monitor}`);
    return { width: m.bounds.width, height: m.bounds.height, data: 'iVBORw0KGgo=' };
  }

  async captureWindow(windowId: string): Promise<CaptureBytes> {
    const w = this.win(windowId);
    return { width: w.info.bounds.width, height: w.info.bounds.height, data: 'iVBORw0KGgo=' };
  }

  async captureRegion(bounds: Bounds): Promise<CaptureBytes> {
    this.ensure();
    return { width: bounds.width, height: bounds.height, data: 'iVBORw0KGgo=' };
  }

  async processes(): Promise<ProcessInfo[]> {
    this.ensure();
    const byPid = new Map<number, ProcessInfo>();
    this.windows.forEach((w) => {
      const existing = byPid.get(w.info.processId);
      byPid.set(w.info.processId, {
        pid: w.info.processId, name: w.info.processName, memoryBytes: 180_000_000,
        windowCount: (existing?.windowCount ?? 0) + 1, elevated: w.info.elevated,
      });
    });
    byPid.set(4, { pid: 4, name: 'System', memoryBytes: null, windowCount: 0, elevated: null });
    return [...byPid.values()];
  }

  async launch(app: DiscoveredApp) {
    this.ensure();
    if (app.requiresElevation) {
      // Windows shows UAC on the secure desktop. Nothing may touch it.
      this.session = 'SECURE_DESKTOP';
      return { pid: null, uacPrompted: true };
    }
    const info = this.openApp(app.id);
    return { pid: info?.processId ?? null, uacPrompted: false };
  }
}

export function fixtureApps(): DiscoveredApp[] {
  return APP_FIXTURES.map((a) => ({
    id: a.appId, name: a.name, source: 'fixture' as const,
    launchTarget: `C:\\Fixtures\\${a.processName}`, requiresElevation: a.requiresElevation === true,
  }));
}
