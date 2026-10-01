import type { GlyphCategory } from "@shift/glyph-info";
import { CategoryIcon } from "./CategoryIcon";
import ChevronRightIcon from "@/assets/general/chevron-right.svg";

export interface CategoryProps {
  category: GlyphCategory;
}

export const Category = ({ category }: CategoryProps) => (
  <div className="flex min-w-0 items-center gap-1">
    <ChevronRightIcon className="h-3 w-3 shrink-0 transition-transform duration-175 group-data-[panel-open]:rotate-90 group-data-[panel-closed]:rotate-0" />
    <CategoryIcon category={category} />
    <span className="truncate">{category}</span>
  </div>
);
