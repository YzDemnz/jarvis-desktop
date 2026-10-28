import type { ToolDefinition, ToolId } from '@/types';


function tool(
  id: ToolDefinition['id'], name: string, category: ToolDefinition['category'], description: string,
  requiredPermission: ToolDefinition['requiredPermission'], risk: ToolDefinition['risk'],
  strategy: ToolDefinition['strategy'],
): ToolDefinition {
  return { id, name, category, description, requiredPermission, risk, requiresApproval: false, strategy, enabled: true, implemented: true };
}
const interactive = (t: ToolDefinition): ToolDefinition => ({ ...t, interactive: true });
const routine = (t: ToolDefinition): ToolDefinition => ({ ...t, routine: true });
const shape = (t: ToolDefinition): ToolDefinition => ({ ...t, auditArgs: 'shape' });

/**
 * Every capability JARVIS will ever hold is declared here, including the ones
 * that are deliberately inert. Declaring them is what lets the permission
 * engine refuse them by name instead of failing with "unknown tool", and what
 * lets Settings show the user exactly what exists and what is switched off.
 *
 * `enabled: false`  → refused by the broker, at any permission level.
 * `implemented: false` → declared for a later stage, no adapter exists.
 */
export const TOOL_DEFINITIONS: ToolDefinition[] = [
  /* ---------------- browser: read and navigate ---------------- */
  {
    id: 'browser.getActiveTab', name: 'Pestaña activa', category: 'browser',
    description: 'Leer url, título, estado de carga e id de la pestaña activa.',
    requiredPermission: 'OBSERVE', risk: 'SAFE', requiresApproval: false,
    strategy: 'direct_api', enabled: true, implemented: true,
  },
  {
    id: 'browser.getPageText', name: 'Texto de la página', category: 'browser',
    description: 'Extraer el texto visible de la pestaña activa.',
    requiredPermission: 'OBSERVE', risk: 'SAFE', requiresApproval: false,
    strategy: 'browser_dom', enabled: true, implemented: true,
  },
  {
    id: 'browser.navigate', name: 'Navegar', category: 'browser',
    description: 'Abrir una dirección en la pestaña activa.',
    requiredPermission: 'ASSIST', risk: 'SAFE', requiresApproval: false,
    strategy: 'direct_api', enabled: true, implemented: true,
  },
  {
    id: 'browser.back', name: 'Atrás', category: 'browser',
    description: 'Retroceder en el historial de la pestaña activa.',
    requiredPermission: 'ASSIST', risk: 'SAFE', requiresApproval: false,
    strategy: 'direct_api', enabled: true, implemented: true,
  },
  {
    id: 'browser.forward', name: 'Adelante', category: 'browser',
    description: 'Avanzar en el historial de la pestaña activa.',
    requiredPermission: 'ASSIST', risk: 'SAFE', requiresApproval: false,
    strategy: 'direct_api', enabled: true, implemented: true,
  },

  /* ---------------- filesystem: read-only for now ---------------- */
  shape(tool('filesystem.readText', 'Leer texto del dispositivo', 'filesystem', 'Lectura local acotada de texto UTF-8/UTF-16 con huella y redacción.', 'ASSIST', 'SAFE', 'direct_api')),
  {
    id: 'filesystem.getDrives', name: 'Unidades', category: 'filesystem',
    description: 'Listar las unidades o puntos de montaje disponibles.',
    requiredPermission: 'OBSERVE', risk: 'SAFE', requiresApproval: false,
    strategy: 'direct_api', enabled: true, implemented: true,
  },
  {
    id: 'filesystem.list', name: 'Listar carpeta', category: 'filesystem',
    description: 'Listar el contenido de una carpeta. Sólo lectura.',
    requiredPermission: 'OBSERVE', risk: 'SAFE', requiresApproval: false,
    strategy: 'direct_api', enabled: true, implemented: true,
  },
  {
    id: 'filesystem.stat', name: 'Información de archivo', category: 'filesystem',
    description: 'Tamaño, fechas y tipo de una ruta. Sólo lectura.',
    requiredPermission: 'OBSERVE', risk: 'SAFE', requiresApproval: false,
    strategy: 'direct_api', enabled: true, implemented: true,
  },
  {
    id: 'filesystem.exists', name: 'Comprobar ruta', category: 'filesystem',
    description: 'Comprobar si una ruta existe. Sólo lectura.',
    requiredPermission: 'OBSERVE', risk: 'SAFE', requiresApproval: false,
    strategy: 'direct_api', enabled: true, implemented: true,
  },
  {
    id: 'filesystem.search', name: 'Buscar archivos', category: 'filesystem',
    description: 'Buscar por nombre bajo una raíz permitida. Sólo lectura.',
    requiredPermission: 'ASSIST', risk: 'SAFE', requiresApproval: false,
    strategy: 'direct_api', enabled: true, implemented: true,
  },
  {
    id: 'filesystem.write', name: 'Escribir archivo', category: 'filesystem',
    description: 'Crear o modificar un archivo.',
    requiredPermission: 'CONTROL', risk: 'SENSITIVE', requiresApproval: true,
    strategy: 'direct_api', enabled: false, implemented: false,
  },
  {
    id: 'filesystem.delete', name: 'Eliminar permanentemente', category: 'filesystem',
    description: 'Borrado permanente. Deshabilitado: borrar es file.trash (papelera).',
    requiredPermission: 'ADMIN', risk: 'DESTRUCTIVE', requiresApproval: true,
    strategy: 'direct_api', enabled: false, implemented: false,
  },

  /* ---------------- system and processes ---------------- */
  {
    id: 'system.getInfo', name: 'Información del sistema', category: 'system',
    description: 'Sistema operativo, memoria, CPU y tiempo encendido.',
    requiredPermission: 'OBSERVE', risk: 'SAFE', requiresApproval: false,
    strategy: 'direct_api', enabled: true, implemented: true,
  },
  {
    id: 'process.list', name: 'Listar procesos', category: 'process',
    description: 'Enumerar los procesos en ejecución. Sólo lectura.',
    requiredPermission: 'OBSERVE', risk: 'SAFE', requiresApproval: false,
    strategy: 'direct_api', enabled: true, implemented: true,
  },

  /* ---------------- applications ---------------- */
  {
    id: 'app.list', name: 'Aplicaciones instaladas', category: 'app',
    description: 'Detectar aplicaciones y accesos directos. Sólo lectura.',
    requiredPermission: 'OBSERVE', risk: 'SAFE', requiresApproval: false,
    strategy: 'direct_api', enabled: true, implemented: true,
  },


  /* ================================================================ */
  /* Desktop control                                                   */
  /* Ladder: DIRECT → DOM → UI_AUTOMATION → VISION → INPUT             */
  /* ================================================================ */

  /* ---------------- applications and processes ---------------- */
  {
    id: 'app.launch', name: 'Abrir aplicación', category: 'app',
    description: 'Lanzar una aplicación ya descubierta. Nunca rutas ni argumentos arbitrarios.',
    requiredPermission: 'ASSIST', risk: 'SENSITIVE', requiresApproval: true, routine: true,
    strategy: 'direct_api', enabled: true, implemented: true, interactive: true,
  },
  tool('process.find', 'Buscar procesos', 'process', 'Encontrar procesos por nombre. Sólo lectura.', 'OBSERVE', 'SAFE', 'direct_api'),
  tool('process.info', 'Información de proceso', 'process', 'Memoria y ventanas de un proceso. Sólo lectura.', 'OBSERVE', 'SAFE', 'direct_api'),
  {
    id: 'process.terminate', name: 'Terminar proceso', category: 'process',
    description: 'Forzar el cierre de un proceso.',
    requiredPermission: 'ADMIN', risk: 'DESTRUCTIVE', requiresApproval: true,
    strategy: 'direct_api', enabled: false, implemented: false, interactive: true,
  },
  tool('desktop.snapshot', 'Estado del escritorio', 'screen', 'Ventanas, monitores y cursor, sin capturar imagen.', 'OBSERVE', 'SAFE', 'direct_api'),

  /* ---------------- windows ---------------- */
  tool('window.list', 'Listar ventanas', 'app', 'Enumerar las ventanas abiertas.', 'OBSERVE', 'SAFE', 'ui_automation'),
  tool('window.active', 'Ventana activa', 'app', 'Leer la ventana con el foco.', 'OBSERVE', 'SAFE', 'ui_automation'),
  tool('window.find', 'Buscar ventana', 'app', 'Buscar ventanas por proceso o título.', 'OBSERVE', 'SAFE', 'ui_automation'),
  interactive(tool('window.focus', 'Enfocar ventana', 'app', 'Traer una ventana al frente.', 'ASSIST', 'SAFE', 'ui_automation')),
  interactive(tool('window.minimize', 'Minimizar ventana', 'app', 'Minimizar una ventana.', 'ASSIST', 'SAFE', 'ui_automation')),
  interactive(tool('window.maximize', 'Maximizar ventana', 'app', 'Maximizar una ventana.', 'ASSIST', 'SAFE', 'ui_automation')),
  interactive(tool('window.restore', 'Restaurar ventana', 'app', 'Restaurar el tamaño de una ventana.', 'ASSIST', 'SAFE', 'ui_automation')),
  routine(interactive(tool('window.move', 'Mover ventana', 'app', 'Cambiar la posición de una ventana.', 'CONTROL', 'SENSITIVE', 'ui_automation'))),
  routine(interactive(tool('window.resize', 'Redimensionar ventana', 'app', 'Cambiar el tamaño de una ventana.', 'CONTROL', 'SENSITIVE', 'ui_automation'))),
  // Closing is never routine: unsaved work may be at stake.
  interactive(tool('window.close', 'Cerrar ventana', 'app', 'Pedir a una ventana que se cierre. La app puede mostrar su diálogo de guardado.', 'CONTROL', 'SENSITIVE', 'ui_automation')),

  /* ---------------- UI Automation ---------------- */
  tool('ui.inspect', 'Inspeccionar interfaz', 'app', 'Leer el árbol accesible de una ventana.', 'OBSERVE', 'SAFE', 'ui_automation'),
  tool('ui.find', 'Buscar elementos', 'app', 'Localizar controles por nombre, id o tipo.', 'OBSERVE', 'SAFE', 'ui_automation'),
  interactive(tool('ui.focus', 'Enfocar control', 'app', 'Dar el foco a un control.', 'ASSIST', 'SAFE', 'ui_automation')),
  routine(interactive(tool('ui.invoke', 'Activar control', 'app', 'Pulsar un botón o elemento de menú.', 'CONTROL', 'SENSITIVE', 'ui_automation'))),
  shape(routine(interactive(tool('ui.setValue', 'Escribir en campo', 'app', 'Establecer el texto de un campo. Nunca en campos de credenciales.', 'CONTROL', 'SENSITIVE', 'ui_automation')))),
  routine(interactive(tool('ui.toggle', 'Alternar control', 'app', 'Marcar o desmarcar una casilla.', 'CONTROL', 'SENSITIVE', 'ui_automation'))),
  routine(interactive(tool('ui.select', 'Seleccionar elemento', 'app', 'Seleccionar un elemento de lista o árbol.', 'CONTROL', 'SENSITIVE', 'ui_automation'))),
  routine(interactive(tool('ui.expand', 'Expandir', 'app', 'Expandir un nodo o menú.', 'CONTROL', 'SENSITIVE', 'ui_automation'))),
  routine(interactive(tool('ui.collapse', 'Contraer', 'app', 'Contraer un nodo o menú.', 'CONTROL', 'SENSITIVE', 'ui_automation'))),
  routine(interactive(tool('ui.scroll', 'Desplazar', 'app', 'Desplazar un contenedor.', 'CONTROL', 'SENSITIVE', 'ui_automation'))),

  /* ---------------- screen ---------------- */
  // Observation, but a screen can show anything private: SENSITIVE, and asks.
  { ...tool('screen.captureDisplay', 'Capturar pantalla', 'screen', 'Capturar un monitor completo. Sólo en memoria.', 'OBSERVE', 'SENSITIVE', 'vision'), requiresApproval: true },
  { ...tool('screen.captureWindow', 'Capturar ventana', 'screen', 'Capturar una ventana. Sólo en memoria.', 'OBSERVE', 'SENSITIVE', 'vision'), requiresApproval: true },
  { ...tool('screen.captureRegion', 'Capturar región', 'screen', 'Capturar una región. Sólo en memoria.', 'OBSERVE', 'SENSITIVE', 'vision'), requiresApproval: true },

  /* ---------------- mouse: last resort ---------------- */
  routine(interactive(tool('mouse.move', 'Mover ratón', 'input', 'Mover el puntero a un elemento.', 'CONTROL', 'SENSITIVE', 'input_synthesis'))),
  routine(interactive(tool('mouse.click', 'Clic', 'input', 'Hacer clic sobre un elemento.', 'CONTROL', 'SENSITIVE', 'input_synthesis'))),
  routine(interactive(tool('mouse.doubleClick', 'Doble clic', 'input', 'Hacer doble clic sobre un elemento.', 'CONTROL', 'SENSITIVE', 'input_synthesis'))),
  routine(interactive(tool('mouse.rightClick', 'Clic derecho', 'input', 'Abrir el menú contextual de un elemento.', 'CONTROL', 'SENSITIVE', 'input_synthesis'))),
  routine(interactive(tool('mouse.scroll', 'Rueda del ratón', 'input', 'Desplazar con la rueda.', 'CONTROL', 'SENSITIVE', 'input_synthesis'))),
  interactive(tool('mouse.drag', 'Arrastrar', 'input', 'Arrastrar entre dos puntos.', 'CONTROL', 'SENSITIVE', 'input_synthesis')),

  /* ---------------- keyboard: last resort ---------------- */
  routine(interactive(tool('keyboard.press', 'Pulsar tecla', 'input', 'Pulsar una tecla.', 'CONTROL', 'SENSITIVE', 'input_synthesis'))),
  interactive(tool('keyboard.hotkey', 'Combinación de teclas', 'input', 'Enviar una combinación. Las reservadas por Windows se rechazan.', 'CONTROL', 'SENSITIVE', 'input_synthesis')),
  shape(routine(interactive(tool('keyboard.type', 'Escribir texto', 'input', 'Escribir texto no sensible. Nunca credenciales.', 'CONTROL', 'SENSITIVE', 'input_synthesis')))),


  /* ---------------- developer agent (phase 7) ---------------- */
  tool('project.discover', 'Descubrir proyectos', 'filesystem', 'Buscar proyectos dentro de los Project Roots autorizados.', 'OBSERVE', 'SAFE', 'direct_api'),
  tool('project.list', 'Listar proyectos', 'filesystem', 'Proyectos conocidos.', 'OBSERVE', 'SAFE', 'direct_api'),
  tool('project.inspect', 'Inspeccionar proyecto', 'filesystem', 'Tecnologías, Git, archivos y verificaciones de un proyecto.', 'OBSERVE', 'SAFE', 'direct_api'),
  tool('project.open', 'Abrir proyecto', 'filesystem', 'Indexar y vigilar un proyecto.', 'ASSIST', 'SAFE', 'direct_api'),
  tool('project.checks', 'Verificaciones del proyecto', 'filesystem', 'Qué señales de verificación existen (typecheck, lint, build, tests).', 'OBSERVE', 'SAFE', 'direct_api'),
  tool('project.verify', 'Evidencia de comprobaciones', 'filesystem', 'Recibo main de comandos sellados y snapshot del proyecto; no corrección universal.', 'OBSERVE', 'SAFE', 'direct_api'),
  tool('code.search', 'Buscar en el código', 'filesystem', 'Definiciones, archivos y texto.', 'ASSIST', 'SAFE', 'direct_api'),
  tool('code.searchText', 'Buscar texto', 'filesystem', 'Texto o expresión regular acotada en el proyecto.', 'ASSIST', 'SAFE', 'direct_api'),
  tool('code.searchFiles', 'Buscar archivos', 'filesystem', 'Archivos por nombre.', 'ASSIST', 'SAFE', 'direct_api'),
  tool('code.findReferences', 'Buscar referencias', 'filesystem', 'Usos de un símbolo.', 'ASSIST', 'SAFE', 'direct_api'),
  tool('code.findDefinition', 'Buscar definición', 'filesystem', 'Dónde se define un símbolo.', 'ASSIST', 'SAFE', 'direct_api'),
  tool('code.context', 'Reunir contexto', 'filesystem', 'Archivos relevantes con límites de tamaño; excluye secretos.', 'ASSIST', 'SAFE', 'direct_api'),
  tool('file.read', 'Leer archivo del proyecto', 'filesystem', 'Leer un archivo (por rangos si es grande; secretos redactados).', 'ASSIST', 'SAFE', 'direct_api'),
  tool('file.proposePatch', 'Proponer parche', 'filesystem', 'Calcular un diff sin escribir nada.', 'ASSIST', 'SAFE', 'direct_api'),
  routine(tool('file.create', 'Crear archivo', 'filesystem', 'Crear un archivo nuevo (escritura atómica).', 'CONTROL', 'SENSITIVE', 'direct_api')),
  routine(tool('file.write', 'Reescribir archivo', 'filesystem', 'Reescribir un archivo leído antes (con detección de conflictos).', 'CONTROL', 'SENSITIVE', 'direct_api')),
  routine(tool('file.patch', 'Parchear archivo', 'filesystem', 'Aplicar un parche (con detección de conflictos).', 'CONTROL', 'SENSITIVE', 'direct_api')),
  routine(tool('file.rename', 'Renombrar archivo', 'filesystem', 'Renombrar sin sobrescribir.', 'CONTROL', 'SENSITIVE', 'direct_api')),
  routine(tool('file.move', 'Mover archivo', 'filesystem', 'Mover sin sobrescribir.', 'CONTROL', 'SENSITIVE', 'direct_api')),
  routine(tool('file.copy', 'Copiar archivo', 'filesystem', 'Copiar sin sobrescribir.', 'CONTROL', 'SENSITIVE', 'direct_api')),
  routine(tool('directory.create', 'Crear carpeta', 'filesystem', 'Crear una carpeta en el proyecto.', 'CONTROL', 'SENSITIVE', 'direct_api')),
  { ...tool('file.trash', 'Enviar a la papelera', 'filesystem', 'Mover a la Papelera de reciclaje. Nunca borrado permanente.', 'CONTROL', 'DESTRUCTIVE', 'direct_api'), requiresApproval: true },
  routine(tool('terminal.execute', 'Ejecutar proceso', 'terminal', 'Un ejecutable permitido con argumentos estructurados. Sin shell.', 'CONTROL', 'SENSITIVE', 'direct_api')),
  tool('terminal.output', 'Ver salida completa', 'terminal', 'Buscar en la salida guardada de un comando.', 'ASSIST', 'SAFE', 'direct_api'),
  routine(tool('process.start', 'Iniciar servicio', 'process', 'Iniciar un proceso de larga duración gestionado.', 'CONTROL', 'SENSITIVE', 'direct_api')),
  tool('process.status', 'Estado de servicios', 'process', 'Procesos iniciados por JARVIS.', 'OBSERVE', 'SAFE', 'direct_api'),
  tool('process.logs', 'Registros de servicio', 'process', 'Salida de un proceso gestionado.', 'OBSERVE', 'SAFE', 'direct_api'),
  routine(tool('process.stop', 'Detener servicio', 'process', 'Detener un proceso que JARVIS inició.', 'CONTROL', 'SENSITIVE', 'direct_api')),
  tool('dev.tools', 'Herramientas de desarrollo', 'system', 'Node, Python, Git, .NET… instalados y su versión.', 'OBSERVE', 'SAFE', 'direct_api'),
  tool('git.status', 'Git status', 'git', 'Estado del repositorio local.', 'OBSERVE', 'SAFE', 'direct_api'),
  tool('git.diff', 'Git diff', 'git', 'Diferencias locales.', 'OBSERVE', 'SAFE', 'direct_api'),
  tool('git.log', 'Git log', 'git', 'Historial reciente.', 'OBSERVE', 'SAFE', 'direct_api'),
  tool('git.branch', 'Git branch', 'git', 'Ramas locales.', 'OBSERVE', 'SAFE', 'direct_api'),
  tool('git.show', 'Git show', 'git', 'Contenido de un commit o archivo en una revisión.', 'OBSERVE', 'SAFE', 'direct_api'),
  routine(tool('git.add', 'Git add', 'git', 'Preparar archivos concretos.', 'CONTROL', 'SENSITIVE', 'direct_api')),
  { ...tool('git.restore', 'Git restore', 'git', 'Restaurar archivos que estaban limpios antes de JARVIS.', 'CONTROL', 'DESTRUCTIVE', 'direct_api'), requiresApproval: true },
  { ...tool('git.checkoutFile', 'Git checkout de archivo', 'git', 'Igual que restore, para un archivo.', 'CONTROL', 'DESTRUCTIVE', 'direct_api'), requiresApproval: true },
  { ...tool('git.commit', 'Git commit', 'git', 'Commit local. Deshabilitado salvo configuración explícita.', 'ADMIN', 'SENSITIVE', 'direct_api'), requiresApproval: true },
  tool('changes.review', 'Revisar cambios', 'filesystem', 'Cambios de JARVIS en la tarea, separados de los previos.', 'OBSERVE', 'SAFE', 'direct_api'),
  { ...tool('changes.revert', 'Revertir cambios de la tarea', 'filesystem', 'Deshacer los cambios de JARVIS conservando ediciones posteriores del usuario.', 'CONTROL', 'SENSITIVE', 'direct_api'), requiresApproval: true },
  routine(tool('changes.undoLast', 'Deshacer último cambio', 'filesystem', 'Deshacer la última operación de JARVIS.', 'CONTROL', 'SENSITIVE', 'direct_api')),
  { ...tool('git.push', 'Git push', 'git', 'Todavía no disponible.', 'ADMIN', 'CRITICAL', 'direct_api'), requiresApproval: true, enabled: false, implemented: false },
  { ...tool('git.reset', 'Git reset --hard', 'git', 'Deshabilitado: descarta trabajo.', 'ADMIN', 'CRITICAL', 'direct_api'), requiresApproval: true, enabled: false, implemented: false },
  { ...tool('git.clean', 'Git clean -fd', 'git', 'Deshabilitado: borra archivos sin papelera.', 'ADMIN', 'CRITICAL', 'direct_api'), requiresApproval: true, enabled: false, implemented: false },
  { ...tool('git.rebase', 'Git rebase', 'git', 'Deshabilitado.', 'ADMIN', 'DESTRUCTIVE', 'direct_api'), requiresApproval: true, enabled: false, implemented: false },
  { ...tool('process.kill', 'Matar proceso ajeno', 'process', 'Deshabilitado: sólo se detienen procesos propios.', 'ADMIN', 'CRITICAL', 'direct_api'), requiresApproval: true, enabled: false, implemented: false },

  /* ---------------- declared, inert ---------------- */
  {
    id: 'terminal.run', name: 'Ejecutar línea de shell', category: 'terminal',
    description: 'Líneas de shell arbitrarias. Deshabilitado: usa terminal.execute (estructurado).',
    requiredPermission: 'ADMIN', risk: 'DESTRUCTIVE', requiresApproval: true,
    strategy: 'direct_api', enabled: false, implemented: false,
  },
  {
    id: 'credential.show', name: 'Revelar credencial', category: 'vault',
    description: 'Mostrar el valor de una credencial guardada.',
    requiredPermission: 'ADMIN', risk: 'CRITICAL', requiresApproval: true,
    strategy: 'direct_api', enabled: false, implemented: false,
  },

  /* ---------------- models ---------------- */
  {
    id: 'model.classify', name: 'Clasificar petición', category: 'model',
    description: 'Pedir al router local que clasifique la tarea.',
    requiredPermission: 'OBSERVE', risk: 'SAFE', requiresApproval: false,
    strategy: 'direct_api', enabled: true, implemented: true,
  },
];

