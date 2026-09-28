import type { ReactNode } from "react";
import { Collapsible, CollapsiblePanel, CollapsibleTrigger } from "@shift/ui";
import ChevronRightIcon from "@/assets/general/chevron-right.svg";
import { SidebarRowButton } from "@/components/sidebar";

export interface CatalogSectionProps {
  title: string;
  actions?: ReactNode;
  children: ReactNode;
}

export const CatalogSection = ({ title, actions, children }: CatalogSectionProps) => (
  <Collapsible defaultOpen className="mt-2 flex flex-col">
    <div className="flex items-center">
      <CollapsibleTrigger
        render={<SidebarRowButton variant="transparent" className="w-auto flex-1" />}
      >
        <span className="flex min-w-0 items-center gap-1 text-xs font-medium text-muted">
          <span className="truncate">{title}</span>
          <ChevronRightIcon className="h-3 w-3 shrink-0 opacity-0 transition duration-175 group-hover:opacity-100 group-focus-visible:opacity-100 group-data-[panel-open]:rotate-90" />
        </span>
      </CollapsibleTrigger>
      {actions}
    </div>
    <CollapsiblePanel>
      <div className="flex flex-col gap-1">{children}</div>
    </CollapsiblePanel>
  </Collapsible>
);
