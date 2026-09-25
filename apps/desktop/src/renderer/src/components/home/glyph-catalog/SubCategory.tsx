import type { GlyphCategory } from "@shift/glyph-info";
import { SidebarRowButton } from "@/components/sidebar";

export interface SubCategoryProps {
  category: GlyphCategory;
  subCategory: string;
  selectedCategory: GlyphCategory | null;
  selectedSubCategoryKey: string | null;
  onSelectSubCategory: (category: GlyphCategory, subCategoryKey: string) => void;
}
export const SubCategory = ({
  category,
  subCategory,
  selectedCategory,
  selectedSubCategoryKey,
  onSelectSubCategory,
}: SubCategoryProps) => {
  const isActive = selectedCategory === category && selectedSubCategoryKey === subCategory;

  return (
    <SidebarRowButton
      key={`${category}:${subCategory}`}
      className="pl-7"
      onClick={() => onSelectSubCategory(category, subCategory)}
      isActive={isActive}
    >
      <span className="truncate">{subCategory}</span>
    </SidebarRowButton>
  );
};
