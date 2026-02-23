import { cn } from "@shift/ui";

interface SidebarSectionProps {
  title: string;
  children: React.ReactNode;
  className?: string;
}

export const SidebarSection = ({ title, children, className }: SidebarSectionProps) => {
  return (
    <section className={cn("flex flex-col gap-2", className)}>
      <div className="flex items-center gap-2">
        <h3 className="text-ui font-medium  text-[#232323]">{title}</h3>
      </div>
      <div className="flex flex-col gap-2">{children}</div>
    </section>
  );
};
