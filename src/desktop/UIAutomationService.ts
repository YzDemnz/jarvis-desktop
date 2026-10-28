import type { AutomationElement, UIElementView, UIFindQuery, UIPattern, UIRef } from '@/types';
import type { WindowsAutomationAdapter } from './adapter';
import { isSensitiveField } from '@/machine/CredentialBoundary';

interface RefEntry {
  elementId: string;
  windowId: string;
  name: string;
  controlType: string;
  generation: number;
}

export class StaleElementError extends Error {
  readonly stale = true;
  constructor(ref: string) {
    super(`La referencia ${ref} ya no apunta a un elemento existente. Vuelve a inspeccionar la ventana.`);
    this.name = 'StaleElementError';
  }
}

export class UnsupportedPatternError extends Error {
  constructor(name: string, pattern: UIPattern) {
    super(`«${name}» no expone el patrón ${pattern}; no se puede ${PATTERN_VERB[pattern]}.`);
    this.name = 'UnsupportedPatternError';
  }
}

const PATTERN_VERB: Record<UIPattern, string> = {
  Invoke: 'invocar', Value: 'escribir su valor', Selection: 'seleccionar', SelectionItem: 'seleccionar',
  ExpandCollapse: 'expandir o contraer', Toggle: 'alternar', Scroll: 'desplazar',
  RangeValue: 'ajustar', Window: 'operar como ventana', Text: 'leer como texto',
};

const MAX_DEPTH = 8;
const MAX_NODES = 1500;

/**
 * The model never sees a UIA runtime id and never gives coordinates for an
 * element. It works with short-lived refs ("ui:42") that this service issues
 * on inspection and resolves on action.
 *
 * A ref that no longer resolves raises StaleElementError instead of acting on
 * whatever now sits at the old position — the classic automation bug where a
 * click lands on the wrong button because the UI moved.
 *
 * The credential boundary is applied here, at the source: a secret field's
 * value never enters a view, a tree, an event or a log.
 */
export class UIAutomationService {
  private refs = new Map<UIRef, RefEntry>();
  private byElement = new Map<string, UIRef>();
  private nextRef = 1;
  private generation = 0;

  constructor(private adapter: WindowsAutomationAdapter) {}
  useAdapter(adapter: WindowsAutomationAdapter): void { this.adapter = adapter; this.clearRefs(); }

  clearRefs(): void {
    this.refs.clear();
    this.byElement.clear();
    this.generation += 1;
  }

  /* ---------------- secrets ---------------- */

  /** Marks and scrubs anything that looks like a credential field. */
  protect(element: AutomationElement): AutomationElement {
    const secret = element.secret || isSensitiveField({
      name: element.name, id: element.automationId, ariaLabel: element.name,
      type: /password/i.test(element.className) ? 'password' : undefined,
    });
    if (!secret) return element;
    const { value, ...rest } = element;
    return { ...rest, secret: true, filled: typeof value === 'string' ? value.length > 0 : element.filled ?? false };
  }

  /* ---------------- refs ---------------- */

  private issue(element: AutomationElement): UIRef {
    const existing = this.byElement.get(element.id);
    if (existing) return existing;
    const ref = `ui:${this.nextRef++}` as UIRef;
    this.refs.set(ref, {
      elementId: element.id, windowId: element.windowId,
      name: element.name, controlType: element.controlType, generation: this.generation,
    });
    this.byElement.set(element.id, ref);
    return ref;
  }

  isRef(value: unknown): value is UIRef {
    return typeof value === 'string' && /^ui:\d+$/.test(value);
  }

  /** Resolves a ref to a live element, or throws StaleElementError. */
  async resolve(ref: string): Promise<AutomationElement> {
    if (!this.isRef(ref)) throw new Error(`Referencia de interfaz inválida: ${ref}`);
    const entry = this.refs.get(ref);
    if (!entry) throw new StaleElementError(ref);
    const live = await this.adapter.uiElement(entry.elementId);
    if (!live) {
      this.refs.delete(ref);
      this.byElement.delete(entry.elementId);
      throw new StaleElementError(ref);
    }
    return this.protect(live);
  }

  /* ---------------- reading ---------------- */

  private view(element: AutomationElement, depth: number): UIElementView {
    const safe = this.protect(element);
    return {
      ref: this.issue(safe),
      name: safe.name,
      controlType: safe.controlType,
      automationId: safe.automationId,
      enabled: safe.enabled,
      patterns: safe.patterns,
      secret: safe.secret,
      ...(safe.secret ? { filled: safe.filled ?? false } : {}),
      ...(!safe.secret && typeof safe.value === 'string' ? { value: safe.value } : {}),
      depth,
    };
  }

