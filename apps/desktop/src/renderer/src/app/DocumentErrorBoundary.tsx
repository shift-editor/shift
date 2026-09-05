import { Component, type ErrorInfo, type ReactNode } from "react";
import { DocumentErrorScreen } from "./DocumentErrorScreen";
import { reportRendererError } from "./errorReporting";

type Props = { children: ReactNode };
type State = { error: Error | null };

export class DocumentErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    reportRendererError("DocumentErrorBoundary", error, info.componentStack ?? undefined);
  }

  render() {
    if (this.state.error) return <DocumentErrorScreen />;

    return this.props.children;
  }
}
