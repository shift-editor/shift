import { useMemo, useState } from "react";
import { GlyphGrid } from "@/components/GlyphGrid";
import { GlyphGridSidebar, type GlyphCategoryNode } from "@/components/GlyphGridSidebar";
import { Sidebar } from "@/components/sidebar";
import { Toolbar } from "@/components/Toolbar";
import { useSignalState } from "@/lib/reactive";
import { glyphDataStore } from "@/store/GlyphDataStore";
import { getGlyphInfo } from "@/store/glyphInfo";
import { ADOBE_LATIN_1 } from "@data/adobe-latin-1";

const UNCATEGORIZED_CATEGORY = "Uncategorized";
const NULL_SUBCATEGORY_KEY = "__null_subcategory__";
const GENERAL_SUBCATEGORY_LABEL = "General";

type GlyphMetadata = {
  category: string;
  subCategory: string | null;
};

type GlyphFilterIndexes = {
  availableSet: Set<number>;
  availableOrder: Map<number, number>;
  byCategory: Map<string, number[]>;
  bySubCategory: Map<string, number[]>;
};

function buildGlyphMetadataByCodepoint(
  unicodes: number[],
  glyphInfo: ReturnType<typeof getGlyphInfo>,
) {
  const metadata = new Map<number, GlyphMetadata>();
  for (const codepoint of unicodes) {
    const glyphData = glyphInfo.getGlyphData(codepoint);
    metadata.set(codepoint, {
      category: glyphData?.category ?? UNCATEGORIZED_CATEGORY,
      subCategory: glyphData?.subCategory ?? null,
    });
  }
  return metadata;
}

function buildCategories(
  unicodes: number[],
  metadataByCodepoint: Map<number, GlyphMetadata>,
): GlyphCategoryNode[] {
  const categoryMap = new Map<
    string,
    { count: number; subCategoryCounts: Map<string, { label: string; count: number }> }
  >();

  for (const codepoint of unicodes) {
    const metadata = metadataByCodepoint.get(codepoint);
    if (!metadata) continue;

    const subCategoryKey = metadata.subCategory ?? NULL_SUBCATEGORY_KEY;
    const subCategoryLabel = metadata.subCategory ?? GENERAL_SUBCATEGORY_LABEL;

    if (!categoryMap.has(metadata.category)) {
      categoryMap.set(metadata.category, { count: 0, subCategoryCounts: new Map() });
    }

    const categoryBucket = categoryMap.get(metadata.category)!;
    categoryBucket.count += 1;

    const subCategoryBucket = categoryBucket.subCategoryCounts.get(subCategoryKey);
    if (subCategoryBucket) {
      subCategoryBucket.count += 1;
    } else {
      categoryBucket.subCategoryCounts.set(subCategoryKey, {
        label: subCategoryLabel,
        count: 1,
      });
    }
  }

  return Array.from(categoryMap.entries())
    .map(([category, { count, subCategoryCounts }]) => ({
      category,
      count,
      subCategories: Array.from(subCategoryCounts.entries())
        .map(([key, { label, count }]) => ({ key, label, count }))
        .sort((a, b) => a.label.localeCompare(b.label)),
    }))
    .sort((a, b) => a.category.localeCompare(b.category));
}

function subCategoryLookupKey(category: string, subCategoryKey: string) {
  return `${category}::${subCategoryKey}`;
}

function buildGlyphFilterIndexes(
  unicodes: number[],
  metadataByCodepoint: Map<number, GlyphMetadata>,
) {
  const availableSet = new Set<number>();
  const availableOrder = new Map<number, number>();
  const byCategory = new Map<string, number[]>();
  const bySubCategory = new Map<string, number[]>();

  for (const [index, codepoint] of unicodes.entries()) {
    const metadata = metadataByCodepoint.get(codepoint);
    if (!metadata) continue;

    availableSet.add(codepoint);
    availableOrder.set(codepoint, index);

    if (!byCategory.has(metadata.category)) {
      byCategory.set(metadata.category, []);
    }
    byCategory.get(metadata.category)!.push(codepoint);

    const subCategoryKey = metadata.subCategory ?? NULL_SUBCATEGORY_KEY;
    const lookupKey = subCategoryLookupKey(metadata.category, subCategoryKey);
    if (!bySubCategory.has(lookupKey)) {
      bySubCategory.set(lookupKey, []);
    }
    bySubCategory.get(lookupKey)!.push(codepoint);
  }

  return { availableSet, availableOrder, byCategory, bySubCategory } satisfies GlyphFilterIndexes;
}

