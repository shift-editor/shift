import type {
  GlyphCategory,
  GlyphCategorySummary,
  LanguageScript,
  RequiredGlyph,
} from "@shift/glyph-info";
import type { Rect2D } from "@shift/geo";
import type { Axis } from "@shift/editor/model";
import type {
  CatalogMetrics,
  GlyphId,
  GlyphName,
  GlyphPreview,
  MarkColor,
  SourceId,
} from "@shift/types";
import type { ListSelectionMode, RenderGlyph } from "@shift/editor/types";
import type { ColorTheme } from "@/lib/themes";
import type { GlyphSelection } from "@/lib/glyph-grid/GlyphSelection";
import type { GlyphAtlasSource } from "./glyphAtlas";

export type GlyphCatalogCellArea = "preview" | "name";

export interface GlyphCatalogItem {
  readonly id: GlyphId;
  readonly name: GlyphName;
  readonly displayName: string;
  readonly unicode: number | null;
  /** The colour the glyph is tagged with, or null. */
  readonly markColor: MarkColor | null;
}

/** A glyph a language or script group requires, as the Missing Glyphs list shows it. */
export interface LanguageGlyph {
  readonly glyph: RequiredGlyph;
  /** Text that renders the glyph, joined when it is a positional form. */
  readonly preview: string;
  readonly present: boolean;
}

export type PendingGlyphNames = ReadonlyMap<GlyphId, GlyphName>;

export interface GlyphCategoryFilter {
  readonly category: GlyphCategory;
  readonly subCategoryKey: string | null;
}

/** What narrows a list of the font's glyphs: a search, categories, and a language. */
export interface GlyphFilter {
  /** Text a glyph's name or character must match; empty matches every glyph. */
  readonly query: string;
  /** The categories shown; empty shows every category. */
  readonly categoryFilters: readonly GlyphCategoryFilter[];
  /** The language or script group whose glyphs are shown; null shows every glyph. */
  readonly languageId: string | null;
}

/** Dense external-axis coordinates ordered like `GlyphCatalogSource.axesCell`. */
export type CatalogLocation = readonly number[];

export interface GlyphCatalogSource {
  availableGlyphs: GlyphCatalogItem[];
  filteredGlyphs: GlyphCatalogItem[];
  /**
   * The font's glyphs a filter shows, in font order: the one filter every
   * glyph list in the window uses, each with its own choices.
   */
  filterGlyphs: (filter: GlyphFilter) => GlyphCatalogItem[];
  categories: GlyphCategorySummary[];
  /** Tracked languages grouped by script, each with its script groups, as shown in the sidebar. */
  languageScripts: LanguageScript[];
  /** Every known language grouped by script, for choosing what to track. */
  allLanguageScripts: LanguageScript[];
  trackedLanguageIds: readonly string[];
  /** Replaces the font's tracked languages as one undoable edit. */
  setTrackedLanguageIds: (languageIds: readonly string[]) => void;
  /**
   * Lists every glyph a language or script group requires and whether the font has it.
   *
   * @param setId - a language id (`arb-arabic`) or script group id (`arabic/ligatures`).
   */
  languageGlyphs: (setId: string) => LanguageGlyph[];
  /**
   * Creates one empty glyph per required glyph as one undoable edit: encoded
   * glyphs at their Unicode value, unencoded forms such as `beh-ar.init` by name.
   */
  generateGlyphs: (glyphs: readonly RequiredGlyph[]) => void;
  categoryFilters: readonly GlyphCategoryFilter[];
  /** The language or script group filtering the grid; null when none is. */
  selectedLanguageId: string | null;
  visibleCategoryFilters: readonly GlyphCategoryFilter[];
  /**
   * The position of a category's filter, or one of its subcategories', in
   * {@link visibleCategoryFilters}; -1 when it is not shown.
   *
   * @param subCategoryKey - null for the category itself.
   */
  filterIndexOf: (category: GlyphCategory, subCategoryKey: string | null) => number;
  expandedCategories: ReadonlySet<GlyphCategory>;
  /** Expands or collapses one category in the sidebar. */
  setCategoryExpanded: (category: GlyphCategory, expanded: boolean) => void;
  query: string;
  setQuery: (nextQuery: string) => void;
  createQuickGlyph: () => GlyphName;
  selectAll: () => void;
  selectCategory: (category: GlyphCategory, mode: ListSelectionMode) => void;
  selectSubCategory: (
    category: GlyphCategory,
    subCategoryKey: string,
    mode: ListSelectionMode,
  ) => void;
  selectLanguage: (languageId: string) => void;
  atlasSource: GlyphAtlasSource;
  observeAtlasInvalidation: (
    listener: (glyphIds: readonly GlyphId[] | null, directory: readonly GlyphId[]) => void,
  ) => () => void;
  glyphPreviews: (
    glyphIds: readonly GlyphId[],
    location: CatalogLocation,
  ) => Promise<readonly GlyphPreview[]>;
  location: CatalogLocation;
  axes: readonly Axis[];
  metrics: CatalogMetrics;
  sourceId: SourceId | null;
  canAuthor: boolean;
  openedGlyph: RenderGlyph | null;
  /** Opens a glyph in a tab of its own: a double-click in the grid. */
  openGlyph: (glyph: GlyphCatalogItem) => Promise<void>;
  /**
   * Replaces the grid's selection without leaving the grid, and shows the
   * glyph the sidebar describes. The selection itself is the window's
   * (`WindowTabs.gridSelectionCell`), read where it is drawn.
   */
  selectGlyphs: (selection: GlyphSelection) => void;
}

