import type { GlyphCategory, GlyphCategorySummary } from "@shift/glyph-info";
import type { Rect2D } from "@shift/geo";
import type { Axis, GlyphId, GlyphName, SourceId, SourceMetrics } from "@shift/types";
import type { RefObject } from "react";
import type { ThemeName } from "./uiState";
import type { AxisLocation } from "./variation";

export type GlyphCatalogCellArea = "preview" | "name";

export interface GlyphCatalogItem {
  readonly id: GlyphId;
  readonly name: GlyphName;
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

/** Mutable catalog inputs replaced atomically before the next scheduled frame. */
export interface GlyphCatalogControllerFrame {
  readonly glyphs: readonly GlyphCatalogItem[];
  readonly location: AxisLocation;
  readonly axes: readonly Axis[];
  readonly metrics: SourceMetrics;
  readonly sourceId: SourceId | null;
  readonly themeName: ThemeName;
  readonly active: boolean;
  readonly editingGlyphId: GlyphId | null;
}

export interface GlyphNameInputProps {
  readonly glyph: GlyphCatalogItem;
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
  readonly openGlyph: (glyph: GlyphCatalogItem) => Promise<void>;
  readonly onFirstFrame: () => void;
  readonly onUnavailable: () => void;
}
