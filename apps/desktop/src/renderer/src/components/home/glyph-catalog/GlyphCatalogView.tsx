import { useMemo, useState } from "react";
import type { GlyphCategory } from "@shift/glyph-info";
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
import type { GlyphCategoryFilter } from "@/types/glyphCatalog";
import { useGlyphCatalog } from "@/context/GlyphCatalogContext";
import { Category } from "./Category";
import { SubCategory } from "./SubCategory";

export const GlyphCatalogView = () => {
  const {
    availableGlyphs: allGlyphs,
    filteredGlyphs,
    categories,
    categoryFilters,
    query,
    setQuery,
    createQuickGlyph,
    canAuthor,
    selectAll,
    selectCategory,
    selectSubCategory,
  } = useGlyphCatalog();

  const [expandedCategories, setExpandedCategories] = useState<ReadonlySet<GlyphCategory>>(
    () => new Set(),
  );
  const visibleCategoryFilters = useMemo<readonly GlyphCategoryFilter[]>(
    () =>
      categories.flatMap((category) => [
        { category: category.category, subCategoryKey: null },
        ...(expandedCategories.has(category.category)
          ? category.subCategories.map((subCategory) => ({
              category: category.category,
              subCategoryKey: subCategory.key,
            }))
          : []),
      ]),
    [categories, expandedCategories],
  );
  const selectedFilterIndexes = useMemo(
    () =>
      new Set(
        visibleCategoryFilters.flatMap((filter, index) =>
          categoryFilters.some(
            (selected) =>
              selected.category === filter.category &&
              selected.subCategoryKey === filter.subCategoryKey,
          )
            ? [index]
            : [],
        ),
      ),
    [categoryFilters, visibleCategoryFilters],
  );
  const allGlyphCount = allGlyphs.length;
  const filteredGlyphCount = filteredGlyphs.length;
  const allGlyphsSelected = categoryFilters.length === 0;

  return (
    <div className="flex flex-col gap-2">
      <Input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search glyphs..."
        size="md"
        icon={<Search className="w-3 h-3 text-muted" />}
        iconPosition="left"
      />
      <Separator className="-mx-3 w-auto" />

      <div>
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
            <AllIcon className="h-4 w-4 shrink-0 text-primary" />
            <span className="min-w-0 flex-1 truncate text-left">All</span>
            <span className="text-xs">{`${filteredGlyphCount}/${allGlyphCount}`}</span>
          </SidebarRowButton>

          {categories.map((categoryNode) => {
            const filterIndex = visibleCategoryFilters.findIndex(
              (filter) =>
                filter.category === categoryNode.category && filter.subCategoryKey === null,
            );
            const active = selectedFilterIndexes.has(filterIndex);

            return (
              <div
                key={categoryNode.category}
                className={cn(
                  active &&
                    "relative isolate rounded bg-transparent before:pointer-events-none before:absolute before:inset-0 before:-z-10 before:rounded before:bg-hover/50 before:content-['']",
                  active &&
                    selectedFilterIndexes.has(filterIndex - 1) &&
                    "before:-top-1 before:rounded-t-none",
                  active && selectedFilterIndexes.has(filterIndex + 1) && "before:rounded-b-none",
                )}
              >
                <Collapsible
                  open={expandedCategories.has(categoryNode.category)}
                  onOpenChange={(open) => {
                    setExpandedCategories((previous) => {
                      const next = new Set(previous);
                      if (open) next.add(categoryNode.category);
                      else next.delete(categoryNode.category);
                      return next;
                    });
                  }}
                  className="flex flex-col"
                >
                  <CollapsibleTrigger
                    render={
                      <SidebarRowButton
                        aria-pressed={active}
                        onClick={(event) =>
                          selectCategory(
                            categoryNode.category,
                            event.shiftKey
                              ? "range"
                              : event.metaKey || event.ctrlKey
                                ? "toggle"
                                : "single",
                            visibleCategoryFilters,
                          )
                        }
                      />
                    }
                  >
                    <Category category={categoryNode.category} />
                  </CollapsibleTrigger>
                  <CollapsiblePanel>
                    <div className="flex flex-col gap-1 pt-1">
                      {categoryNode.subCategories.map((subCategory) => {
                        const subCategoryFilterIndex = visibleCategoryFilters.findIndex(
                          (filter) =>
                            filter.category === categoryNode.category &&
                            filter.subCategoryKey === subCategory.key,
                        );
                        const subCategoryActive = selectedFilterIndexes.has(subCategoryFilterIndex);

                        return (
                          <SubCategory
                            key={subCategory.key}
                            label={subCategory.label}
                            active={subCategoryActive}
                            joinsPrevious={
                              subCategoryActive &&
                              selectedFilterIndexes.has(subCategoryFilterIndex - 1)
                            }
                            joinsNext={
                              subCategoryActive &&
                              selectedFilterIndexes.has(subCategoryFilterIndex + 1)
                            }
                            onSelect={(mode) =>
                              selectSubCategory(
                                categoryNode.category,
                                subCategory.key,
                                mode,
                                visibleCategoryFilters,
                              )
                            }
                          />
                        );
                      })}
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
