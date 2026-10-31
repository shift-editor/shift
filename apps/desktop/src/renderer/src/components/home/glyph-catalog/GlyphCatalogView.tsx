import { useMemo, useState } from "react";
import {
  Button,
  cn,
  Collapsible,
  CollapsiblePanel,
  CollapsibleTrigger,
  Input,
  Search,
  Tooltip,
  X,
} from "@shift/ui";

import AllIcon from "@/assets/sidebar-left/all.svg";
import PlusIcon from "@/assets/general/plus.svg";

import { SidebarRowButton } from "@/components/sidebar";
import { useGlyphCatalog } from "@/context/GlyphCatalogContext";
import { listSelectionMode } from "@/hooks/useListSelection";
import { GuideTrack, ObjectSectionRow } from "@/components/editor/object-tree/ObjectSectionRow";
import { Category } from "./Category";
import { LanguagePicker } from "./LanguagePicker";
import { LanguageScript } from "./LanguageScript";
import { SubCategory } from "./SubCategory";

export const GlyphCatalogView = () => {
  const {
    availableGlyphs: allGlyphs,
    filteredGlyphs,
    categories,
    languageScripts,
    allLanguageScripts,
    trackedLanguageIds,
    setTrackedLanguageIds,
    languageGlyphs,
    generateGlyphs,
    categoryFilters,
    selectedLanguageId,
    visibleCategoryFilters,
    expandedCategories,
    setCategoryExpanded,
    query,
    setQuery,
    createQuickGlyph,
    canAuthor,
    selectAll,
    selectCategory,
    selectSubCategory,
    selectLanguage,
  } = useGlyphCatalog();
  // Opens with the field when a search survives a remount.
  const [searching, setSearching] = useState(query !== "");
  const [open, setOpen] = useState(true);
  const closeSearch = () => {
    setSearching(false);
    setQuery("");
  };

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
  const allGlyphsSelected = categoryFilters.length === 0 && selectedLanguageId === null;

  const contents = (
    <div className="flex flex-col gap-1">
      <SidebarRowButton onClick={selectAll} isActive={allGlyphsSelected}>
        <AllIcon className="h-4 w-4 shrink-0 text-primary" />
        <span className="min-w-0 flex-1 truncate text-left">All</span>
        <span className="text-xs">{`${filteredGlyphCount}/${allGlyphCount}`}</span>
      </SidebarRowButton>

      <ObjectSectionRow title="Categories" defaultOpen>
        <div className="flex flex-col gap-1">
          {categories.map((categoryNode) => {
            const filterIndex = visibleCategoryFilters.findIndex(
              (filter) =>
                filter.category === categoryNode.category && filter.subCategoryKey === null,
            );
            const active = selectedFilterIndexes.has(filterIndex);
            const open = expandedCategories.has(categoryNode.category);
            // A chosen category covers its subcategories, which highlight with it, as a
            // selected contour's points do in the object tree.
            const covered = categoryNode.subCategories.map(
              (subCategory) =>
                active ||
                selectedFilterIndexes.has(
                  visibleCategoryFilters.findIndex(
                    (filter) =>
                      filter.category === categoryNode.category &&
                      filter.subCategoryKey === subCategory.key,
                  ),
                ),
            );
            const coversChildren = open && covered.length > 0 && active;

            return (
              <div key={categoryNode.category}>
                <Collapsible
                  open={open}
                  onOpenChange={(open) => setCategoryExpanded(categoryNode.category, open)}
                  className="flex flex-col"
                >
                  <div
                    className={cn(
                      active &&
                        "relative isolate rounded bg-transparent before:pointer-events-none before:absolute before:inset-0 before:-z-10 before:rounded before:bg-hover/50 before:content-['']",
                      active &&
                        selectedFilterIndexes.has(filterIndex - 1) &&
                        "before:-top-1 before:rounded-t-none",
                      active &&
                        (coversChildren || selectedFilterIndexes.has(filterIndex + 1)) &&
                        "before:rounded-b-none",
                    )}
                  >
                    <CollapsibleTrigger
                      render={
                        <SidebarRowButton
                          aria-pressed={active}
                          onClick={(event) =>
                            selectCategory(categoryNode.category, listSelectionMode(event))
                          }
                        />
                      }
                    >
                      <Category category={categoryNode.category} />
                    </CollapsibleTrigger>
                  </div>
                  <CollapsiblePanel>
                    <div className="flex flex-col gap-1 pt-1">
                      {categoryNode.subCategories.map((subCategory, index) => {
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
                            active={covered[index] ?? subCategoryActive}
                            joinsPrevious={
                              (covered[index] ?? false) &&
                              (index === 0 ? active : (covered[index - 1] ?? false))
                            }
                            joinsNext={
                              (covered[index] ?? false) &&
                              (index < covered.length - 1
                                ? (covered[index + 1] ?? false)
                                : selectedFilterIndexes.has(subCategoryFilterIndex + 1))
                            }
                            onSelect={(mode) =>
                              selectSubCategory(categoryNode.category, subCategory.key, mode)
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
      </ObjectSectionRow>

      <ObjectSectionRow
        title="Languages"
        defaultOpen
        actions={
          <LanguagePicker
            scripts={allLanguageScripts}
            trackedLanguageIds={trackedLanguageIds}
            disabled={!canAuthor}
            onApply={setTrackedLanguageIds}
          />
        }
      >
        <div className="flex flex-col gap-1">
          {languageScripts.map((group) => (
            <LanguageScript
              key={group.script}
              group={group}
              selectedLanguageId={selectedLanguageId}
              canGenerate={canAuthor}
              onSelectLanguage={selectLanguage}
              languageGlyphs={languageGlyphs}
              onGenerate={generateGlyphs}
            />
          ))}
        </div>
      </ObjectSectionRow>
    </div>
  );

  // Searching swaps the Glyphs title for the field; the filters stay below it.
  if (searching) {
    return (
      <div className="flex flex-col">
        <div className="flex h-7 items-center gap-1">
          <GlyphSearchField query={query} onChange={setQuery} onClose={closeSearch} />
        </div>
        <div className="pt-2">
          <GuideTrack>{contents}</GuideTrack>
        </div>
      </div>
    );
  }

  return (
    <ObjectSectionRow
      title="Glyphs"
      open={open}
      onOpenChange={setOpen}
      actions={
        <div className="flex items-center">
          <Tooltip content="Search glyphs">
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Search glyphs"
              className="text-sidebar-icon"
              onClick={() => setSearching(true)}
            >
              <Search aria-hidden className="h-3.5 w-3.5" />
            </Button>
          </Tooltip>
          <Tooltip content="Create glyph">
            <Button
              variant="ghost"
              size="sm"
              aria-label="Create glyph"
              aria-disabled={!canAuthor || undefined}
              onClick={canAuthor ? createQuickGlyph : undefined}
            >
              <PlusIcon className="w-3 h-3 text-muted" />
            </Button>
          </Tooltip>
        </div>
      }
    >
      {contents}
    </ObjectSectionRow>
  );
};

/** The Glyphs title while searching: a search field, and a button closing it. */
const GlyphSearchField = ({
  query,
  onChange,
  onClose,
}: {
  query: string;
  onChange: (query: string) => void;
  /** Clears the search and shows the title row again. */
  onClose: () => void;
}) => (
  <>
    <div className="min-w-0 flex-1">
      <Input
        autoFocus
        aria-label="Search glyphs"
        placeholder="Search glyphs..."
        icon={<Search aria-hidden className="h-3 w-3 text-muted" />}
        iconPosition="left"
        value={query}
        onChange={(event) => onChange(event.currentTarget.value)}
        onKeyDown={(event) => {
          if (event.key === "Escape") onClose();
        }}
      />
    </div>
    <Tooltip content="Close search">
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label="Close search"
        className="shrink-0 text-sidebar-icon"
        onClick={onClose}
      >
        <X aria-hidden className="h-4 w-4" />
      </Button>
    </Tooltip>
  </>
);
