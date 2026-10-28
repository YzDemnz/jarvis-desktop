import type { MonitorInfo, MouseButton, MouseTarget } from '@/types';
import type { WindowsAutomationAdapter } from './adapter';
import type { ControlGate } from './ControlGate';
import type { UIAutomationService } from './UIAutomationService';
import type { VisionService } from './VisionService';
import type { HumanOverrideDetector } from './HumanOverrideDetector';
import { sanitizeText } from '@/machine/CredentialBoundary';
import { REDACTED } from '@/agent/redaction';

/** Keys that could lock the machine, open the secure desktop or kill things. */
const FORBIDDEN_COMBOS = new Set([
  'ctrl+alt+delete', 'ctrl+alt+del', 'win+l', 'meta+l', 'ctrl+shift+esc', 'alt+f4+shift',
]);

const ALLOWED_KEYS = /^(?:[a-z0-9]|f(?:[1-9]|1[0-2])|enter|return|tab|escape|esc|space|backspace|delete|del|home|end|pageup|pagedown|up|down|left|right|insert|ctrl|control|alt|shift|win|meta|,|\.|\/|;|'|\[|\]|-|=|`)$/i;

export class InputBlockedError extends Error {
  constructor(message: string, readonly code: string) {
    super(message);
    this.name = 'InputBlockedError';
  }
}

/**
 * Mouse and keyboard, as the last resort in the interaction ladder.
 *
 * Every call goes through the ControlGate first (run bound, not stopped, not
 * paused, session active, rate budget available) and marks itself synthetic so
 * the human-override detector never mistakes JARVIS for the user.
 */
export class InputService {
  constructor(
    private adapter: WindowsAutomationAdapter,
    private readonly gate: ControlGate,
    private readonly ui: UIAutomationService,
    private readonly vision: VisionService,
    private readonly human: HumanOverrideDetector,
  ) {}

  useAdapter(adapter: WindowsAutomationAdapter): void { this.adapter = adapter; }

  private admit(kind: 'mouse' | 'keys', cost = 1): void {
    const gate = this.gate.check({ interactive: true });
    if (!gate.ok) throw new InputBlockedError(gate.reason, gate.code);
    const budget = kind === 'mouse' ? this.gate.takeMouse(cost) : this.gate.takeKeys(cost);
    if (!budget.ok) throw new InputBlockedError(budget.reason, budget.code);
    this.human.markSynthetic();
  }

  /* ---------------- targeting ---------------- */

  /**
   * Refs are re-resolved at the moment of the click, so an element that moved
   * since inspection is clicked where it is now — and one that vanished raises
   * instead of clicking whatever took its place.
   */
  async resolveTarget(target: MouseTarget): Promise<{ x: number; y: number }> {
    if ('target' in target) {
      if (target.target.startsWith('ui:')) return this.ui.centerOf(target.target);
      if (target.target.startsWith('vision:')) {
        const el = this.vision.resolve(target.target);
        return { x: Math.round(el.bounds.x + el.bounds.width / 2), y: Math.round(el.bounds.y + el.bounds.height / 2) };
      }
      throw new Error(`Objetivo desconocido: ${target.target}`);
    }
    await this.assertOnScreen(target.x, target.y);
    return { x: Math.round(target.x), y: Math.round(target.y) };
  }

  private async assertOnScreen(x: number, y: number): Promise<void> {
    if (!Number.isFinite(x) || !Number.isFinite(y)) throw new Error('Coordenadas inválidas.');
    const monitors: MonitorInfo[] = await this.adapter.monitors();
    const inside = monitors.some((m) => x >= m.bounds.x && x < m.bounds.x + m.bounds.width && y >= m.bounds.y && y < m.bounds.y + m.bounds.height);
    if (monitors.length && !inside) throw new Error(`(${x}, ${y}) queda fuera de todas las pantallas.`);
  }

  /* ---------------- mouse ---------------- */

  getPosition(): Promise<{ x: number; y: number }> { return this.adapter.cursor(); }

  async move(target: MouseTarget): Promise<{ x: number; y: number }> {
    const point = await this.resolveTarget(target);
    this.admit('mouse');
    await this.adapter.mouseMove(point.x, point.y);
    return point;
  }

  async click(target: MouseTarget, button: MouseButton = 'left', count: 1 | 2 = 1): Promise<{ x: number; y: number }> {
    const point = await this.resolveTarget(target);
    this.admit('mouse', count);
    await this.adapter.mouseClick(point.x, point.y, button, count);
    return point;
  }

  async scroll(target: MouseTarget, amount: number): Promise<void> {
    const limit = this.gate.inputLimits.maxScrollAmount;
    if (!Number.isFinite(amount) || amount === 0 || Math.abs(amount) > limit) {
      throw new InputBlockedError(`El desplazamiento debe estar entre -${limit} y ${limit}.`, 'invalid_args');
    }
    const point = await this.resolveTarget(target);
    this.admit('mouse');
    await this.adapter.mouseScroll(point.x, point.y, Math.round(amount));
  }

  async drag(from: MouseTarget, to: MouseTarget, durationMs = 400): Promise<void> {
    const max = this.gate.inputLimits.maxDragDurationMs;
    if (!Number.isFinite(durationMs) || durationMs < 50 || durationMs > max) {
      throw new InputBlockedError(`La duración del arrastre debe estar entre 50 y ${max} ms.`, 'invalid_args');
    }
    const a = await this.resolveTarget(from);
    const b = await this.resolveTarget(to);
    this.admit('mouse');
    // The gate's signal is what STOP aborts: a drag halts mid-motion.
    await this.adapter.mouseDrag(a, b, durationMs, this.gate.signal);
  }

  /* ---------------- keyboard ---------------- */

  async pressKey(key: string): Promise<void> {
    const k = key.trim().toLowerCase();
    if (!ALLOWED_KEYS.test(k)) throw new InputBlockedError(`Tecla no permitida: ${key}`, 'invalid_args');
    this.admit('keys');
    await this.adapter.keyPress(k);
  }

  async hotkey(keys: string[]): Promise<void> {
    const max = this.gate.inputLimits.maxHotkeyKeys;
    if (!Array.isArray(keys) || keys.length < 2 || keys.length > max) {
      throw new InputBlockedError(`Una combinación necesita entre 2 y ${max} teclas.`, 'invalid_args');
    }
    const normalized = keys.map((k) => k.trim().toLowerCase());
    if (normalized.some((k) => !ALLOWED_KEYS.test(k))) throw new InputBlockedError('La combinación contiene teclas no permitidas.', 'invalid_args');
    const combo = normalized.join('+');
    if (FORBIDDEN_COMBOS.has(combo) || (normalized.includes('ctrl') && normalized.includes('alt') && (normalized.includes('delete') || normalized.includes('del')))) {
      throw new InputBlockedError(`${keys.join('+')} está reservado por Windows. JARVIS no lo envía nunca.`, 'forbidden_combo');
    }
    this.admit('keys', normalized.length);
    await this.adapter.keyHotkey(normalized);
  }

  /**
   * Never types a secret. Text that the credential boundary would redact is
   * refused whole — JARVIS does not retrieve a password and type it, from any
   * source, into any field.
   */
  async typeText(text: string, opts: { targetRef?: string } = {}): Promise<{ typed: number }> {
    const max = this.gate.inputLimits.maxTextLength;
    if (typeof text !== 'string' || text.length === 0) throw new InputBlockedError('No hay texto que escribir.', 'invalid_args');
    if (text.length > max) throw new InputBlockedError(`El texto excede el máximo de ${max} caracteres por llamada.`, 'invalid_args');
    if (containsSecret(text)) {
      throw new InputBlockedError('El texto contiene lo que parece una credencial. JARVIS no escribe contraseñas, tokens ni códigos.', 'secret');
    }
    if (opts.targetRef) {
      const target = await this.ui.resolve(opts.targetRef);
      if (target.secret) {
        throw new InputBlockedError(`«${target.name}» es un campo de credenciales. Escríbelo tú.`, 'secret');
      }
      await this.ui.focus(opts.targetRef);
    } else {
      // Typing blind into whatever has focus is the riskiest input there is:
      // refuse if the focused element is a credential field.
      const active = await this.adapter.activeWindow();
      if (active) {
        const focused = await this.ui.focusedElement(active.windowId).catch(() => null);
        if (focused?.secret) {
          throw new InputBlockedError(`El foco está en «${focused.name}», un campo de credenciales. Escríbelo tú.`, 'secret');
        }
      }
    }
    this.admit('keys', Math.min(text.length, this.gate.inputLimits.keyEventsPerSecond));
    await this.adapter.typeText(text, this.gate.signal);
    return { typed: text.length };
  }
}

/** True when the credential boundary would change the text. */
export function containsSecret(text: string): boolean {
  // Case-insensitive: "[REDACTADO]" is the same marker as "[redactado]".
  if (text.toLowerCase().includes(REDACTED.toLowerCase())) return true;
  return sanitizeText(text) !== text;
}
