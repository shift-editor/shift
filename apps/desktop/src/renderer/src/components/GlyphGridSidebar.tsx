import { useState } from "react";
import { Collapsible, CollapsiblePanel, CollapsibleTrigger, Input, Separator, cn } from "@shift/ui";

const UNCATEGORIZED_SUBCATEGORY = "General";

export interface GlyphSubCategoryNode {
  key: string;
  label: string;
  count: number;
}

export interface GlyphCategoryNode {
  category: string;
  count: number;
  subCategories: GlyphSubCategoryNode[];
}

interface GlyphGridSidebarProps {
  query: string;
  onQueryChange: (nextQuery: string) => void;
  categories: GlyphCategoryNode[];
  selectedCategory: string | null;
  selectedSubCategoryKey: string | null;
  totalCount: number;
  filteredCount: number;
  onSelectAll: () => void;
  onSelectCategory: (category: string) => void;
  onSelectSubCategory: (category: string, subCategoryKey: string) => void;
}

export const GlyphGridSidebar = ({
  query,
  onQueryChange,
  categories,
  selectedCategory,
  selectedSubCategoryKey,
  totalCount,
  filteredCount,
  onSelectAll,
  onSelectCategory,
  onSelectSubCategory,
}: GlyphGridSidebarProps) => {
  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(new Set());

  const toggleExpanded = (category: string, open: boolean) => {
    setExpandedCategories((prev) => {
      const next = new Set(prev);
      if (open) {
        next.add(category);
      } else {
        next.delete(category);
      }
      return next;
    });
  };

  return (
    <aside className="flex h-full w-[260px] flex-col border-r border-line-subtle bg-panel">
      <div className="flex items-center justify-between px-3 py-2">
        <span className="text-ui font-medium text-primary">Glyphs</span>
        <span className="text-[11px] text-muted">
          {filteredCount}/{totalCount}
        </span>
      </div>
      <Separator />
      <div className="px-3 py-2">
        <Input
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
          placeholder="Search glyphs..."
          className="h-8 text-xs"
        />
      </div>
      <Separator />
      <div className="flex-1 overflow-y-auto px-2 py-2">
        <button
          type="button"
          className={cn(
            "mb-1 flex w-full items-center justify-between rounded px-2 py-1 text-left text-xs",
            selectedCategory === null
              ? "bg-accent/10 font-medium text-accent"
              : "text-primary hover:bg-hover",
          )}
          onClick={onSelectAll}
        >
          <span>All glyphs</span>
          <span className="text-muted">{totalCount}</span>
        </button>

        {categories.map((categoryNode) => {
          const hasSubCategories = categoryNode.subCategories.length > 0;
          const isCategorySelected =
            selectedCategory === categoryNode.category && selectedSubCategoryKey === null;
          const isOpen = expandedCategories.has(categoryNode.category);

          if (!hasSubCategories) {
            return (
              <button
                key={categoryNode.category}
                type="button"
                className={cn(
                  "mb-1 flex w-full items-center justify-between rounded px-2 py-1 text-left text-xs",
                  isCategorySelected
                    ? "bg-accent/10 font-medium text-accent"
                    : "text-primary hover:bg-hover",
                )}
                onClick={() => onSelectCategory(categoryNode.category)}
              >
                <span>{categoryNode.category}</span>
                <span className="text-muted">{categoryNode.count}</span>
              </button>
            );
          }

          return (
            <Collapsible
              key={categoryNode.category}
              open={isOpen}
              onOpenChange={(open) => toggleExpanded(categoryNode.category, open)}
              className="mb-1"
            >
              <div className="flex items-center gap-1">
                <CollapsibleTrigger
                  aria-label={`Toggle ${categoryNode.category}`}
                  className="flex h-6 w-6 items-center justify-center rounded text-muted hover:bg-hover"
                >
                  <span
                    className={cn(
                      "inline-block text-[10px] transition-transform",
                      isOpen && "rotate-90",
                    )}
                  >
                    {">"}
                  </span>
                </CollapsibleTrigger>
                <button
                  type="button"
                  className={cn(
                    "flex flex-1 items-center justify-between rounded px-2 py-1 text-left text-xs",
                    isCategorySelected
                      ? "bg-accent/10 font-medium text-accent"
                      : "text-primary hover:bg-hover",
                  )}
                  onClick={() => onSelectCategory(categoryNode.category)}
                >
                  <span>{categoryNode.category}</span>
                  <span className="text-muted">{categoryNode.count}</span>
                </button>
              </div>

              <CollapsiblePanel className="ml-7 mt-0.5 flex flex-col gap-0.5">
                {categoryNode.subCategories.map((subCategory) => {
                  const isSubCategorySelected =
                    selectedCategory === categoryNode.category &&
                    selectedSubCategoryKey === subCategory.key;

                  return (
                    <button
                      key={`${categoryNode.category}:${subCategory.key}`}
                      type="button"
                      className={cn(
                        "flex w-full items-center justify-between rounded px-2 py-1 text-left text-xs",
                        isSubCategorySelected
                          ? "bg-accent/10 font-medium text-accent"
                          : "text-primary hover:bg-hover",
                      )}
                      onClick={() => onSelectSubCategory(categoryNode.category, subCategory.key)}
                    >
                      <span>{subCategory.label || UNCATEGORIZED_SUBCATEGORY}</span>
                      <span className="text-muted">{subCategory.count}</span>
                    </button>
                  );
                })}
              </CollapsiblePanel>
            </Collapsible>
          );
        })}
      </div>
    </aside>
  );
};
