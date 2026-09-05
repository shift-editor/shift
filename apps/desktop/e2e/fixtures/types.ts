import type { ElectronApplication, Page } from "@playwright/test";
import type { Axis, NamedInstance, Source } from "@shift/types";
import type { DirtyDocumentChoice } from "../../src/main/document/types";

export type ShiftFixtures = {
  electronApp: ElectronApplication;
  page: Page;
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

export type RecoveryApp = {
  page: Page;
  documentPath: string;
  crashAndRecover: () => Promise<Page>;
  crashAndReopenDocument: () => Promise<Page>;
  canonicalGlyphNames: () => string[];
  canonicalVariableFont: () => CanonicalVariableFont;
};
