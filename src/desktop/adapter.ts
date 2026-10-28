import type {
  AutomationElement, Bounds, DiscoveredApp, MonitorInfo, MouseButton, ProcessInfo,
  SessionState, WindowInfo, WindowShowState,
} from '@/types';

export interface CaptureBytes { width: number; height: number; data: string }
export interface ApplicationLaunchResult {
  pid: number | null; uacPrompted: boolean;
  ownership?: 'WINDOWS_JOB' | 'UNOWNABLE';
  stopScope?: 'OWNED_PROCESS_FAMILY' | 'NONE';
  externalInstance?: 'UNKNOWN';
  limitation?: string;
}

/**
 * Everything JARVIS can do to Windows, in one closed interface. Two
 * implementations exist: the bridge to the native helper, and the fake used by
 * tests and the renderer harness. The services above never know which.
 *
 * Every method either resolves with data or rejects with an Error whose
 * message is safe to show. None of them take free-form commands.
 */
export interface WindowsAutomationAdapter {
  readonly id: string;
  available(): Promise<boolean>;

  sessionState(): Promise<SessionState>;
  monitors(): Promise<MonitorInfo[]>;

  listWindows(): Promise<WindowInfo[]>;
  activeWindow(): Promise<WindowInfo | null>;
  activateWindow(windowId: string): Promise<void>;
  setWindowState(windowId: string, state: Exclude<WindowShowState, 'hidden'>): Promise<void>;
  moveWindow(windowId: string, x: number, y: number): Promise<void>;
  resizeWindow(windowId: string, width: number, height: number): Promise<void>;
  /** Sends a polite close request. The app may show its own save dialog. */
  closeWindow(windowId: string): Promise<void>;

  uiRoot(windowId: string): Promise<AutomationElement>;
  uiChildren(elementId: string): Promise<AutomationElement[]>;
  uiElement(elementId: string): Promise<AutomationElement | null>;
  uiFocus(elementId: string): Promise<void>;
  uiInvoke(elementId: string): Promise<void>;
  uiSetValue(elementId: string, value: string): Promise<void>;
  uiToggle(elementId: string): Promise<void>;
  uiSelect(elementId: string): Promise<void>;
  uiExpand(elementId: string): Promise<void>;
  uiCollapse(elementId: string): Promise<void>;
  uiScroll(elementId: string, direction: 'up' | 'down' | 'left' | 'right', amount: number): Promise<void>;

  cursor(): Promise<{ x: number; y: number }>;
  mouseMove(x: number, y: number): Promise<void>;
  mouseClick(x: number, y: number, button: MouseButton, count: 1 | 2): Promise<void>;
  mouseScroll(x: number, y: number, delta: number): Promise<void>;
  mouseDrag(from: { x: number; y: number }, to: { x: number; y: number }, durationMs: number, signal: AbortSignal): Promise<void>;

  keyPress(key: string): Promise<void>;
  keyHotkey(keys: string[]): Promise<void>;
  /** Types in small chunks, checking the signal between them. */
  typeText(text: string, signal: AbortSignal): Promise<void>;

  captureDisplay(monitor: number): Promise<CaptureBytes>;
  captureWindow(windowId: string): Promise<CaptureBytes>;
  captureRegion(bounds: Bounds): Promise<CaptureBytes>;

  processes(): Promise<ProcessInfo[]>;
  /** Launches only an already-discovered app. Never a path from outside. */
  launch(app: DiscoveredApp, options?: { requireOwnership: boolean }): Promise<ApplicationLaunchResult>;
}

/**
 * Used whenever no real adapter exists: plain browser, non-Windows host, or a
 * crashed helper. Everything reports unavailable instead of pretending.
 */
export class UnavailableAutomationAdapter implements WindowsAutomationAdapter {
  readonly id = 'unavailable';
  constructor(private readonly reason = 'El control de Windows no está disponible en este entorno.') {}
  private fail(): never { throw new Error(this.reason); }

  async available() { return false; }
  async sessionState(): Promise<SessionState> { return 'UNKNOWN'; }
  async monitors(): Promise<MonitorInfo[]> { return []; }
  async listWindows(): Promise<WindowInfo[]> { return []; }
  async activeWindow() { return null; }
  async activateWindow() { this.fail(); }
  async setWindowState() { this.fail(); }
  async moveWindow() { this.fail(); }
  async resizeWindow() { this.fail(); }
  async closeWindow() { this.fail(); }
  async uiRoot(): Promise<AutomationElement> { this.fail(); }
  async uiChildren(): Promise<AutomationElement[]> { this.fail(); }
  async uiElement() { return null; }
  async uiFocus() { this.fail(); }
  async uiInvoke() { this.fail(); }
  async uiSetValue() { this.fail(); }
  async uiToggle() { this.fail(); }
  async uiSelect() { this.fail(); }
  async uiExpand() { this.fail(); }
  async uiCollapse() { this.fail(); }
  async uiScroll() { this.fail(); }
  async cursor(): Promise<{ x: number; y: number }> { this.fail(); }
  async mouseMove() { this.fail(); }
  async mouseClick() { this.fail(); }
  async mouseScroll() { this.fail(); }
  async mouseDrag() { this.fail(); }
  async keyPress() { this.fail(); }
  async keyHotkey() { this.fail(); }
  async typeText() { this.fail(); }
  async captureDisplay(): Promise<CaptureBytes> { this.fail(); }
  async captureWindow(): Promise<CaptureBytes> { this.fail(); }
  async captureRegion(): Promise<CaptureBytes> { this.fail(); }
  async processes(): Promise<ProcessInfo[]> { return []; }
  async launch(): Promise<{ pid: number | null; uacPrompted: boolean }> { this.fail(); }
}
