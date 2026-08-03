import type { GlyphCategory, GlyphCategorySummary } from "@shift/glyph-info";
import type { Rect2D } from "@shift/geo";
import type { CatalogAxis, CatalogMetrics, GlyphId, GlyphName, SourceId } from "@shift/types";
import type { RefObject } from "react";
import type { Signal } from "@/lib/signals";
import type { ThemeName } from "./uiState";
import type { CatalogGlyphKey, GlyphAtlasSource } from "./glyphAtlas";

export type GlyphCatalogCellArea = "preview" | "name";

export interface GlyphCatalogItem {
  readonly id: CatalogGlyphKey;
  readonly name: string;
  readonly displayName: string;
  readonly unicode: number | null;
}

/** Dense external-axis coordinates ordered like `GlyphCatalogSource.axesCell`. */
export type CatalogLocation = readonly number[];

/** Immutable backend boundary consumed by the shared catalog and resident Grid. */
export interface GlyphCatalogSource {
  readonly glyphsCell: Signal<readonly GlyphCatalogItem[]>;
  readonly axesCell: Signal<readonly CatalogAxis[]>;
  readonly locationCell: Signal<CatalogLocation>;
  readonly metricsCell: Signal<CatalogMetrics>;
  readonly familyNameCell: Signal<string | null>;
  readonly styleNameCell: Signal<string | null>;
  readonly sourceIdCell: Signal<SourceId | null>;
  readonly invalidGlyphKeysCell: Signal<readonly CatalogGlyphKey[] | null>;
  readonly atlas: GlyphAtlasSource;

  setLocation(location: CatalogLocation): Promise<void>;
  dispose(): void;
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
  location: CatalogLocation;
  axes: readonly CatalogAxis[];
  metrics: CatalogMetrics;
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

/** Mutable catalog inputs requested by React for the latest authored revision. */
export interface GlyphCatalogControllerFrame {
  readonly glyphs: readonly GlyphCatalogItem[];
  readonly location: CatalogLocation;
  readonly metrics: CatalogMetrics;
  readonly sourceId: SourceId | null;
  readonly themeName: ThemeName;
  readonly active: boolean;
  readonly editingGlyphId: CatalogGlyphKey | null;
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
  readonly location: CatalogLocation;
  readonly metrics: CatalogMetrics;
  readonly sourceId: SourceId | null;
  readonly active: boolean;
  readonly atlasSource: GlyphAtlasSource;
  readonly observeAtlasInvalidation: GlyphCatalogState["observeAtlasInvalidation"];
  readonly editable: boolean;
  readonly openGlyph: ((glyph: GlyphCatalogItem) => Promise<void>) | null;
  readonly onFirstFrame: () => void;
  readonly onUnavailable: () => void;
}
