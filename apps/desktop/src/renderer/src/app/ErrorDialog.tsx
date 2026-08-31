import type { ReactNode } from "react";
import {
  Button,
  Collapsible,
  CollapsibleChevron,
  CollapsiblePanel,
  CollapsibleTrigger,
  Dialog,
  DialogBackdrop,
  DialogPopup,
  DialogPortal,
  DialogTitle,
} from "@shift/ui";

declare const SHIFT_BUILD_COMMIT: string | undefined;

type ErrorDialogProps = {
  title: string;
  description: string;
  error: unknown;
  componentStack?: string;
  children: ReactNode;
};

export function ErrorDialog({
  title,
  description,
  error,
  componentStack,
  children,
}: ErrorDialogProps) {
  const message = error instanceof Error ? error.message : String(error);
  const stack = error instanceof Error ? error.stack : undefined;
  const route = window.location.hash || "(no route)";
  const buildCommit = typeof SHIFT_BUILD_COMMIT === "string" ? SHIFT_BUILD_COMMIT : "unknown";
  const details = [
    `Error\n${message}`,
    `Route\n${route}`,
    `Build\n${buildCommit}`,
    stack ? `JavaScript stack\n${stack}` : null,
    componentStack ? `React component stack\n${componentStack.trim()}` : null,
  ]
    .filter((section): section is string => section !== null)
    .join("\n\n");

  return (
    <main className="h-screen bg-canvas text-primary">
      <Dialog open>
        <DialogPortal>
          <DialogBackdrop className="bg-canvas" />
          <DialogPopup className="top-1/2 max-h-[calc(100vh-4rem)] w-[min(40rem,calc(100vw-4rem))] max-w-none -translate-y-1/2 overflow-y-auto rounded-lg bg-panel p-6 shadow-lg">
            <DialogTitle className="text-lg font-semibold">{title}</DialogTitle>
            <p className="mt-2 text-sm text-secondary">{description}</p>
            <Collapsible className="mt-4">
              <CollapsibleTrigger
                render={<Button variant="ghost" size="md" className="justify-start" />}
              >
                <CollapsibleChevron />
                <span className="group-data-[panel-open]:hidden">Show details</span>
                <span className="hidden group-data-[panel-open]:inline">Hide details</span>
              </CollapsibleTrigger>
              <CollapsiblePanel>
                <pre
                  aria-label="Error details"
                  className="mt-2 max-h-64 overflow-auto rounded-md bg-canvas p-3 whitespace-pre-wrap break-words font-mono text-sm text-secondary"
                >
                  {details}
                </pre>
              </CollapsiblePanel>
            </Collapsible>
            <div className="mt-5 flex gap-2">{children}</div>
          </DialogPopup>
        </DialogPortal>
      </Dialog>
    </main>
  );
}
