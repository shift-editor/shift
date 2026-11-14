import { message } from "@shared/messages";
import { SidebarRowButton } from "@/components/sidebar";
import StaticIcon from "@assets/export/export-static.svg";
import UfoIcon from "@assets/export/export-ufo.svg";
import VariableIcon from "@assets/export/export-variable.svg";
import type { SVG } from "@/types/common";
import type { ExportTarget } from "@/types/export";

interface ExportSidebarProps {
  target: ExportTarget;
  onTargetChange: (target: ExportTarget) => void;
}

interface TargetGroup {
  label: string;
  targets: readonly { id: ExportTarget; icon: SVG }[];
}

const groups: readonly TargetGroup[] = [
  {
    label: message("export.sidebar.fonts"),
    targets: [
      { id: "variable", icon: VariableIcon },
      { id: "static", icon: StaticIcon },
    ],
  },
  {
    label: message("export.sidebar.editable"),
    targets: [{ id: "ufo", icon: UfoIcon }],
  },
];

/** The Export dialog's target list, grouped into binary fonts and editable sources. */
export const ExportSidebar = ({ target, onTargetChange }: ExportSidebarProps) => (
  <nav
    aria-label={message("export.sidebar.label")}
    className="flex min-h-0 flex-col gap-4 border-r border-line-subtle bg-surface p-2"
  >
    {groups.map((group) => (
      <div key={group.label} className="flex flex-col gap-1">
        <h3 className="px-2 pb-1 pt-2 text-ui text-muted">{group.label}</h3>
        {group.targets.map((item) => {
          const Icon = item.icon;
          return (
            <SidebarRowButton
              key={item.id}
              isActive={item.id === target}
              onClick={() => onTargetChange(item.id)}
            >
              <Icon className="h-4 w-4 shrink-0 text-primary" />
              {exportTargetName(item.id)}
            </SidebarRowButton>
          );
        })}
      </div>
    ))}
  </nav>
);

/** The name the dialog shows for `target`, in the sidebar and as the pane title. */
export function exportTargetName(target: ExportTarget): string {
  switch (target) {
    case "variable":
      return message("export.target.variable");
    case "static":
      return message("export.target.static");
    case "ufo":
      return message("export.target.ufo");
  }
}
