import type { ElectronApplication, Page } from "@playwright/test";
import type { Point2D } from "@shift/geo";
import type { SegmentType } from "@shift/glyph-state";
import type {
  Axis,
  ContourId,
  GlyphId,
  NamedInstance,
  NodeId,
  PointId,
  PointSeed,
  PointType,
  Source,
  SourceId,
} from "@shift/types";
import type { DirtyDocumentChoice } from "../../src/main/document/types";
import type { EditorDriver } from "./EditorDriver";

export type ShiftFixtures = {
  electronApp: ElectronApplication;
  page: Page;
  editor: EditorDriver;
  testRoot: string;
  saveShiftPath: string;
  saveAsShiftPath: string;
  copyShiftPath: string;
  exportTtfPath: string;
};

export type ShiftOptions = {
  startupFontPath: string | undefined;
  electronArgs: readonly string[];
  /** Preserves native geometry unless exact visual baseline dimensions are requested. */
  windowSizing: "native" | "visual";
  scriptedDialogs: boolean;
  openFontPath: string | undefined;
  saveShiftPaths: readonly string[] | undefined;
  dirtyDocumentChoice: DirtyDocumentChoice;
  dirtyDocumentChoices: readonly DirtyDocumentChoice[] | undefined;
  dirtyDocumentDelayMs: number;
  documentCrashChoice: "reopen" | "close";
};

export interface CanonicalVariableFont {
  axes: Axis[];
  sources: Source[];
  namedInstances: NamedInstance[];
}

export interface ActiveGlyph {
  readonly glyphId: GlyphId;
  readonly nodeId: NodeId;
  readonly sourceId: SourceId;
  readonly pointCount: number;
  readonly contourCount: number;
}

export interface CanvasBounds {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export type PointerModifier = "Alt" | "Control" | "ControlOrMeta" | "Meta" | "Shift";

export interface CanvasDrag {
  readonly from: Point2D;
  readonly to: Point2D;
  readonly modifiers?: readonly PointerModifier[];
  readonly steps?: number;
}

export interface PointTarget {
  readonly id: PointId;
  readonly glyphPosition: Point2D;
  readonly canvasPosition: Point2D;
  readonly pagePosition: Point2D;
}

export interface PointDrag {
  readonly id: PointId;
  readonly startPagePosition: Point2D;
  readonly endPagePosition: Point2D;
  readonly expectedGlyphPosition: Point2D;
}

export interface OutlineContour {
  readonly id: ContourId;
  readonly closed: boolean;
  readonly points: readonly Readonly<PointSeed>[];
  readonly onCurvePoints: readonly Readonly<PointSeed>[];
  readonly segments: readonly SegmentType["type"][];
}

export type Outline = readonly OutlineContour[];

export type RecoveryApp = {
  page: Page;
  documentPath: string;
  crashAndRecover: () => Promise<Page>;
  crashAndReopenDocument: () => Promise<Page>;
  canonicalGlyphNames: () => string[];
  canonicalVariableFont: () => CanonicalVariableFont;
};

/** Point inserted by a scratch-glyph fixture; the editor mints its identity. */
export interface ScratchPoint {
  readonly x: number;
  readonly y: number;
  readonly pointType: PointType;
  readonly smooth: boolean;
}

/** Contour inserted into a scratch glyph. */
export interface ScratchContour {
  readonly closed: boolean;
  readonly points: readonly ScratchPoint[];
}
