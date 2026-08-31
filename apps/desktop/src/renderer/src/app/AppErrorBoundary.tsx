import { Component, type ErrorInfo, type ReactNode } from "react";
import { Button } from "@shift/ui";
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
            <Button variant="primary" onClick={() => window.location.reload()}>
              Reload Window
            </Button>
            <Button onClick={() => getShiftHost().commands.run("window.close")}>
              Close Window
            </Button>
          </div>
        </section>
      </main>
    );
  }
}
