import type { ControlType, UIPattern } from '@/types';

/**
 * Declarative UI trees shaped like the real applications' accessibility trees.
 * The fake adapter instantiates them; behaviour (menus opening, values
 * changing) lives in the adapter, not here.
 */
export interface NodeSpec {
  name: string;
  controlType: ControlType;
  automationId?: string;
  className?: string;
  patterns?: UIPattern[];
  value?: string;
  enabled?: boolean;
  visible?: boolean;
  /** Mark as a credential field: the boundary must never expose its value. */
  secret?: boolean;
  toggle?: 'on' | 'off';
  /** Children revealed only after the node is invoked or expanded. */
  onOpen?: NodeSpec[];
  children?: NodeSpec[];
}

export interface AppSpec {
  appId: string;
  name: string;
  processName: string;
  title: string;
  monitor: number;
  bounds: { x: number; y: number; width: number; height: number };
  requiresElevation?: boolean;
  root: NodeSpec;
}

const menu = (name: string, items: string[]): NodeSpec => ({
  name, controlType: 'MenuItem', patterns: ['Invoke', 'ExpandCollapse'],
  onOpen: items.map((i) => ({ name: i, controlType: 'MenuItem', patterns: ['Invoke'] })),
});

export const APP_FIXTURES: AppSpec[] = [
  {
    appId: 'app:notepad', name: 'Bloc de notas', processName: 'notepad.exe', title: 'Sin título: Bloc de notas',
    monitor: 0, bounds: { x: 120, y: 90, width: 900, height: 640 },
    root: {
      name: 'Sin título: Bloc de notas', controlType: 'Window', className: 'Notepad', patterns: ['Window'],
      children: [
        { name: 'Barra de menús', controlType: 'MenuBar', children: [
          menu('Archivo', ['Nuevo', 'Abrir...', 'Guardar', 'Guardar como...']),
          menu('Editar', ['Deshacer', 'Cortar', 'Copiar', 'Pegar']),
        ] },
        { name: 'Editor de texto', controlType: 'Document', automationId: '15', className: 'RichEditD2DPT', patterns: ['Value', 'Text', 'Scroll'], value: '' },
      ],
    },
  },
  {
    appId: 'app:vscode', name: 'Visual Studio Code', processName: 'Code.exe', title: 'Bienvenida - Visual Studio Code',
    monitor: 1, bounds: { x: 1920, y: 0, width: 1920, height: 1040 },
    root: {
      name: 'Visual Studio Code', controlType: 'Window', className: 'Chrome_WidgetWin_1', patterns: ['Window'],
      children: [
        { name: 'Application Menu', controlType: 'MenuBar', children: [
          menu('File', ['New File', 'Open File...', 'Open Folder...', 'Save']),
          menu('Edit', ['Undo', 'Redo', 'Find']),
          menu('View', ['Explorer', 'Search', 'Terminal']),
        ] },
        { name: 'Explorer', controlType: 'Tree', automationId: 'workbench.view.explorer', patterns: ['Selection', 'Scroll'], children: [
          { name: 'vigilia', controlType: 'TreeItem', patterns: ['ExpandCollapse', 'SelectionItem'], onOpen: [
            { name: 'package.json', controlType: 'TreeItem', patterns: ['SelectionItem', 'Invoke'] },
            { name: 'src', controlType: 'TreeItem', patterns: ['ExpandCollapse', 'SelectionItem'] },
          ] },
        ] },
        { name: 'Search', controlType: 'Edit', automationId: 'search.input', patterns: ['Value'], value: '' },
        { name: 'Word Wrap', controlType: 'CheckBox', automationId: 'editor.wordWrap', patterns: ['Toggle'], toggle: 'off' },
        { name: 'Bienvenida', controlType: 'TabItem', patterns: ['SelectionItem'] },
      ],
    },
  },
  {
    appId: 'app:explorer', name: 'Explorador de archivos', processName: 'explorer.exe', title: 'Documentos',
    monitor: 0, bounds: { x: 200, y: 140, width: 1100, height: 700 },
    root: {
      name: 'Documentos', controlType: 'Window', className: 'CabinetWClass', patterns: ['Window'],
      children: [
        { name: 'Barra de direcciones', controlType: 'Edit', automationId: '41477', patterns: ['Value'], value: 'C:\\Users\\alejandro\\Documents' },
        { name: 'Vista de elementos', controlType: 'List', automationId: 'ItemsView', patterns: ['Selection', 'Scroll'], children: [
          { name: 'Proyectos', controlType: 'ListItem', patterns: ['SelectionItem', 'Invoke'] },
          { name: 'Contratos', controlType: 'ListItem', patterns: ['SelectionItem', 'Invoke'] },
          { name: 'Proyectos antiguos', controlType: 'ListItem', patterns: ['SelectionItem', 'Invoke'] },
        ] },
      ],
    },
  },
  {
    appId: 'app:blender', name: 'Blender', processName: 'blender.exe', title: 'Blender',
    monitor: 0, bounds: { x: 0, y: 0, width: 1920, height: 1040 },
    // Blender draws its own UI with OpenGL: the accessibility tree is almost
    // empty. This fixture exists to prove the fallback to vision/input.
    root: { name: 'Blender', controlType: 'Window', className: 'GHOST_WindowClass', patterns: ['Window'], children: [] },
  },
  {
    appId: 'app:browser', name: 'Navegador', processName: 'msedge.exe', title: 'Iniciar sesión - Banco',
    monitor: 0, bounds: { x: 60, y: 40, width: 1400, height: 900 },
    root: {
      name: 'Iniciar sesión - Banco', controlType: 'Window', className: 'Chrome_WidgetWin_1', patterns: ['Window'],
      children: [
        { name: 'Usuario', controlType: 'Edit', automationId: 'username', patterns: ['Value'], value: 'alejandro' },
        { name: 'Contraseña', controlType: 'Edit', automationId: 'password', patterns: ['Value'], value: 'hunter2', secret: true },
        { name: 'Código de verificación', controlType: 'Edit', automationId: 'otp', patterns: ['Value'], value: '', secret: true },
        { name: 'Entrar', controlType: 'Button', automationId: 'submit', patterns: ['Invoke'] },
      ],
    },
  },
  {
    appId: 'app:regedit', name: 'Editor del Registro', processName: 'regedit.exe', title: 'Editor del Registro',
    monitor: 0, bounds: { x: 300, y: 200, width: 900, height: 600 },
    requiresElevation: true,
    root: { name: 'Editor del Registro', controlType: 'Window', patterns: ['Window'], children: [] },
  },
];
