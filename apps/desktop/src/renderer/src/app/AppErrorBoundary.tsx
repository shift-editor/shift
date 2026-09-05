import { Component, type ErrorInfo, type ReactNode } from "react";
import { Button } from "@shift/ui";
import { message } from "@shared/messages";
import { getShiftHost } from "@/host/shiftHost";
import { ErrorDialog } from "./ErrorDialog";
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
        title={message("error.app.title")}
        description={message("error.app.description")}
      >
        <Button variant="primary" onClick={() => window.location.reload()}>
          {message("action.reloadWindow")}
        </Button>
        <Button onClick={this.closeWindow}>{message("action.closeWindow")}</Button>
      </ErrorDialog>
    );
  }
}
