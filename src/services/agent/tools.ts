/**
 * Compatibility surface. The registry now lives in `src/agent/registry.ts`
 * alongside the permission engine that consumes it; this file keeps the older
 * import path working for the views that only need the list.
 */
export { TOOL_DEFINITIONS as TOOL_REGISTRY, toolRegistry, ToolRegistry } from '@/agent/registry';
export { permissionRank } from '@/agent/permissions';
export { PERMISSION_ORDER } from '@/types';
