import { Component, type ErrorInfo, type ReactNode } from "react";

type Props = { children: ReactNode };
type State = { error: Error | null };

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("Unhandled UI error", error, info);
  }

  render() {
    if (!this.state.error) {
      return this.props.children;
    }

    return (
      <div className="grid gap-3 rounded-[var(--radius-card)] border border-rose-200 bg-rose-50 p-6">
        <h2 className="font-display text-lg text-rose-800">Something broke in the interface</h2>
        <p className="text-sm text-rose-700">{this.state.error.message}</p>
        <p className="text-[13px] text-rose-600">
          Your data on disk is unaffected. Reload the page; if it persists, check the rank-server logs.
        </p>
      </div>
    );
  }
}
