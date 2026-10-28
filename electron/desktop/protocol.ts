/**
 * The complete vocabulary of the Windows helper. Nothing outside this list can
 * be sent: there is no "shell", no "powershell", no "script", no "eval", no
 * "loadLibrary" — not as a disabled entry, but as an absence. A command the
 * bridge does not know is refused before it reaches the pipe.
 *
 * The C# helper carries the same list (Program.cs) and refuses unknown
 * commands on its side too. Two independent checks, one list.
 */
export const HELPER_COMMANDS = {
  ping: {},
  sessionState: {},
  monitors: {},
  listWindows: {},
  activeWindow: {},
  activateWindow: { windowId: 'string' },
  setWindowState: { windowId: 'string', state: 'windowState' },
  moveWindow: { windowId: 'string', x: 'int', y: 'int' },
  resizeWindow: { windowId: 'string', width: 'int', height: 'int' },
  closeWindow: { windowId: 'string' },
  uiRoot: { windowId: 'string' },
  uiChildren: { elementId: 'string' },
  uiElement: { elementId: 'string' },
  uiFocus: { elementId: 'string' },
  uiInvoke: { elementId: 'string' },
  uiSetValue: { elementId: 'string', value: 'text' },
  uiToggle: { elementId: 'string' },
  uiSelect: { elementId: 'string' },
  uiExpand: { elementId: 'string' },
  uiCollapse: { elementId: 'string' },
  uiScroll: { elementId: 'string', direction: 'direction', amount: 'int' },
  cursor: {},
  mouseMove: { x: 'int', y: 'int' },
  mouseClick: { x: 'int', y: 'int', button: 'button', count: 'int' },
  mouseScroll: { x: 'int', y: 'int', delta: 'int' },
  mouseDrag: { fromX: 'int', fromY: 'int', toX: 'int', toY: 'int', durationMs: 'int' },
  keyPress: { key: 'key' },
  keyHotkey: { keys: 'keys' },
  typeText: { text: 'text' },
  /** Aborts whatever input sequence is in flight inside the helper. */
  cancelInput: {},
  /** Read-only counters/coordinates, never typed content. */
  inputState: {},
  captureDisplay: { monitor: 'int' },
  captureWindow: { windowId: 'string' },
  captureRegion: { x: 'int', y: 'int', width: 'int', height: 'int' },
  processes: {},
} as const;

export type HelperCommand = keyof typeof HELPER_COMMANDS;
type FieldKind = 'string' | 'int' | 'text' | 'windowState' | 'direction' | 'button' | 'key' | 'keys';

export interface HelperRequest {
  requestId: string;
  command: HelperCommand;
  args: Record<string, unknown>;
}

export interface HelperResponse {
  requestId: string;
  ok: boolean;
  result?: unknown;
  error?: string;
}

/** Pushed by the helper without a request: human input, session changes. */
export interface HelperEvent {
  event: 'humanInput' | 'sessionChanged';
  data: Record<string, unknown>;
}

const MAX_TEXT = 4000;
const MAX_ID = 128;

function checkField(kind: FieldKind, value: unknown): boolean {
  switch (kind) {
    case 'string': return typeof value === 'string' && value.length > 0 && value.length <= MAX_ID && /^[\w:.\-]+$/.test(value);
    case 'int': return typeof value === 'number' && Number.isInteger(value) && Math.abs(value) <= 100_000;
    case 'text': return typeof value === 'string' && value.length <= MAX_TEXT;
    case 'windowState': return value === 'normal' || value === 'minimized' || value === 'maximized';
    case 'direction': return value === 'up' || value === 'down' || value === 'left' || value === 'right';
    case 'button': return value === 'left' || value === 'right' || value === 'middle';
    case 'key': return typeof value === 'string' && /^[a-z0-9]{1,12}$|^[,./;'\[\]\-=`]$/i.test(value);
    case 'keys': return Array.isArray(value) && value.length >= 1 && value.length <= 4 && value.every((k) => checkField('key', k));
  }
}

/**
 * Validates a request completely: known command, exactly the declared fields,
 * each of the declared kind. Extra fields are an error, not ignored — a stray
 * `script` key must never ride along silently.
 */
export function validateRequest(request: unknown): { ok: true; value: HelperRequest } | { ok: false; error: string } {
  if (!request || typeof request !== 'object') return { ok: false, error: 'Petición vacía.' };
  const r = request as Record<string, unknown>;
  if (typeof r.requestId !== 'string' || !/^[\w-]{1,64}$/.test(r.requestId)) return { ok: false, error: 'requestId inválido.' };
  if (typeof r.command !== 'string' || !Object.prototype.hasOwnProperty.call(HELPER_COMMANDS, r.command)) {
    return { ok: false, error: `Comando desconocido: ${String(r.command)}` };
  }
  const spec = HELPER_COMMANDS[r.command as HelperCommand] as Record<string, FieldKind>;
  const args = (r.args ?? {}) as Record<string, unknown>;
  if (typeof args !== 'object' || Array.isArray(args)) return { ok: false, error: 'Los argumentos deben ser un objeto.' };

  for (const key of Object.keys(args)) {
    if (!(key in spec)) return { ok: false, error: `Argumento no permitido para ${r.command}: ${key}` };
  }
  for (const [key, kind] of Object.entries(spec)) {
    if (!checkField(kind, args[key])) return { ok: false, error: `Argumento inválido ${key} para ${r.command}.` };
  }
  return { ok: true, value: { requestId: r.requestId, command: r.command as HelperCommand, args } };
}

export function validateResponse(raw: unknown): HelperResponse | HelperEvent | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.event === 'string' && (r.event === 'humanInput' || r.event === 'sessionChanged')) {
    return { event: r.event, data: (r.data && typeof r.data === 'object' ? r.data : {}) as Record<string, unknown> };
  }
  if (typeof r.requestId !== 'string' || typeof r.ok !== 'boolean') return null;
  return {
    requestId: r.requestId,
    ok: r.ok,
    ...(r.result !== undefined ? { result: r.result } : {}),
    ...(typeof r.error === 'string' ? { error: r.error.slice(0, 500) } : {}),
  };
}

/** Per-command time budgets. Input sequences get longer, reads stay short. */
export function timeoutFor(command: HelperCommand): number {
  if (command === 'typeText' || command === 'mouseDrag') return 15_000;
  if (command.startsWith('capture')) return 8_000;
  if (command === 'uiRoot' || command === 'uiChildren' || command === 'listWindows') return 5_000;
  return 3_000;
}
