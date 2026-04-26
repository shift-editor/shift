import type { GlyphCategory } from "@shift/glyph-info";
import {
  Button,
  Collapsible,
  CollapsiblePanel,
  CollapsibleTrigger,
  Input,
  Search,
  Separator,
} from "@shift/ui";
import AllIcon from "@/assets/sidebar-left/all.svg";
import { Category } from "./Category";
import { SubCategory } from "./SubCategory";

export interface GlyphSubCategoryNode {
  key: string;
  label: string;
  count: number;
}

export interface GlyphCategoryNode {
  category: GlyphCategory;
  count: number;
  subCategories: GlyphSubCategoryNode[];
}

export interface GlyphCatalogProps {
  query: {
    query: string;
    onQueryChange: (nextQuery: string) => void;
  };
  categories: {
    collection: GlyphCategoryNode[];
    selectedCategory: GlyphCategory | null;
    selectedSubCategoryKey: string | null;
  };
  counts: {
    totalCount: number;
    filteredCount: number;
  };
  select: {
    onSelectAll: () => void;
    onSelectCategory: (category: GlyphCategory) => void;
    onSelectSubCategory: (category: GlyphCategory, subCategoryKey: string) => void;
  };
}

export const GlyphCatalog = ({ query, categories, counts, select }: GlyphCatalogProps) => (
  <div className="flex min-h-0 flex-1 flex-col">
    <div className="px-3 py-2">
      <Input
        value={query.query}
        onChange={(e) => query.onQueryChange(e.target.value)}
        placeholder="Search glyphs..."
        className="h-8 text-sm bg-input"
        icon={<Search className="w-3 h-3 text-muted" />}
        iconPosition="left"
      />
    </div>
    <Separator />
    <div className="flex-1 overflow-y-auto px-2 py-2">
      <div className="flex items-center justify-between font-sans mb-2">
        <span className="text-sm">Glyphs</span>
        <span className="text-xs">{`${counts.filteredCount}/${counts.totalCount}`}</span>
      </div>

      <div className="w-full">
        <Button
          className="w-full justify-start"
          variant="ghost"
          size="sm"
          onClick={select.onSelectAll}
          data-active={
            categories.selectedCategory === null && categories.selectedSubCategoryKey === null
          }
        >
          <AllIcon className="w-4 h-4" />
          <span className="text-sm">All</span>
        </Button>
      </div>

      {categories.collection.map((categoryNode) => (
        <div key={categoryNode.category} className="mt-1">
          <Collapsible>
            <CollapsibleTrigger className="w-full">
              <Category
                category={categoryNode.category}
                selectedCategory={categories.selectedCategory}
                onSelectCategory={select.onSelectCategory}
              />
            </CollapsibleTrigger>
            <CollapsiblePanel>
              <div className="ml-3">
                {categoryNode.subCategories.map((subCategory) => (
                  <SubCategory
                    key={subCategory.key}
                    category={categoryNode.category}
                    subCategory={subCategory.label}
                    selectedCategory={categories.selectedCategory}
                    selectedSubCategoryKey={categories.selectedSubCategoryKey}
                    onSelectSubCategory={select.onSelectSubCategory}
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
