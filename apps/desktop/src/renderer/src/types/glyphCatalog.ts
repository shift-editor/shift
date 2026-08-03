import type { GlyphCategory, GlyphCategorySummary } from "@shift/glyph-info";
import type { Rect2D } from "@shift/geo";
import type { Axis, GlyphId, GlyphName, SourceId, SourceMetrics } from "@shift/types";
import type { RefObject } from "react";
import type { ThemeName } from "./uiState";
import type { AxisLocation } from "./variation";
import type { CatalogGlyphKey, GlyphAtlasSource } from "./glyphAtlas";

export type GlyphCatalogCellArea = "preview" | "name";

export interface GlyphCatalogItem {
  readonly id: CatalogGlyphKey;
  readonly name: string;
  readonly displayName: string;
  readonly unicode: number | null;
}

export interface GlyphCatalogState {
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
    listener: (
      glyphKeys: readonly CatalogGlyphKey[] | null,
      directory: readonly CatalogGlyphKey[],
    ) => void,
  ) => () => void;
  location: AxisLocation;
  axes: readonly Axis[];
  resolvedCoordinates: readonly number[] | null;
  metrics: SourceMetrics;
  sourceId: SourceId | null;
  editable: boolean;
  openGlyph: ((glyph: GlyphCatalogItem) => Promise<void>) | null;
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

/** One fixed root page selected for an atomic Grid replacement. */
export interface GlyphCatalogAtlasPage {
  readonly glyphKeys: CatalogGlyphKey[];
  readonly pageIndex: number;
  readonly pageCount: number;
  readonly replacementPageIndices: number[];
}

/** Mutable catalog inputs requested by React for the latest authored revision. */
export interface GlyphCatalogControllerFrame {
  readonly glyphs: readonly GlyphCatalogItem[];
  readonly location: AxisLocation;
  readonly axes: readonly Axis[];
  readonly metrics: SourceMetrics;
  readonly sourceId: SourceId | null;
  readonly themeName: ThemeName;
  readonly active: boolean;
  readonly editingGlyphId: CatalogGlyphKey | null;
  readonly resolvedCoordinates: readonly number[] | null;
}

export interface EditableGlyphCatalogItem extends GlyphCatalogItem {
  readonly id: GlyphId;
  readonly name: GlyphName;
}

export interface GlyphNameInputProps {
  readonly glyph: EditableGlyphCatalogItem;
  readonly onFinished: () => void;
}

export interface GlyphCatalogCanvasProps {
  readonly containerRef: RefObject<HTMLDivElement | null>;
  readonly glyphs: readonly GlyphCatalogItem[];
  readonly location: AxisLocation;
  readonly axes: readonly Axis[];
  readonly metrics: SourceMetrics;
  readonly sourceId: SourceId | null;
  readonly active: boolean;
  readonly atlasSource: GlyphAtlasSource;
  readonly observeAtlasInvalidation: GlyphCatalogState["observeAtlasInvalidation"];
  readonly resolvedCoordinates: readonly number[] | null;
  readonly editable: boolean;
  readonly openGlyph: ((glyph: GlyphCatalogItem) => Promise<void>) | null;
  readonly onFirstFrame: () => void;
  readonly onUnavailable: () => void;
}
