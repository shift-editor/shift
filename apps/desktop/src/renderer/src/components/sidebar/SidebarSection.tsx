interface SidebarSectionProps {
  title: string;
  children: React.ReactNode;
}

export const SidebarSection = ({ title, children }: SidebarSectionProps) => {
  return (
    <section className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <h3 className="text-[9px] font-medium text-muted uppercase tracking-wide">
          {title}
        </h3>
        <div className="flex-1 h-px bg-line-subtle" />
      </div>
      <div className="flex flex-col gap-2">{children}</div>
    </section>
  );
};
