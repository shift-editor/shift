import {
  Button,
  Collapsible,
  CollapsibleChevron,
  CollapsiblePanel,
  CollapsibleTrigger,
  cn,
} from "@shift/ui";

export interface CollapsibleSectionProps {
  title: string;
  defaultOpen?: boolean;
  className?: string;
  children: React.ReactNode;
}

export const CollapsibleSection = ({
  title,
  defaultOpen,
  className,
  children,
}: CollapsibleSectionProps) => (
  <Collapsible defaultOpen={defaultOpen} className={cn("flex flex-col", className)}>
    <CollapsibleTrigger
      render={<Button variant="ghost" size="sm" className="w-full justify-start gap-1" />}
    >
      <CollapsibleChevron />
      <h3 className="text-ui font-medium text-[#232323]">{title}</h3>
    </CollapsibleTrigger>
    <CollapsiblePanel className="px-2 pt-2">{children}</CollapsiblePanel>
  </Collapsible>
);
