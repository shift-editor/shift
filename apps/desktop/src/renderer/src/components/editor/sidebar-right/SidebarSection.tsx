import { cn } from "@shift/ui";

interface SidebarSectionProps {
  title: string;
  children: React.ReactNode;
  className?: string;
  /** Controls at the end of the title row, such as a button opening more settings. */
  actions?: React.ReactNode;
  /** Classes for the body, such as a wider gap between subsections. */
  contentClassName?: string;
  /** Replaces the title and actions, such as with a search field while searching. */
  header?: React.ReactNode;
}

export const SidebarSection = ({
  title,
  children,
  className,
  actions,
  contentClassName,
  header,
}: SidebarSectionProps) => {
  return (
    <section className={cn("flex flex-col gap-2", className)}>
      <div className={cn("flex items-center justify-between gap-2", (actions || header) && "h-6")}>
        {header ?? (
          <>
            <h3 className="text-ui font-medium text-primary">{title}</h3>
            {actions}
          </>
        )}
      </div>
      <div className={cn("flex flex-col gap-2", contentClassName)}>{children}</div>
    </section>
  );
};

interface SidebarSubsectionProps {
  title: string;
  children: React.ReactNode;
}

/** A labelled group of fields inside a section, like Transform's Align or Dimensions. */
export const SidebarSubsection = ({ title, children }: SidebarSubsectionProps) => (
  <div className="flex flex-col gap-2">
    <div className="text-ui text-secondary">{title}</div>
    {children}
  </div>
);
