import {
  Button,
  cn,
  Collapsible,
  CollapsiblePanel,
  CollapsibleTrigger,
  Input,
  Search,
} from "@shift/ui";
import AllIcon from "@/assets/sidebar-left/all.svg";
import { useGlyphCatalog } from "@/context/GlyphCatalogContext";
import { Category } from "./Category";
import { SubCategory } from "./SubCategory";

export const GlyphCatalog = () => {
  const {
    availableGlyphs,
    filteredGlyphs,
    categories,
    query,
    selectedCategory,
    selectedSubCategoryKey,
    setQuery,
    selectAll,
    selectCategory,
    selectSubCategory,
  } = useGlyphCatalog();

  const isTopLevelCategorySelected = selectedCategory !== null && selectedSubCategoryKey === null;

  return (
    <div className="flex min-h-0 flex-col gap-2">
      <Input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search glyphs..."
        className="h-8 text-sm bg-input"
        icon={<Search className="w-3 h-3 text-muted" />}
        iconPosition="left"
      />
      <div className="flex-1 overflow-y-auto scrollbar-hidden">
        <div className="flex items-center justify-between font-sans mb-2">
          <span className="text-ui font-medium text-primary">Glyphs</span>
          <span className="text-xs">{`${filteredGlyphs.length}/${availableGlyphs.length}`}</span>
        </div>

        <div className="w-full">
          <Button
            className="w-full justify-start"
            variant="ghost"
            size="sm"
            onClick={selectAll}
            isActive={selectedCategory === null && selectedSubCategoryKey === null}
          >
            <AllIcon className="w-4 h-4" />
            <span className="text-sm">All</span>
          </Button>
        </div>

        {categories.map((categoryNode) => (
          <div
            key={categoryNode.category}
            className={cn(
              "mt-1",
              isTopLevelCategorySelected && selectedCategory === categoryNode.category
                ? "bg-hover/50 rounded-sm"
                : null,
            )}
          >
            <Collapsible>
              <CollapsibleTrigger render={<div className="w-full" />}>
                <Category
                  category={categoryNode.category}
                  selectedCategory={selectedCategory}
                  onSelectCategory={selectCategory}
                />
              </CollapsibleTrigger>
              <CollapsiblePanel>
                <div>
                  {categoryNode.subCategories.map((subCategory) => (
                    <SubCategory
                      key={subCategory.key}
                      category={categoryNode.category}
                      subCategory={subCategory.label}
                      selectedCategory={selectedCategory}
                      selectedSubCategoryKey={selectedSubCategoryKey}
                      onSelectSubCategory={selectSubCategory}
                    />
                  ))}
                </div>
              </CollapsiblePanel>
            </Collapsible>
          </div>
        ))}
      </div>
    </div>
  );
};
