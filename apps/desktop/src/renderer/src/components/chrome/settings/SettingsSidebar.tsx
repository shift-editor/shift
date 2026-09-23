import { SidebarRowButton } from "@/components/sidebar";
import AxesIcon from "@assets/settings/axes.svg";
import FontIcon from "@assets/settings/font.svg";
import InstancesIcon from "@assets/settings/instances.svg";
import SourcesIcon from "@assets/settings/sources.svg";
import type { SVG } from "@/types/common";
import type { SettingsCategory } from "@/types/settings";

interface SettingsSidebarProps {
  category: SettingsCategory;
  onCategoryChange: (category: SettingsCategory) => void;
}

const categories: { id: SettingsCategory; label: string; icon: SVG }[] = [
  { id: "font", label: "Font", icon: FontIcon },
  { id: "sources", label: "Sources", icon: SourcesIcon },
  { id: "instances", label: "Instances", icon: InstancesIcon },
  { id: "axes", label: "Axes", icon: AxesIcon },
];

export const SettingsSidebar = ({ category, onCategoryChange }: SettingsSidebarProps) => (
  <nav
    aria-label="Settings categories"
    className="flex min-h-0 flex-col gap-1 border-r border-line-subtle bg-white p-2"
  >
    {categories.map((item) => {
      const Icon = item.icon;
      const active = item.id === category;

      return (
        <SidebarRowButton key={item.id} isActive={active} onClick={() => onCategoryChange(item.id)}>
          <Icon className="h-3 w-3 shrink-0" />
          {item.label}
        </SidebarRowButton>
      );
    })}
  </nav>
);
