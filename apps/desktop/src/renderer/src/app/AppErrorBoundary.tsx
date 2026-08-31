import { Component, type ErrorInfo, type ReactNode } from "react";
import { Button } from "@shift/ui";
import { getShiftHost } from "@/host/shiftHost";
import { ErrorDialog } from "./ErrorDialog";
import { reportRendererError } from "./errorReporting";

type Props = { children: ReactNode };
type State = { error: Error | null; componentStack?: string };

export class AppErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    const componentStack = info.componentStack ?? undefined;
    reportRendererError("AppErrorBoundary", error, componentStack);
    this.setState({ componentStack });
  }

  async closeWindow(): Promise<void> {
    try {
      await getShiftHost().commands.run("window.close");
    } catch (error) {
      console.error("window close failed", error);
    }
  }

  render() {
    if (!this.state.error) return this.props.children;

    return (
      <ErrorDialog
        title="Something went wrong"
        description="Reload this window to continue."
        error={this.state.error}
        componentStack={this.state.componentStack}
      >
        <Button variant="primary" onClick={() => window.location.reload()}>
          Reload Window
        </Button>
        <Button onClick={this.closeWindow}>Close Window</Button>
      </ErrorDialog>
    );
  }
}
