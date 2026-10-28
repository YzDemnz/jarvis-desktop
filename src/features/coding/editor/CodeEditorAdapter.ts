import type { ComponentType } from 'react';

/**
 * The editor is replaceable. Production registers Monaco; the basic adapter
 * remains the offline/test fallback. Coding Workspace only uses this contract.
 */
export interface CodeEditorProps {
  value: string;
  language: string | null;
  readOnly: boolean;
  onChange: (value: string) => void;
  onSave: () => void;
  /** 1-based caret position, reported on every move. */
  onCursor?: (line: number, column: number) => void;
  /** Jump request: e.g. from a search hit. */
  reveal?: { line: number; column: number } | null;
}

export interface CodeEditorAdapter {
  readonly id: 'basic' | 'monaco' | (string & {});
  readonly label: string;
  readonly Component: ComponentType<CodeEditorProps>;
}

let current: CodeEditorAdapter | null = null;

export function setCodeEditorAdapter(adapter: CodeEditorAdapter): void { current = adapter; }
export function codeEditorAdapter(fallback: CodeEditorAdapter): CodeEditorAdapter { return current ?? fallback; }
