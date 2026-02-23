import { GlyphCategory } from "@shift/glyph-info";
import { Button } from "@shift/ui";

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
    <Button
      key={`${category}:${subCategory}`}
      className="w-full justify-between"
      variant="ghost"
      size="sm"
      onClick={() => onSelectSubCategory(category, subCategory)}
      data-active={isActive}
    >
      <span className="text-ui">{subCategory}</span>
    </Button>
  );
};
