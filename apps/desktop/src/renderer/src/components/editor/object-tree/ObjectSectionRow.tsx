import type { ReactNode } from "react";
import { cn } from "@shift/ui";
import type { CollapsibleSectionProps } from "@/components/sidebar";
import { CollapsibleSection } from "@/components/sidebar";

export const ObjectSectionRow = ({ children, ...props }: CollapsibleSectionProps) => (
  <CollapsibleSection {...props}>
    {children ? <GuideTrack>{children}</GuideTrack> : null}
  </CollapsibleSection>
);

/** Indents a section's contents behind the guide line its chevron starts. */
export const GuideTrack = ({ children }: { children: ReactNode }) => (
  <div className="relative pl-6">
    <span aria-hidden className="absolute -top-2 bottom-0 left-3.5 border-l border-line-subtle" />
    {children}
  </div>
);

/**
 * The guide line a child row draws at its start, under its parent row's chevron,
 * so a parent and its children read as one block, as in the object tree.
 */
export const GuideSlot = ({ className }: { className?: string }) => (
  <span
    aria-hidden
    className={cn("-my-0.5 h-8 w-3.5 shrink-0 border-r border-line-subtle", className)}
  />
);
