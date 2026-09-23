import {
  Button,
  cn,
  Collapsible,
  CollapsiblePanel,
  CollapsibleTrigger,
  Input,
  Search,
  Separator,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@shift/ui";

import AllIcon from "@/assets/sidebar-left/all.svg";
import PlusIcon from "@/assets/general/plus.svg";

import { SidebarRowButton } from "@/components/sidebar";
import { useGlyphCatalog } from "@/context/GlyphCatalogContext";
import { Category } from "./Category";
import { SubCategory } from "./SubCategory";

export const GlyphCatalogView = () => {
  const {
    availableGlyphs: allGlyphs,
    filteredGlyphs,
    categories,
    query,
    selectedCategory,
    selectedSubCategoryKey,
    setQuery,
    createQuickGlyph,
    canAuthor,
    selectAll,
    selectCategory,
    selectSubCategory,
  } = useGlyphCatalog();

  const allGlyphCount = allGlyphs.length;
  const filteredGlyphCount = filteredGlyphs.length;
  const allGlyphsSelected = selectedCategory === null && selectedSubCategoryKey === null;
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
      <Separator className="-mx-3 w-auto" />

      <div className="flex-1 overflow-y-auto scrollbar-hidden">
        <div className="flex items-center justify-between font-sans mb-2">
          <span className="text-ui font-medium text-primary">Glyphs</span>
          <Tooltip>
            <TooltipTrigger>
              <Button
                variant="ghost"
                size="sm"
                aria-label="Create glyph"
                aria-disabled={!canAuthor || undefined}
                onClick={canAuthor ? createQuickGlyph : undefined}
              >
                <PlusIcon className="w-3 h-3 text-muted" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Create glyph</TooltipContent>
          </Tooltip>
        </div>

        <div className="flex flex-col gap-1">
          <SidebarRowButton onClick={selectAll} isActive={allGlyphsSelected}>
            <AllIcon className="h-3 w-3 shrink-0" />
            <span className="min-w-0 flex-1 truncate text-left">All</span>
            <span className="text-xs">{`${filteredGlyphCount}/${allGlyphCount}`}</span>
          </SidebarRowButton>

          {categories.map((categoryNode) => {
            const active = isTopLevelCategorySelected && selectedCategory === categoryNode.category;

            return (
              <div key={categoryNode.category} className={cn(active && "rounded bg-hover/50")}>
                <Collapsible className="flex flex-col gap-1">
                  <CollapsibleTrigger
                    render={
                      <SidebarRowButton
                        isActive={active}
                        onClick={() => selectCategory(categoryNode.category)}
                      />
                    }
                  >
                    <Category category={categoryNode.category} />
                  </CollapsibleTrigger>
                  <CollapsiblePanel>
                    <div className="flex flex-col gap-1">
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
            );
          })}
        </div>
      </div>
    </div>
  );
};
