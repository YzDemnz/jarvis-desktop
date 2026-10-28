import { useEffect, useRef } from 'react';
import * as monaco from 'monaco-editor';
import EditorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker';
import JsonWorker from 'monaco-editor/esm/vs/language/json/json.worker?worker';
import CssWorker from 'monaco-editor/esm/vs/language/css/css.worker?worker';
import HtmlWorker from 'monaco-editor/esm/vs/language/html/html.worker?worker';
import TsWorker from 'monaco-editor/esm/vs/language/typescript/ts.worker?worker';
import 'monaco-editor/min/vs/editor/editor.main.css';
import type { CodeEditorAdapter, CodeEditorProps } from './CodeEditorAdapter';

// Bundle workers locally: the editor remains usable without a CDN or network.
self.MonacoEnvironment = {
  getWorker(_moduleId: string, label: string) {
    if (label === 'json') return new JsonWorker();
    if (label === 'css' || label === 'scss' || label === 'less') return new CssWorker();
    if (label === 'html' || label === 'handlebars' || label === 'razor') return new HtmlWorker();
    if (label === 'typescript' || label === 'javascript') return new TsWorker();
    return new EditorWorker();
  },
};

function MonacoCodeEditor({ value, language, readOnly, onChange, onSave, onCursor, reveal }: CodeEditorProps) {
  const host = useRef<HTMLDivElement>(null);
  const editor = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);
  const callbacks = useRef({ onChange, onSave, onCursor });
  callbacks.current = { onChange, onSave, onCursor };

  useEffect(() => {
    if (!host.current) return;
    const model = monaco.editor.createModel(value, language ?? 'plaintext');
    const instance = monaco.editor.create(host.current, {
      model, theme: 'vs-dark', automaticLayout: true, readOnly,
      minimap: { enabled: false }, fontSize: 13, tabSize: 2,
      scrollBeyondLastLine: false,
    });
    editor.current = instance;
    const changes = instance.onDidChangeModelContent(() => callbacks.current.onChange(model.getValue()));
    const cursor = instance.onDidChangeCursorPosition((event) => callbacks.current.onCursor?.(event.position.lineNumber, event.position.column));
    instance.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => callbacks.current.onSave());
    return () => { changes.dispose(); cursor.dispose(); instance.dispose(); model.dispose(); editor.current = null; };
    // The editor instance owns its model until unmount. Prop updates use effects below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const model = editor.current?.getModel();
    if (model && model.getValue() !== value) model.setValue(value);
  }, [value]);
  useEffect(() => { editor.current?.updateOptions({ readOnly }); }, [readOnly]);
  useEffect(() => {
    const model = editor.current?.getModel();
    if (model) monaco.editor.setModelLanguage(model, language ?? 'plaintext');
  }, [language]);
  useEffect(() => {
    if (!reveal || !editor.current) return;
    editor.current.revealPositionInCenter({ lineNumber: reveal.line, column: reveal.column });
    editor.current.setPosition({ lineNumber: reveal.line, column: reveal.column });
    editor.current.focus();
  }, [reveal]);

  return <div ref={host} className="h-full w-full" data-testid="code-editor" data-editor="monaco" />;
}

export const monacoEditorAdapter: CodeEditorAdapter = { id: 'monaco', label: 'Monaco', Component: MonacoCodeEditor };