export const Home = () => {
  const glyphInfo = getGlyphInfo();
  const fontLoaded = useSignalState(glyphDataStore.fontLoaded);
  const fontUnicodes = useSignalState(glyphDataStore.fontUnicodes);
  const [query, setQuery] = useState("");
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [selectedSubCategoryKey, setSelectedSubCategoryKey] = useState<string | null>(null);

  const availableUnicodes = useMemo(
    () =>
      fontLoaded ? fontUnicodes : Object.values(ADOBE_LATIN_1).map((g) => parseInt(g.unicode, 16)),
    [fontLoaded, fontUnicodes],
  );

  const glyphMetadataByCodepoint = useMemo(
    () => buildGlyphMetadataByCodepoint(availableUnicodes, glyphInfo),
    [availableUnicodes, glyphInfo],
  );

  const categories = useMemo(
    () => buildCategories(availableUnicodes, glyphMetadataByCodepoint),
    [availableUnicodes, glyphMetadataByCodepoint],
  );
  const glyphFilterIndexes = useMemo(
    () => buildGlyphFilterIndexes(availableUnicodes, glyphMetadataByCodepoint),
    [availableUnicodes, glyphMetadataByCodepoint],
  );

  const searchMatches = useMemo(() => {
    const trimmedQuery = query.trim();
    if (!trimmedQuery) return null;
    const searchLimit = Math.max(availableUnicodes.length, 200);
    return new Set(glyphInfo.search(trimmedQuery, searchLimit).map((result) => result.codepoint));
  }, [availableUnicodes.length, glyphInfo, query]);

  const filteredUnicodes = useMemo(() => {
    if (selectedSubCategoryKey !== null && selectedCategory === null) {
      return [];
    }

    const hasCategoryFilter = selectedCategory !== null;
    const hasSubCategoryFilter = selectedCategory !== null && selectedSubCategoryKey !== null;

    let candidates = availableUnicodes;
    if (hasSubCategoryFilter) {
      candidates =
        glyphFilterIndexes.bySubCategory.get(
          subCategoryLookupKey(selectedCategory, selectedSubCategoryKey),
        ) ?? [];
    } else if (hasCategoryFilter) {
      candidates = glyphFilterIndexes.byCategory.get(selectedCategory) ?? [];
    }

    if (searchMatches === null) {
      return candidates;
    }

    if (!hasCategoryFilter && selectedSubCategoryKey === null) {
      const orderedMatches: number[] = [];
      for (const codepoint of searchMatches) {
        if (glyphFilterIndexes.availableSet.has(codepoint)) {
          orderedMatches.push(codepoint);
        }
      }
      orderedMatches.sort(
        (a, b) =>
          (glyphFilterIndexes.availableOrder.get(a) ?? Number.MAX_SAFE_INTEGER) -
          (glyphFilterIndexes.availableOrder.get(b) ?? Number.MAX_SAFE_INTEGER),
      );
      return orderedMatches;
    }

    return candidates.filter((codepoint) => searchMatches.has(codepoint));
  }, [
    availableUnicodes,
    glyphFilterIndexes,
    searchMatches,
    selectedCategory,
    selectedSubCategoryKey,
  ]);

  return (
    <main className="grid h-screen w-full grid-rows-[auto_minmax(0,1fr)]">
      <Toolbar />
      <section className="flex min-h-0 overflow-hidden">
        <GlyphGridSidebar
          query={query}
          onQueryChange={setQuery}
          categories={categories}
          selectedCategory={selectedCategory}
          selectedSubCategoryKey={selectedSubCategoryKey}
          totalCount={availableUnicodes.length}
          filteredCount={filteredUnicodes.length}
          onSelectAll={() => {
            setSelectedCategory(null);
            setSelectedSubCategoryKey(null);
          }}
          onSelectCategory={(category) => {
            setSelectedCategory(category);
            setSelectedSubCategoryKey(null);
          }}
          onSelectSubCategory={(category, subCategoryKey) => {
            setSelectedCategory(category);
            setSelectedSubCategoryKey(subCategoryKey);
          }}
        />
        <div className="min-h-0 min-w-0 flex-1">
          <GlyphGrid unicodes={filteredUnicodes} />
        </div>
        <Sidebar />
      </section>
    </main>
  );
};
