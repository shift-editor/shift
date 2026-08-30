import { Component, type ErrorInfo, type ReactNode } from "react";
import { getShiftHost } from "@/host/shiftHost";
import { reportRendererError } from "./errorReporting";

type Props = { children: ReactNode };
type State = { error: Error | null };

export class AppErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    reportRendererError("AppErrorBoundary", error, info.componentStack ?? undefined);
  }

  render() {
    if (!this.state.error) return this.props.children;

    return (
      <main className="grid h-screen place-items-center bg-canvas p-8 text-primary">
        <section className="max-w-md space-y-4 rounded-lg border border-border bg-panel p-6 shadow-lg">
          <h1 className="text-lg font-semibold">
            Shift encountered an unexpected interface error.
          </h1>
          <p className="text-sm text-secondary">Reload the window to continue.</p>
          <div className="flex gap-2">
            <button
              className="rounded bg-primary px-3 py-2 text-sm text-primary-foreground"
              onClick={() => window.location.reload()}
            >
              Reload Window
            </button>
            <button
              className="rounded border border-border px-3 py-2 text-sm"
              onClick={() => getShiftHost().commands.run("window.close")}
            >
              Close Window
            </button>
          </div>
        </section>
      </main>
    );
  }
}
