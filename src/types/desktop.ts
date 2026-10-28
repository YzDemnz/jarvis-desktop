/**
 * Desktop control contract. Everything the agent can know or do about Windows
 * passes through these shapes, and all of them are serialisable.
 */

export interface Bounds { x: number; y: number; width: number; height: number }

export type WindowShowState = 'normal' | 'minimized' | 'maximized' | 'hidden';

export interface MonitorInfo {
  id: string;
  index: number;
  bounds: Bounds;
  workArea: Bounds;
  scaleFactor: number;
  primary: boolean;
}

/**
 * `windowId` is the only stable handle. Titles change constantly ("● app.ts —
 * Vigilia"), so nothing ever keys on them.
 */
export interface WindowInfo {
  windowId: string;
  processId: number;
  processName: string;
  title: string;
  bounds: Bounds;
  state: WindowShowState;
  visible: boolean;
  focused: boolean;
  monitor: number | null;
  /** Elevated windows cannot be driven from a non-elevated process. */
  elevated: boolean;
}

/* ------------------------------------------------------------------ */
/* UI Automation                                                       */
/* ------------------------------------------------------------------ */

export type UIPattern =
  | 'Invoke' | 'Value' | 'Selection' | 'SelectionItem' | 'ExpandCollapse'
  | 'Toggle' | 'Scroll' | 'RangeValue' | 'Window' | 'Text';

export type ControlType =
  | 'Button' | 'MenuBar' | 'Menu' | 'MenuItem' | 'Edit' | 'Document' | 'Text'
  | 'Tree' | 'TreeItem' | 'List' | 'ListItem' | 'Tab' | 'TabItem' | 'CheckBox'
  | 'RadioButton' | 'ComboBox' | 'Pane' | 'Window' | 'ToolBar' | 'Group'
  | 'Hyperlink' | 'Image' | 'ScrollBar' | 'Slider' | 'StatusBar' | 'TitleBar'
  | 'Custom' | 'Unknown';

/** Raw element as the automation layer sees it. */
export interface AutomationElement {
  /** Runtime id from UIA. Valid only while the element exists. */
  id: string;
  windowId: string;
  parentId: string | null;
  name: string;
  automationId: string;
  controlType: ControlType;
  className: string;
  bounds: Bounds | null;
  enabled: boolean;
  visible: boolean;
  focusable: boolean;
  focused: boolean;
  /** Only patterns the control actually exposes. Never inferred. */
  patterns: UIPattern[];
  /** Present only for Value-pattern controls that are NOT secret. */
  value?: string;
  toggleState?: 'on' | 'off' | 'indeterminate';
  expandState?: 'expanded' | 'collapsed' | 'leaf';
  /** Set by the credential boundary. When true, `value` is never present. */
  secret: boolean;
  /** For secret fields: whether something is typed, without what. */
  filled?: boolean;
  childCount: number;
}

/** Temporary handle the model works with: "ui:42". */
export type UIRef = `ui:${number}`;
export type VisionRef = `vision:${number}`;

export interface UIElementView {
  ref: UIRef;
  name: string;
  controlType: ControlType;
  automationId: string;
  enabled: boolean;
  patterns: UIPattern[];
  secret: boolean;
  filled?: boolean;
  value?: string;
  depth: number;
}

export interface UIFindQuery {
  windowId: string;
  name?: string;
  automationId?: string;
  controlType?: ControlType;
  role?: string;
  textContains?: string;
  enabled?: boolean;
  visible?: boolean;
  limit?: number;
}

/* ------------------------------------------------------------------ */
/* Session, capture, vision                                            */
/* ------------------------------------------------------------------ */

/**
 * LOCKED and SECURE_DESKTOP both mean "hands off". The secure desktop is where
 * UAC and Ctrl+Alt+Del live; JARVIS never interacts with it.
 */
export type SessionState = 'ACTIVE' | 'LOCKED' | 'SECURE_DESKTOP' | 'UNKNOWN';

export interface ScreenCaptureResult {
  captureId: string;
  kind: 'display' | 'window' | 'region';
  width: number;
  height: number;
  /** Kept only in memory, never written to the audit log. */
  mimeType: 'image/png';
  createdAt: number;
  expiresAt: number;
}

export interface VisionElement {
  ref: VisionRef;
  label: string;
  bounds: Bounds;
  confidence: number;
}

export interface VisionObservation {
  provider: string;
  elements: VisionElement[];
  summary: string | null;
}

/* ------------------------------------------------------------------ */
/* Input                                                               */
/* ------------------------------------------------------------------ */

export type MouseButton = 'left' | 'right' | 'middle';

/**
 * Targets are refs first. Absolute coordinates exist for the rare case with no
 * structured handle, and are validated against the monitors.
 */
export type MouseTarget =
  | { target: UIRef }
  | { target: VisionRef }
  | { x: number; y: number };

export interface InputLimits {
  mouseActionsPerSecond: number;
  keyEventsPerSecond: number;
  maxTextLength: number;
  maxDragDurationMs: number;
  maxScrollAmount: number;
  maxHotkeyKeys: number;
}

export type InteractionStrategyName = 'DIRECT' | 'DOM' | 'UI_AUTOMATION' | 'VISION' | 'INPUT';

export interface StrategyAttempt {
  strategy: InteractionStrategyName;
  attempt: number;
  ok: boolean;
  verified: boolean;
  error?: string;
}

export interface StrategyOutcome<T = unknown> {
  ok: boolean;
  strategyUsed: InteractionStrategyName | null;
  attempts: StrategyAttempt[];
  result?: T;
  error?: string;
}

/* ------------------------------------------------------------------ */
/* Processes, apps, snapshot                                           */
/* ------------------------------------------------------------------ */

export interface ProcessInfo {
  pid: number;
  name: string;
  memoryBytes: number | null;
  windowCount: number;
  elevated: boolean | null;
}

export interface DiscoveredApp {
  /** Stable internal id: "app:vscode". Never a path. */
  id: string;
  name: string;
  source: 'start-menu' | 'registry' | 'known-location' | 'desktop' | 'fixture';
  /** Resolved and kept in main. The model never sees or supplies it. */
  launchTarget: string;
  requiresElevation: boolean;
}

export interface DesktopSnapshot {
  session: SessionState;
  activeWindow: WindowInfo | null;
  visibleWindows: WindowInfo[];
  monitors: MonitorInfo[];
  cursor: { x: number; y: number } | null;
  controlAvailable: boolean;
  capturedAt: number;
}

/* ------------------------------------------------------------------ */
/* Control state                                                       */
/* ------------------------------------------------------------------ */

export type ControlMode = 'idle' | 'active' | 'paused' | 'stopped' | 'blocked';

export interface ControlStatus {
  mode: ControlMode;
  runId: string | null;
  currentAction: string | null;
  /** Why control is blocked, when it is. */
  blockedReason: string | null;
  humanOverride: boolean;
  session: SessionState;
  helperAvailable: boolean;
}
