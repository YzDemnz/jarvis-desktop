import type { ToolId } from '@/types';
import type { CancellationToken } from '../cancellation';

export interface ToolContext {
  runId: string;
  token: CancellationToken;
  signal: AbortSignal;
}

/**
 * An adapter is the only thing that touches a real system. It receives
 * already-validated arguments and a cancellation token, and it is never called
 * unless the permission engine said yes.
 */
export type ToolAdapter<A = never, R = unknown> = (args: A, context: ToolContext) => Promise<R> | R;

export type AdapterMap = Partial<Record<ToolId, ToolAdapter<never, unknown>>>;
