import {
  Collapsible,
  CollapsibleChevron,
  CollapsiblePanel,
  CollapsibleTrigger,
  cn,
} from "@shift/ui";
import type { ReactNode } from "react";
import { SidebarActionSlot } from "./SidebarActionRow";
import { SidebarRowButton } from "./SidebarRowButton";

export interface CollapsibleSectionProps {
  title: string;
  defaultOpen?: boolean;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  isActive?: boolean;
  className?: string;
  actions?: ReactNode;
  children: ReactNode;
}

export const CollapsibleSection = ({
  title,
  defaultOpen,
  open,
  onOpenChange,
  isActive,
  className,
  actions,
  children,
}: CollapsibleSectionProps) => (
  <Collapsible
    defaultOpen={defaultOpen}
    open={open}
    onOpenChange={onOpenChange}
    className={cn("flex flex-col", className)}
  >
    <div
      className="group sticky top-0 z-10 isolate grid grid-cols-[minmax(0,1fr)_auto] items-center rounded bg-surface before:pointer-events-none before:absolute before:inset-0 before:-z-10 before:rounded before:bg-transparent before:content-[''] hover:before:bg-hover data-[active]:before:bg-hover"
      data-active={isActive ? true : undefined}
    >
      <CollapsibleTrigger
        render={<SidebarRowButton variant="transparent" className="w-auto flex-1" />}
      >
        <CollapsibleChevron />
        <h3 className="truncate text-ui font-medium text-primary">{title}</h3>
      </CollapsibleTrigger>
      {actions && <SidebarActionSlot isVisible={isActive}>{actions}</SidebarActionSlot>}
    </div>
    {children && <CollapsiblePanel className="pt-2">{children}</CollapsiblePanel>}
  </Collapsible>
);
