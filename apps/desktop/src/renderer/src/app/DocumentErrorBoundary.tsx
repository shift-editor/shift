import { Component, type ErrorInfo, type ReactNode } from "react";
import { DocumentErrorScreen } from "./DocumentErrorScreen";
import { reportRendererError } from "./errorReporting";

type Props = { children: ReactNode };
type State = { error: Error | null; componentStack?: string };

export class DocumentErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    const componentStack = info.componentStack ?? undefined;
    reportRendererError("DocumentErrorBoundary", error, componentStack);
    this.setState({ componentStack });
  }

  render() {
    if (this.state.error) {
      return (
        <DocumentErrorScreen error={this.state.error} componentStack={this.state.componentStack} />
      );
    }

    return this.props.children;
  }
}
