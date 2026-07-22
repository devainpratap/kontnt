import { Component, type ErrorInfo, type ReactNode } from "react";

import { Button } from "./Button";

type ErrorBoundaryProps = {
  children: ReactNode;
};

type ErrorBoundaryState = {
  error: Error | null;
};

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // Surface the crash in the console so it is recoverable during local work.
    console.error("Unhandled UI error:", error, info.componentStack);
  }

  handleReset = () => {
    this.setState({ error: null });
  };

  render() {
    if (this.state.error) {
      return (
        <main className="mx-auto flex max-w-2xl flex-col gap-4 px-5 py-16">
          <div className="grid gap-4 rounded-[var(--radius-card)] border border-rose-200 bg-rose-50/80 p-6 shadow-soft">
            <div className="grid gap-1.5">
              <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-rose-700">Something broke</p>
              <h1 className="font-display text-3xl leading-tight text-ink-900">The interface hit an unexpected error</h1>
              <p className="text-sm leading-6 text-ink-600">
                The workspace stopped rendering instead of showing a blank screen. Try again, or reload the page. Your
                saved job files on disk are untouched.
              </p>
            </div>
            <pre className="max-h-40 overflow-auto rounded-[var(--radius-md)] bg-white/70 px-3 py-2 font-mono text-xs leading-5 text-rose-800">
              {this.state.error.message}
            </pre>
            <div className="flex flex-wrap gap-2">
              <Button variant="primary" onClick={this.handleReset}>
                Try again
              </Button>
              <Button variant="ghost" onClick={() => window.location.reload()}>
                Reload page
              </Button>
            </div>
          </div>
        </main>
      );
    }

    return this.props.children;
  }
}
