import type { UIElementView, WindowInfo } from '@/types';

const INTERESTING = new Set([
  'Button', 'MenuItem', 'Edit', 'Document', 'Tree', 'TreeItem', 'List', 'ListItem',
  'Tab', 'TabItem', 'CheckBox', 'RadioButton', 'ComboBox', 'Hyperlink', 'Slider', 'Window',
]);

/**
 * The model gets a short, numbered list of what it can act on, not a tree of
 * thousands of nodes. Structural noise (panes, groups, unnamed customs) is
 * dropped, and secrets appear as "filled"/"empty" only.
 */
export function buildUIContext(window: WindowInfo, elements: UIElementView[], maxElements = 40): { text: string; count: number; truncated: boolean } {
  const useful = elements.filter((e) => e.depth === 0 || (INTERESTING.has(e.controlType) && (e.name || e.automationId)));
  const shown = useful.slice(0, maxElements);

  const lines = [`Ventana: ${window.title} (${window.processName})`, '', 'Elementos:'];
  for (const e of shown.slice(1)) {
    const label = e.name || e.automationId;
    const state = e.secret
      ? ` [campo protegido, ${e.filled ? 'relleno' : 'vacío'}]`
      : typeof e.value === 'string' && e.value !== '' ? ` = "${e.value.slice(0, 40)}"` : '';
    const disabled = e.enabled ? '' : ' (deshabilitado)';
    lines.push(`[${e.ref}] ${e.controlType} "${label}"${state}${disabled}`);
  }
  if (useful.length > shown.length) lines.push(`… y ${useful.length - shown.length} más.`);

  return { text: lines.join('\n'), count: shown.length, truncated: useful.length > shown.length };
}