/** Lookup with a stable, immutable view of the declarations. */
export class ToolRegistry {
  private readonly byId = new Map<ToolId, ToolDefinition>();

  constructor(definitions: ToolDefinition[] = TOOL_DEFINITIONS) {
    definitions.forEach((d) => this.byId.set(d.id, { ...d }));
  }

  get(id: ToolId): ToolDefinition | undefined {
    return this.byId.get(id);
  }

  has(id: ToolId): boolean {
    return this.byId.has(id);
  }

  all(): ToolDefinition[] {
    return [...this.byId.values()];
  }

  byCategory(category: ToolDefinition['category']): ToolDefinition[] {
    return this.all().filter((t) => t.category === category);
  }

  /** Tools a session at this level could run right now. */
  availableAt(level: ToolDefinition['requiredPermission']): ToolDefinition[] {
    const order = ['OBSERVE', 'ASSIST', 'CONTROL', 'ADMIN'];
    return this.all().filter(
      (t) => t.enabled && t.implemented && order.indexOf(t.requiredPermission) <= order.indexOf(level),
    );
  }

  /** Registering an adapter for an undeclared id is a programming error. */
  assertKnown(id: ToolId): ToolDefinition {
    const tool = this.byId.get(id);
    if (!tool) throw new Error(`Herramienta no declarada: ${String(id)}`);
    return tool;
  }
}

export const toolRegistry = new ToolRegistry();