export interface GlyphCatalogLayoutMetrics {
  readonly viewportWidth: number;
  readonly viewportHeight: number;
  readonly glyphCount: number;
  readonly columns: number;
  readonly rowCount: number;
  readonly cellWidth: number;
  readonly totalHeight: number;
  readonly viewportPadding: number;
  readonly gridInset: number;
  readonly gridLeft: number;
  readonly gridWidth: number;
  readonly columnGap: number;
  readonly rowPitch: number;
  readonly previewHeight: number;
  readonly previewContentInset: number;
  readonly nameGap: number;
  readonly nameHeight: number;
}

export interface GlyphCatalogCell {
  readonly catalogIndex: number;
  readonly glyph: GlyphCatalogItem;
  readonly cellRect: Rect2D;
  readonly previewRect: Rect2D;
  readonly previewContentRect: Rect2D;
  readonly nameRect: Rect2D;
}

export interface GlyphCatalogFrame {
  readonly layout: GlyphCatalogLayoutMetrics;
  readonly scrollTop: number;
  readonly cells: readonly GlyphCatalogCell[];
}

export type GridReadiness = "Initial" | "Stale" | "Complete" | "Unavailable";

/** Mutable catalog inputs requested by React for the latest authored revision. */
export interface GlyphCatalogControllerFrame {
  readonly glyphs: readonly GlyphCatalogItem[];
  readonly location: CatalogLocation;
  readonly metrics: CatalogMetrics;
  readonly sourceId: SourceId | null;
  readonly resolvedTheme: ColorTheme;
  readonly active: boolean;
  readonly editingGlyphId: GlyphId | null;
  /** The width tiles are given, as `GlyphCatalogLayout` takes it. */
  readonly tileSize: number;
  readonly selection: GlyphSelection;
  /** The box being dragged to select glyphs, in the scrolled content; null when none is. */
  readonly selectionBox: Rect2D | null;
}

export interface GlyphNameInputProps {
  readonly glyph: GlyphCatalogItem;
  readonly onFinished: (nextName: GlyphName | null) => void;
}

export interface GlyphCatalogBackendGateProps {
  readonly glyphs: readonly GlyphCatalogItem[];
  readonly location: CatalogLocation;
  readonly metrics: CatalogMetrics;
  readonly sourceId: SourceId | null;
  readonly active: boolean;
  readonly atlasSource: GlyphAtlasSource;
  readonly observeAtlasInvalidation: GlyphCatalogSource["observeAtlasInvalidation"];
  readonly glyphPreviews: GlyphCatalogSource["glyphPreviews"];
  readonly canAuthor: boolean;
  readonly openGlyph: (glyph: GlyphCatalogItem) => Promise<void>;
  readonly selection: GlyphSelection;
  readonly selectGlyphs: (selection: GlyphSelection) => void;
  readonly tileSize: number;
  readonly onFirstFrame: () => void;
  readonly onUnavailable: () => void;
}

export interface GlyphCatalogViewProps {
  readonly glyphs: readonly GlyphCatalogItem[];
  readonly location: CatalogLocation;
  readonly metrics: CatalogMetrics;
  readonly active: boolean;
  readonly observeAtlasInvalidation: GlyphCatalogSource["observeAtlasInvalidation"];
  readonly canAuthor: boolean;
  /** Opens a glyph in a tab of its own, on double-click. */
  readonly openGlyph: (glyph: GlyphCatalogItem) => Promise<void>;
  /** The selected glyphs, drawn selected, over the glyphs shown. */
  readonly selection: GlyphSelection;
  /** Replaces the selection, as clicking and dragging do. */
  readonly selectGlyphs: (selection: GlyphSelection) => void;
  /** The width tiles are given, as `GlyphCatalogLayout` takes it. */
  readonly tileSize: number;
  readonly onPendingGlyphName: (glyphId: GlyphId, glyphName: GlyphName) => void;
  readonly onFirstFrame: () => void;
  readonly onUnavailable: () => void;
}

export interface SlugGlyphCatalogSurfaceProps extends GlyphCatalogViewProps {
  readonly sourceId: SourceId | null;
  readonly atlasSource: GlyphAtlasSource;
  readonly onSelected: () => void;
  readonly onFallback: () => void;
}

export interface SvgGlyphCatalogGridProps extends GlyphCatalogViewProps {
  readonly glyphPreviews: GlyphCatalogSource["glyphPreviews"];
  readonly glyphActionLabel?: (glyph: GlyphCatalogItem) => string;
}
