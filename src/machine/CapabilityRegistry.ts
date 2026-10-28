import type {
  Capability, CapabilityId, CapabilityState, LocalAIState, PermissionLevel, SystemProfile,
} from '@/types';
import { toolRegistry } from '@/agent/registry';
import { permissionRank } from '@/agent/permissions';
import { detectAcceleration } from './ModelRecommendationEngine';

interface Declaration {
  id: CapabilityId;
  label: string;
  description: string;
  requiredPermission: PermissionLevel;
  /** Tool whose enabled/implemented flags decide whether this can ever work. */
  tool?: string;
}

const DECLARATIONS: Declaration[] = [
  { id: 'filesystem.read', label: 'Leer archivos', description: 'Listar carpetas y leer metadatos.', requiredPermission: 'OBSERVE', tool: 'filesystem.list' },
  { id: 'filesystem.search', label: 'Buscar archivos', description: 'Buscar por nombre en las rutas permitidas.', requiredPermission: 'ASSIST', tool: 'filesystem.search' },
  { id: 'filesystem.write', label: 'Escribir archivos', description: 'FULL: archivos locales con permisos de Windows, escrituras atómicas y deshacer.', requiredPermission: 'CONTROL', tool: 'file.patch' },
  { id: 'filesystem.delete', label: 'Eliminar archivos', description: 'Borrado permanente. Deshabilitado: borrar es enviar a la papelera.', requiredPermission: 'ADMIN', tool: 'filesystem.delete' },
  { id: 'browser.navigate', label: 'Navegar', description: 'Abrir direcciones en una pestaña.', requiredPermission: 'ASSIST', tool: 'browser.navigate' },
  { id: 'browser.inspect', label: 'Inspeccionar páginas', description: 'Leer el texto y la estructura de la página abierta.', requiredPermission: 'OBSERVE', tool: 'browser.getPageText' },
  { id: 'browser.automate', label: 'Automatizar el navegador', description: 'Hacer clic y escribir dentro de una página.', requiredPermission: 'CONTROL' },
  { id: 'applications.discover', label: 'Detectar aplicaciones', description: 'Enumerar las aplicaciones instaladas.', requiredPermission: 'OBSERVE', tool: 'app.list' },
  { id: 'applications.launch', label: 'Abrir aplicaciones', description: 'Lanzar una aplicación instalada.', requiredPermission: 'ASSIST', tool: 'app.launch' },
  { id: 'screen.capture', label: 'Capturar pantalla', description: 'Tomar una captura para analizarla.', requiredPermission: 'OBSERVE', tool: 'screen.captureDisplay' },
  { id: 'uiAutomation', label: 'Automatización de UI', description: 'Operar ventanas mediante la API de accesibilidad.', requiredPermission: 'CONTROL', tool: 'ui.invoke' },
  { id: 'mouse.control', label: 'Control del ratón', description: 'Mover el puntero y hacer clic.', requiredPermission: 'CONTROL', tool: 'mouse.click' },
  { id: 'keyboard.control', label: 'Control del teclado', description: 'Escribir texto y enviar combinaciones.', requiredPermission: 'CONTROL', tool: 'keyboard.type' },
  { id: 'clipboard.read', label: 'Leer el portapapeles', description: 'Consultar el contenido copiado.', requiredPermission: 'OBSERVE' },
  { id: 'clipboard.write', label: 'Escribir en el portapapeles', description: 'Copiar contenido.', requiredPermission: 'ASSIST' },
  { id: 'terminal.execute', label: 'Ejecutar comandos', description: 'FULL: ejecución nativa, PowerShell/cmd y herramientas locales. RESTRICTED: conservador.', requiredPermission: 'CONTROL', tool: 'terminal.execute' },
  { id: 'git', label: 'Git', description: 'Consultar el repositorio local y operaciones locales seguras.', requiredPermission: 'OBSERVE', tool: 'git.status' },
  { id: 'localAI', label: 'IA local', description: 'Clasificar y responder con un modelo local.', requiredPermission: 'OBSERVE' },
  { id: 'localAI.gpuAcceleration', label: 'Aceleración por GPU', description: 'Ejecutar el modelo local sobre la GPU.', requiredPermission: 'OBSERVE' },
];

export interface CapabilityContext {
  profile: SystemProfile | null;
  localAI: LocalAIState | null;
  permission: PermissionLevel;
  /** Set when the app runs without the Electron bridge. */
  hasNativeBridge: boolean;
  /**
   * Whether the Windows automation helper is alive. Undefined means "not yet
   * known", which is treated as unavailable for anything that needs it.
   */
  helperAvailable?: boolean;
  /** A locked session or the secure desktop suspends interactive control. */
  sessionInteractive?: boolean;
}

/**
 * Turns "what this machine can do" plus "what the user allowed" into one list.
 *
 * The four states are distinct on purpose:
 *   UNAVAILABLE — the machine or the build cannot do it at all.
 *   DISABLED    — deliberately switched off in this version.
 *   RESTRICTED  — possible, but the current permission level forbids it.
 *   AVAILABLE   — usable right now.
 */
export class CapabilityRegistry {
  evaluate(context: CapabilityContext): Capability[] {
    return DECLARATIONS.map((d) => this.evaluateOne(d, context));
  }

