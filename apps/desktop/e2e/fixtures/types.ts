import type { ElectronApplication, Page } from "@playwright/test";
import type { Point2D } from "@shift/geo";
import type { SegmentType } from "@shift/glyph-state";
import type { Axis, ContourId, NamedInstance, PointId, PointSeed, Source } from "@shift/types";
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

export interface PointTarget {
  readonly id: PointId;
  readonly glyphPosition: Point2D;
  readonly canvasPosition: Point2D;
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
