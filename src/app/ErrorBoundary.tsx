import { Component } from 'react';
import type { ErrorInfo, ReactNode } from 'react';

interface Props {
  children: ReactNode;
  /** Shown in the fallback so the user knows which part failed. */
  label?: string;
  onReset?: () => void;
}

interface State {
  error: Error | null;
  info: string | null;
}

/**
 * A module that throws must not take the whole app with it. Without this, a
 * bad render anywhere leaves a blank window and no way back — the worst
 * possible failure mode for a tool that is supposed to be always available.
 *
 * The fallback keeps the shell alive and offers a retry, so a transient error
 * in one view never costs the user their session.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null, info: null };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // Kept in state rather than only logged, so the harness and the user see
    // the same thing.
    this.setState({ info: info.componentStack?.split('\n').slice(0, 4).join('\n') ?? null });
    console.error('[jarvis] error no controlado', error, info);
  }

  private reset = (): void => {
    this.setState({ error: null, info: null });
    this.props.onReset?.();
  };

  render(): ReactNode {
    const { error, info } = this.state;
    if (!error) return this.props.children;

    return (
      <div
        data-testid="error-boundary"
        className="h-full w-full grid place-items-center p-8 bg-graphite"
        role="alert"
      >
        <div className="max-w-md text-center">
          <p className="text-sm text-ink">
            {this.props.label ? `${this.props.label} dejó de responder.` : 'Algo dejó de responder.'}
          </p>
          <p className="text-xs text-muted mt-2 break-words">{error.message}</p>
          {info && (
            <pre className="text-2xs text-faint mt-3 text-left whitespace-pre-wrap max-h-24 overflow-auto">
              {info}
            </pre>
          )}
          <button
            data-testid="error-boundary-retry"
            onClick={this.reset}
            className="mt-5 px-3 py-1.5 rounded-md text-xs border border-hairline text-muted hover:text-ink hover:bg-raised transition-colors"
          >
            Reintentar
          </button>
        </div>
      </div>
    );
  }
}