  get(id: CapabilityId, context: CapabilityContext): Capability | undefined {
    const declaration = DECLARATIONS.find((d) => d.id === id);
    return declaration ? this.evaluateOne(declaration, context) : undefined;
  }

  private evaluateOne(d: Declaration, context: CapabilityContext): Capability {
    const make = (state: CapabilityState, reason: string | null): Capability => ({
      id: d.id, label: d.label, description: d.description, state, reason,
      requiredPermission: d.requiredPermission,
    });

    // Machine-level impossibility comes first: no permission can grant it.
    const machine = this.machineLimit(d, context);
    if (machine) return make(machine.state, machine.reason);

    if (d.tool) {
      const tool = toolRegistry.get(d.tool);
      if (!tool) return make('UNAVAILABLE', 'La herramienta no está declarada.');
      if (!tool.enabled) return make('DISABLED', 'Deshabilitada en esta versión.');
      if (!tool.implemented) return make('UNAVAILABLE', 'Declarada pero sin implementación.');
    } else if (d.id === 'browser.automate' || d.id === 'clipboard.read' || d.id === 'clipboard.write') {
      return make('DISABLED', 'Prevista para una etapa posterior.');
    }

    if (permissionRank(context.permission) < permissionRank(d.requiredPermission)) {
      return make('RESTRICTED', `Necesita el nivel ${d.requiredPermission}.`);
    }

    return make('AVAILABLE', null);
  }

  private machineLimit(d: Declaration, context: CapabilityContext): { state: CapabilityState; reason: string } | null {
    const { profile, localAI, hasNativeBridge } = context;

    if (d.id === 'localAI') {
      if (!localAI || localAI.status === 'NOT_CONFIGURED') return { state: 'UNAVAILABLE', reason: 'No se detectó ningún runtime local.' };
      if (localAI.status === 'OFFLINE') return { state: 'UNAVAILABLE', reason: 'El runtime local no responde.' };
      if (localAI.status === 'NO_MODELS') return { state: 'RESTRICTED', reason: 'El runtime está pero no hay modelos instalados.' };
      return null;
    }

    if (d.id === 'localAI.gpuAcceleration') {
      if (!profile) return { state: 'UNAVAILABLE', reason: 'Sin perfil del sistema.' };
      const accel = detectAcceleration(profile);
      if (accel === 'cpu') return { state: 'UNAVAILABLE', reason: 'No hay GPU utilizable para inferencia.' };
      if (accel === 'unknown') return { state: 'RESTRICTED', reason: 'La GPU no expone información suficiente.' };
      if (!localAI || localAI.status === 'NOT_CONFIGURED') return { state: 'UNAVAILABLE', reason: 'No hay runtime local que la use.' };
      return null;
    }

    // Everything below this line needs the main process.
    const nativeIds: CapabilityId[] = [
      'filesystem.read', 'filesystem.search', 'filesystem.write', 'filesystem.delete',
      'applications.discover', 'applications.launch', 'screen.capture', 'uiAutomation',
      'mouse.control', 'keyboard.control', 'terminal.execute', 'clipboard.read', 'clipboard.write', 'git',
    ];
    // Desktop control follows its real backend (helperAvailable) below, not the
    // presence of the machine bridge: the in-process harness adapter counts.
    const followsHelper: CapabilityId[] = ['uiAutomation', 'mouse.control', 'keyboard.control', 'screen.capture', 'applications.launch'];
    if (!hasNativeBridge && nativeIds.includes(d.id) && !(followsHelper.includes(d.id) && context.helperAvailable === true)) {
      return { state: 'UNAVAILABLE', reason: 'Requiere el proceso principal de la aplicación.' };
    }

    if (d.id === 'screen.capture' && profile && profile.displays.length === 0) {
      return { state: 'UNAVAILABLE', reason: 'No se detectó ninguna pantalla.' };
    }

    // Everything that drives Windows goes through the native helper. If it is
    // not running, these capabilities do not exist — no matter the permission.
    const helperIds: CapabilityId[] = ['uiAutomation', 'mouse.control', 'keyboard.control', 'screen.capture', 'applications.launch'];
    if (helperIds.includes(d.id) && context.helperAvailable !== true) {
      return { state: 'UNAVAILABLE', reason: 'El helper de automatización de Windows no está en ejecución.' };
    }

    const interactiveIds: CapabilityId[] = ['uiAutomation', 'mouse.control', 'keyboard.control', 'applications.launch'];
    if (interactiveIds.includes(d.id) && context.sessionInteractive === false) {
      return { state: 'RESTRICTED', reason: 'La sesión de Windows está bloqueada o en el escritorio seguro.' };
    }

    return null;
  }
}

export const capabilityRegistry = new CapabilityRegistry();

export function summarizeCapabilities(capabilities: Capability[]): Record<CapabilityState, number> {
  return capabilities.reduce(
    (acc, c) => ({ ...acc, [c.state]: acc[c.state] + 1 }),
    { AVAILABLE: 0, RESTRICTED: 0, DISABLED: 0, UNAVAILABLE: 0 } as Record<CapabilityState, number>,
  );
}

/** Legacy ranks are registry metadata only; live authority uses AccessMode. */
export function permissionLabel(level: PermissionLevel): string {
  return level;
}
