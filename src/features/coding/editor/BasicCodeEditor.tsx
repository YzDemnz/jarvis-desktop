import { useEffect, useMemo, useRef } from 'react';
import type { KeyboardEvent } from 'react';
import type { CodeEditorAdapter, CodeEditorProps } from './CodeEditorAdapter';

function caretOf(text: string, offset: number): { line: number; column: number } {
  const before = text.slice(0, offset);
  const line = before.split('\n').length;
  return { line, column: offset - before.lastIndexOf('\n') };
}

function offsetOf(text: string, line: number, column: number): number {
  const lines = text.split('\n');
  let off = 0;
  for (let i = 0; i < Math.min(line - 1, lines.length); i++) off += lines[i]!.length + 1;
  return off + Math.max(0, column - 1);
}

/**
 * Plain textarea with a line gutter: open, edit, save (Ctrl+S), Tab indents,
 * caret line/column. Deliberately small — it is the stand-in until Monaco.
 */
function BasicCodeEditor({ value, readOnly, onChange, onSave, onCursor, reveal }: CodeEditorProps) {
  const area = useRef<HTMLTextAreaElement>(null);
  const gutter = useRef<HTMLDivElement>(null);
  const lineCount = useMemo(() => value.split('\n').length, [value]);

  useEffect(() => {
    if (!reveal || !area.current) return;
    const off = offsetOf(value, reveal.line, reveal.column);
    area.current.focus();
    area.current.setSelectionRange(off, off);
    area.current.scrollTop = Math.max(0, (reveal.line - 5) * 18);
    onCursor?.(reveal.line, reveal.column);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reveal]);

  const report = () => {
    const el = area.current;
    if (!el) return;
    const c = caretOf(el.value, el.selectionStart);
    onCursor?.(c.line, c.column);
  };

  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); onSave(); return; }
    if (e.key === 'Tab' && !readOnly) {
      e.preventDefault();
      const el = e.currentTarget;
      const { selectionStart: a, selectionEnd: b } = el;
      const next = `${el.value.slice(0, a)}  ${el.value.slice(b)}`;
      onChange(next);
      requestAnimationFrame(() => { el.setSelectionRange(a + 2, a + 2); report(); });
    }
  };

  return (
    <div className="h-full flex min-h-0 font-mono text-[12.5px] leading-[18px]" data-testid="code-editor">
      <div ref={gutter} className="shrink-0 w-12 overflow-hidden text-right pr-3 pt-3 text-faint select-none" aria-hidden>
        {Array.from({ length: Math.min(lineCount, 20000) }, (_, i) => <div key={i}>{i + 1}</div>)}
      </div>
      <textarea
        ref={area}
        data-testid="editor-textarea"
        className="flex-1 min-w-0 h-full resize-none bg-transparent text-ink/90 outline-none pt-3 pr-4 whitespace-pre overflow-auto scroll-thin"
        spellCheck={false}
        readOnly={readOnly}
        value={value}
        onChange={(e) => { onChange(e.target.value); report(); }}
        onKeyDown={onKey}
        onKeyUp={report}
        onClick={report}
        onSelect={report}
        onScroll={(e) => { if (gutter.current) gutter.current.scrollTop = e.currentTarget.scrollTop; }}
      />
    </div>
  );
}

export const basicCodeEditorAdapter: CodeEditorAdapter = { id: 'basic', label: 'Editor básico', Component: BasicCodeEditor };
