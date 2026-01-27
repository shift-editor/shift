interface SidebarSectionProps {
  title: string;
  children: React.ReactNode;
}

export const SidebarSection = ({ title, children }: SidebarSectionProps) => {
  return (
    <section className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <h3 className="text-ui font-medium text-primary">{title}</h3>
      </div>
      <div className="flex flex-col gap-2">{children}</div>
    </section>
  );
};
