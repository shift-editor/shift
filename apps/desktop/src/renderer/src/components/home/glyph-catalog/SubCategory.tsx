import type { ListSelectionMode } from "@shift/editor/types";
import { SidebarActionRow } from "@/components/sidebar";
import { listSelectionMode } from "@/hooks/useListSelection";

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
    onClick={(event) => onSelect(listSelectionMode(event))}
    contentClassName="pl-7"
  >
    <span className="truncate">{label}</span>
  </SidebarActionRow>
);
