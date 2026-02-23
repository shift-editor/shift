import type { GlyphCategory } from "@shift/glyph-info";
import { Button } from "@shift/ui";
import { CategoryIcon } from "./CategoryIcon";
import ChevronRightIcon from "@/assets/chevron-right.svg";

export interface CategoryProps {
  category: GlyphCategory;
  selectedCategory: GlyphCategory | null;
  onSelectCategory: (category: GlyphCategory) => void;
}
export const Category = ({ category, selectedCategory, onSelectCategory }: CategoryProps) => {
  const isActive = selectedCategory === category;
  return (
    <Button
      className="w-full justify-between"
      variant="ghost"
      size="sm"
      onClick={() => onSelectCategory(category)}
      data-active={isActive}
    >
      <div className="flex items-center gap-0.5">
        <ChevronRightIcon
          className={
            "w-3 h-3 transition-transform duration-175 group-data-[panel-open]:rotate-90 group-data-[panel-closed]:rotate-0"
          }
        />
        <div className="flex items-center gap-1">
          <CategoryIcon category={category} />
          <span className="text-sm">{category}</span>
        </div>
      </div>
    </Button>
  );
};
