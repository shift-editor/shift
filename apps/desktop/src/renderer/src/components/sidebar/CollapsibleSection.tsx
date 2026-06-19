import {
  Button,
  Collapsible,
  CollapsibleChevron,
  CollapsiblePanel,
  CollapsibleTrigger,
  cn,
} from "@shift/ui";
import type { ReactNode } from "react";

export interface CollapsibleSectionProps {
  title: string;
  defaultOpen?: boolean;
  className?: string;
  actions?: ReactNode;
  children: ReactNode;
}

export const CollapsibleSection = ({
  title,
  defaultOpen,
  className,
  actions,
  children,
}: CollapsibleSectionProps) => (
  <Collapsible defaultOpen={defaultOpen} className={cn("flex flex-col", className)}>
    <div className="group flex items-center gap-1 rounded transition-colors hover:bg-hover/50">
      <CollapsibleTrigger
        render={
          <Button
            variant="ghost"
            size="sm"
            className="min-w-0 flex-1 justify-start gap-1 bg-transparent hover:bg-transparent data-[active]:bg-transparent"
          />
        }
      >
        <CollapsibleChevron />
        <h3 className="truncate text-ui font-medium text-[#232323]">{title}</h3>
      </CollapsibleTrigger>
      {actions && (
        <div className="flex items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
          {actions}
        </div>
      )}
    </div>
    <CollapsiblePanel className="px-2 pt-2">{children}</CollapsiblePanel>
  </Collapsible>
);
