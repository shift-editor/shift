import { PortalContainerProvider, TooltipProvider, cn } from "@shift/ui";
import { useState, type ReactNode } from "react";

export interface ShiftEditorRootProps {
  children: ReactNode;
  className?: string;
}

/**
 * Style scope for embedded editor UI.
 *
 * Menus and tooltips mount into a host element inside this root, so the SDK's
 * scoped stylesheet applies to them and nothing is portaled into the page body.
 */
export function ShiftEditorRoot({ children, className }: ShiftEditorRootProps) {
  const [portalContainer, setPortalContainer] = useState<HTMLDivElement | null>(null);

  return (
    <div className={cn("shift-editor-chrome", className)}>
      <TooltipProvider>
        <PortalContainerProvider container={portalContainer}>{children}</PortalContainerProvider>
      </TooltipProvider>
      <div ref={setPortalContainer} className="shift-editor-portal" />
    </div>
  );
}
