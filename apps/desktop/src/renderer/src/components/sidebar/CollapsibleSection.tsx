import {
  Button,
  Collapsible,
  CollapsibleChevron,
  CollapsiblePanel,
  CollapsibleTrigger,
  cn,
} from "@shift/ui";
import type { ReactNode } from "react";
import { SidebarActionSlot } from "./SidebarActionRow";

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
    <div className="group grid grid-cols-[minmax(0,1fr)_1.5rem] items-center rounded transition-colors hover:bg-hover/50">
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
      {actions && <SidebarActionSlot>{actions}</SidebarActionSlot>}
    </div>
    <CollapsiblePanel className="pt-2">{children}</CollapsiblePanel>
  </Collapsible>
);
