import { GlyphGrid } from "@/components/GlyphGrid";
import { GlyphGridSidebar } from "@/components/GlyphGridSidebar";
import { Sidebar } from "@/components/sidebar-right";
import { Toolbar } from "@/components/Toolbar";
import { useGlyphCatalog } from "@/hooks/useGlyphCatalog";

export const Home = () => {
  const {
    availableUnicodes,
    filteredUnicodes,
    categories,
    query,
    selectedCategory,
    selectedSubCategoryKey,
    setQuery,
    selectAll,
    selectCategory,
    selectSubCategory,
  } = useGlyphCatalog();

  const sideBarState = {
    query: { query, onQueryChange: setQuery },
    categories: { collection: categories, selectedCategory, selectedSubCategoryKey },
    counts: { totalCount: availableUnicodes.length, filteredCount: filteredUnicodes.length },
    select: {
      onSelectAll: selectAll,
      onSelectCategory: selectCategory,
      onSelectSubCategory: selectSubCategory,
    },
  };

  return (
    <main className="grid h-screen w-full grid-rows-[auto_minmax(0,1fr)]">
      <Toolbar />
      <section className="flex min-h-0 overflow-hidden">
        <GlyphGridSidebar {...sideBarState} />
        <div className="min-h-0 min-w-0 flex-1">
          <GlyphGrid unicodes={filteredUnicodes} />
        </div>
        <Sidebar />
      </section>
    </main>
  );
};
