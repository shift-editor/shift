import type { ListSelectionMode } from "@shift/editor/types";
import { SidebarActionRow } from "@/components/sidebar";

export interface SubCategoryProps {
  label: string;
  active: boolean;
  joinsPrevious: boolean;
  joinsNext: boolean;
  onSelect: (mode: ListSelectionMode) => void;
}

export const SubCategory = ({
  label,
  active,
  joinsPrevious,
  joinsNext,
  onSelect,
}: SubCategoryProps) => (
  <SidebarActionRow
    isSelected={active}
    joinsPrevious={joinsPrevious}
    joinsNext={joinsNext}
    onClick={(event) =>
      onSelect(event.shiftKey ? "range" : event.metaKey || event.ctrlKey ? "toggle" : "single")
    }
    contentClassName="pl-7"
  >
    <span className="truncate">{label}</span>
  </SidebarActionRow>
);
