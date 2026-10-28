import type { PermissionLevel, ToolDefinition, ToolRisk } from '@/types';
import { PERMISSION_ORDER } from '@/types';

export function permissionRank(level: PermissionLevel): number {
  if (level === 'FULL') return 4;
  if (level === 'RESTRICTED') return 1;
  return PERMISSION_ORDER.indexOf(level);
}

export type PermissionOutcome =
  | { allowed: true; needsApproval: boolean }
  | { allowed: false; needsApproval: false; reason: string; code: 'tool_disabled' | 'not_implemented' | 'permission_denied' };

/**
 * The single place that decides whether a capability may run.
 *
 * Two rules, in this order:
 *   1. A tool that is disabled or unimplemented never runs, at any level.
 *      This is what keeps CRITICAL capabilities declared but inert.
 *   2. The tool's own declared minimum must be met by the session level.
 *      The global level alone is never enough — it is only half the check.
 *
 * Approval is a separate question from permission: a tool can be permitted and
 * still require a human to say yes.
 */
export class PermissionEngine {
  check(tool: ToolDefinition | undefined, level: PermissionLevel): PermissionOutcome {
    if (!tool) {
      return { allowed: false, needsApproval: false, code: 'tool_disabled', reason: 'Herramienta desconocida.' };
    }
    if (!tool.enabled) {
      return {
        allowed: false,
        needsApproval: false,
        code: 'tool_disabled',
        reason: `«${tool.name}» está deshabilitada en esta versión.`,
      };
    }
    if (!tool.implemented) {
      return {
        allowed: false,
        needsApproval: false,
        code: 'not_implemented',
        reason: `«${tool.name}» está declarada pero todavía no tiene implementación.`,
      };
    }
    if (permissionRank(level) < permissionRank(tool.requiredPermission)) {
      return {
        allowed: false,
        needsApproval: false,
        code: 'permission_denied',
        reason: `«${tool.name}» necesita ${tool.requiredPermission}; la sesión está en ${level}.`,
      };
    }
    return { allowed: true, needsApproval: this.needsApproval(tool, level) };
  }

  /**
   * Risk decides approval. The one relaxation: under FULL CONTROL (ADMIN),
   * tools marked `routine` stop asking every time. That relaxation never
   * reaches DESTRUCTIVE or CRITICAL — those ask at every level, always.
   */
  needsApproval(tool: ToolDefinition, level?: PermissionLevel): boolean {
    if (level === 'FULL') return false; // Navigation guard is authoritative in main.
    if (tool.risk === 'DESTRUCTIVE' || tool.risk === 'CRITICAL') return true;
    const relaxed = level === 'ADMIN' && tool.routine === true;
    if (tool.requiresApproval) return !relaxed;
    if (tool.risk === 'SENSITIVE') return !relaxed;
    return false;
  }

  /** Lowest level that would let this tool run. Used by the UI to explain. */
  levelNeededFor(tool: ToolDefinition): PermissionLevel {
    return tool.requiredPermission;
  }

  static riskRank(risk: ToolRisk): number {
    return ['SAFE', 'SENSITIVE', 'DESTRUCTIVE', 'CRITICAL'].indexOf(risk);
  }
}

export const permissionEngine = new PermissionEngine();
