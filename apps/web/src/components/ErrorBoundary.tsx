import { Component, type ErrorInfo, type ReactNode } from "react";

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
          <div className="grid gap-4 rounded-[28px] border border-rose-200 bg-rose-50/80 p-6">
            <div className="grid gap-1.5">
              <p className="text-xs font-semibold uppercase tracking-[0.14em] text-rose-700">Something broke</p>
              <h1 className="text-2xl font-semibold text-stone-900">The interface hit an unexpected error</h1>
              <p className="text-sm leading-6 text-stone-600">
                The workspace stopped rendering instead of showing a blank screen. Try again, or reload the page. Your
                saved job files on disk are untouched.
              </p>
            </div>
            <pre className="max-h-40 overflow-auto rounded-xl bg-white/70 px-3 py-2 font-mono text-xs leading-5 text-rose-800">
              {this.state.error.message}
            </pre>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={this.handleReset}
                className="rounded-xl bg-emerald-800 px-4 py-2 text-sm font-semibold text-white transition hover:bg-emerald-900"
              >
                Try again
              </button>
              <button
                type="button"
                onClick={() => window.location.reload()}
                className="rounded-xl border border-stone-300 px-4 py-2 text-sm font-semibold text-stone-800 transition hover:border-emerald-400 hover:bg-white"
              >
                Reload page
              </button>
            </div>
          </div>
        </main>
      );
    }

    return this.props.children;
  }
}