  /** Bounded breadth-first walk. Never the entire tree of a huge app. */
  async inspect(windowId: string, maxDepth = 4): Promise<UIElementView[]> {
    const depthLimit = Math.max(1, Math.min(MAX_DEPTH, maxDepth));
    const root = await this.adapter.uiRoot(windowId);
    const out: UIElementView[] = [];
    const queue: { el: AutomationElement; depth: number }[] = [{ el: root, depth: 0 }];
    while (queue.length && out.length < MAX_NODES) {
      const { el, depth } = queue.shift()!;
      out.push(this.view(el, depth));
      if (depth < depthLimit && el.childCount > 0) {
        const children = await this.adapter.uiChildren(el.id);
        children.forEach((c) => queue.push({ el: c, depth: depth + 1 }));
      }
    }
    return out;
  }

  /**
   * Returns every match, never a guess. Zero matches is an empty list, not the
   * nearest thing; several matches come back as candidates for the agent to
   * choose between.
   */
  async find(query: UIFindQuery): Promise<UIElementView[]> {
    const limit = Math.max(1, Math.min(50, query.limit ?? 20));
    const tree = await this.inspect(query.windowId, MAX_DEPTH);
    const name = query.name?.toLowerCase();
    const text = query.textContains?.toLowerCase();
    const role = (query.controlType ?? query.role)?.toLowerCase();

    return tree.filter((v) =>
      (!name || v.name.toLowerCase() === name)
      && (!query.automationId || v.automationId === query.automationId)
      && (!role || v.controlType.toLowerCase() === role)
      && (!text || v.name.toLowerCase().includes(text) || (!v.secret && (v.value ?? '').toLowerCase().includes(text)))
      && (query.enabled === undefined || v.enabled === query.enabled),
    ).slice(0, limit);
  }

  /* ---------------- acting ---------------- */

  private async act(ref: string, pattern: UIPattern | null, run: (el: AutomationElement) => Promise<void>): Promise<AutomationElement> {
    const el = await this.resolve(ref);
    if (pattern && !el.patterns.includes(pattern)) throw new UnsupportedPatternError(el.name, pattern);
    if (!el.enabled) throw new Error(`«${el.name}» está deshabilitado.`);
    await run(el);
    return el;
  }

  focus(ref: string) { return this.act(ref, null, (el) => this.adapter.uiFocus(el.id)); }
  invoke(ref: string) { return this.act(ref, 'Invoke', (el) => this.adapter.uiInvoke(el.id)); }
  toggle(ref: string) { return this.act(ref, 'Toggle', (el) => this.adapter.uiToggle(el.id)); }
  select(ref: string) { return this.act(ref, 'SelectionItem', (el) => this.adapter.uiSelect(el.id)); }
  expand(ref: string) { return this.act(ref, 'ExpandCollapse', (el) => this.adapter.uiExpand(el.id)); }
  collapse(ref: string) { return this.act(ref, 'ExpandCollapse', (el) => this.adapter.uiCollapse(el.id)); }

  scroll(ref: string, direction: 'up' | 'down' | 'left' | 'right', amount: number) {
    return this.act(ref, 'Scroll', (el) => this.adapter.uiScroll(el.id, direction, amount));
  }

  /**
   * Refuses secret fields outright. A password, PIN or OTP is typed by the
   * user's own hands — JARVIS never fills one in, whatever the source.
   */
  async setValue(ref: string, value: string): Promise<AutomationElement> {
    const el = await this.resolve(ref);
    if (el.secret) {
      throw new Error(`«${el.name}» es un campo de credenciales. Escríbelo tú; JARVIS nunca introduce contraseñas ni códigos.`);
    }
    if (!el.patterns.includes('Value')) throw new UnsupportedPatternError(el.name, 'Value');
    if (!el.enabled) throw new Error(`«${el.name}» está deshabilitado.`);
    await this.adapter.uiSetValue(el.id, value);
    return el;
  }

  /** Center of a live element, for the mouse layer. Re-resolved every time. */
  async centerOf(ref: string): Promise<{ x: number; y: number }> {
    const el = await this.resolve(ref);
    if (!el.bounds || el.bounds.width <= 0 || el.bounds.height <= 0) {
      throw new Error(`«${el.name}» no tiene una posición en pantalla.`);
    }
    if (!el.visible) throw new Error(`«${el.name}» no está visible.`);
    return { x: Math.round(el.bounds.x + el.bounds.width / 2), y: Math.round(el.bounds.y + el.bounds.height / 2) };
  }

  /** The element that currently holds keyboard focus in a window, protected. */
  async focusedElement(windowId: string): Promise<AutomationElement | null> {
    const root = await this.adapter.uiRoot(windowId);
    const queue: { el: AutomationElement; depth: number }[] = [{ el: root, depth: 0 }];
    let visited = 0;
    while (queue.length && visited < MAX_NODES) {
      const { el, depth } = queue.shift()!;
      visited += 1;
      if (el.focused) return this.protect(el);
      if (depth < MAX_DEPTH && el.childCount > 0) {
        (await this.adapter.uiChildren(el.id)).forEach((c) => queue.push({ el: c, depth: depth + 1 }));
      }
    }
    return null;
  }

  refCount(): number { return this.refs.size; }
}
