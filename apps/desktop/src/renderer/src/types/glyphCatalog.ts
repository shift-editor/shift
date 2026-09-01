import type { GlyphCategory, GlyphCategorySummary } from "@shift/glyph-info";
import type { Rect2D } from "@shift/geo";
import type {
  CatalogAxis,
  CatalogMetrics,
  GlyphId,
  GlyphName,
  GlyphPreview,
  SourceId,
} from "@shift/types";
import type { RenderGlyph } from "./glyphRender";
import type { ThemeName } from "./uiState";
import type { GlyphAtlasSource } from "./glyphAtlas";

export type GlyphCatalogCellArea = "preview" | "name";

export interface GlyphCatalogItem {
  readonly id: GlyphId;
  readonly name: GlyphName;
  readonly displayName: string;
  readonly unicode: number | null;
}

export type PendingGlyphNames = ReadonlyMap<GlyphId, GlyphName>;

/** Publication decision for an asynchronously opened glyph. */
export type GlyphOpenResult<T> =
  | { readonly status: "current"; readonly glyph: T }
  | { readonly status: "stale" };

/** Dense external-axis coordinates ordered like `GlyphCatalogSource.axesCell`. */
export type CatalogLocation = readonly number[];

export interface GlyphCatalogSource {
  availableGlyphs: GlyphCatalogItem[];
  filteredGlyphs: GlyphCatalogItem[];
  categories: GlyphCategorySummary[];
  selectedCategory: GlyphCategory | null;
  selectedSubCategoryKey: string | null;
  query: string;
  setQuery: (nextQuery: string) => void;
  createQuickGlyph: () => GlyphName;
  selectAll: () => void;
  selectCategory: (category: GlyphCategory) => void;
  selectSubCategory: (category: GlyphCategory, subCategoryKey: string) => void;
  atlasSource: GlyphAtlasSource;
  observeAtlasInvalidation: (
    listener: (glyphIds: readonly GlyphId[] | null, directory: readonly GlyphId[]) => void,
  ) => () => void;
  glyphPreviews: (
    glyphIds: readonly GlyphId[],
    location: CatalogLocation,
  ) => Promise<readonly GlyphPreview[]>;
  location: CatalogLocation;
  axes: readonly CatalogAxis[];
  metrics: CatalogMetrics;
  sourceId: SourceId | null;
  canAuthor: boolean;
  openedGlyph: RenderGlyph | null;
  openGlyph: (glyph: GlyphCatalogItem) => Promise<void>;
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
  readonly themeName: ThemeName;
  readonly active: boolean;
  readonly editingGlyphId: GlyphId | null;
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
  readonly openGlyph: (glyph: GlyphCatalogItem) => Promise<void>;
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
}
