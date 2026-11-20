interface SidebarRowProps {
  readonly label: string;
  readonly children: React.ReactNode;
}

/** A setting's label, and its control at the row's end. */
export const SidebarRow = ({ label, children }: SidebarRowProps) => (
  <div className="flex h-6 items-center justify-between gap-4 text-ui">
    <span className="shrink-0 text-secondary">{label}</span>
    {children}
  </div>
);
