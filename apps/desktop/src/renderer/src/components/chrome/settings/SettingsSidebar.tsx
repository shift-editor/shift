import { Button, cn } from "@shift/ui";
import AxesIcon from "@assets/settings/axes.svg";
import FeaturesIcon from "@assets/settings/features.svg";
import FontIcon from "@assets/settings/font.svg";
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
  { id: "axes", label: "Axes", icon: AxesIcon },
  { id: "features", label: "Features", icon: FeaturesIcon },
];

export const SettingsSidebar = ({ category, onCategoryChange }: SettingsSidebarProps) => (
  <nav className="flex min-h-0 flex-col gap-0.5 border-r border-line-subtle bg-white p-2">
    {categories.map((item) => {
      const Icon = item.icon;
      const active = item.id === category;

      return (
        <Button
          key={item.id}
          type="button"
          variant="ghost"
          size="sm"
          isActive={active}
          className={cn(
            "h-8 w-full justify-start rounded-sm px-2 text-sm font-normal",
            active && "bg-hover hover:bg-hover data-[active]:bg-hover",
          )}
          onClick={() => onCategoryChange(item.id)}
        >
          <Icon className="h-4 w-4 shrink-0" />
          {item.label}
        </Button>
      );
    })}
  </nav>
);
