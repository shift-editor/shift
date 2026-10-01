import type { CollapsibleSectionProps } from "@/components/sidebar";
import { CollapsibleSection } from "@/components/sidebar";

export const ObjectSectionRow = ({ children, ...props }: CollapsibleSectionProps) => (
  <CollapsibleSection {...props}>
    {children ? (
      <div className="relative pl-6">
        <span
          aria-hidden
          className="absolute -top-2 bottom-0 left-3.5 border-l border-line-subtle"
        />
        {children}
      </div>
    ) : null}
  </CollapsibleSection>
);
