import type { LocalPoint, ScreenPoint } from "@shift/editor/spaces";
import type { ElectronApplication, Page } from "@playwright/test";
import type { Point2D } from "@shift/geo";
import type { Axis, GlyphId, NamedInstance, NodeId, PointId, Source, SourceId } from "@shift/types";
import type { DirtyDocumentChoice } from "../../src/main/document/types";
import type { FontFixture } from "@/testing/fonts";
import type { EditorDriver } from "./EditorDriver";
import type { ElectronProcesses } from "./electronProcesses";

export type ShiftFixtures = {
  electronProcesses: ElectronProcesses;
  electronApp: ElectronApplication;
  relaunch: RelaunchApp;
  page: Page;
  editor: EditorDriver;
  testRoot: string;
  saveShiftPath: string;
  saveAsShiftPath: string;
  copyShiftPath: string;
  exportTtfPath: string;
};

/** A workspace app launched once per worker and shared by the tests that opt in. */
export interface SharedWorkspace {
  readonly app: ElectronApplication;
  readonly processes: ElectronProcesses;
}

export type ShiftWorkerFixtures = {
  /** Launches the worker's shared workspace app on first call and returns it afterwards. */
  sharedWorkspaceApp: () => Promise<SharedWorkspace>;
};

export type ShiftOptions = {
  /**
   * Reuses one MutatorSans workspace app per worker instead of launching one per test. Set it
   * with `test.use({ sharedWorkspace: true })` on a describe whose tests never edit the
   * document; a test that leaves the document dirty fails.
   */
  sharedWorkspace: boolean;
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
  /** Permits renderer alert, confirm, prompt, or beforeunload dialogs during the test. */
  allowRendererDialogs: boolean;
  /**
   * Builds this font fixture into the launched document once the workspace is ready, before the
   * test body runs, through the same commands vitest's `useTestEditor` uses: glyphs the font has
   * are drawn into, others are added; then axes, then sources. Only the workspace fixtures
   * (`workspaceTest`, `documentWorkspaceTest`) apply it; `mode` is not supported, and it cannot
   * be combined with `sharedWorkspace`.
   */
  font: FontFixture | undefined;
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
  readonly modifiers: readonly PointerModifier[];
  readonly steps?: number;
}

export interface PointTarget {
  readonly id: PointId;
  readonly glyphPosition: LocalPoint;
  readonly canvasPosition: ScreenPoint;
  readonly pagePosition: Point2D;
}

export interface PointDrag {
  readonly id: PointId;
  readonly startPagePosition: Point2D;
  readonly endPagePosition: Point2D;
  readonly expectedGlyphPosition: LocalPoint;
}

export type RecoveryApp = {
  page: Page;
  /** The driver for the window open now; after a crash, the recovered one. */
  readonly editor: EditorDriver;
  /** The app running now: the first launch until a crash, then the launch that recovered. */
  readonly app: ElectronApplication;
  documentPath: string;
  crashAndRecover: () => Promise<Page>;
  /**
   * Like `crashAndRecover`, but first waits until `persistedText` is in renderer storage on
   * disk, and returns the recovered window as soon as it loads, on any route.
   */
  crashAndRecoverWindow: (persistedText: string) => Promise<Page>;
  crashAndReopenDocument: () => Promise<Page>;
  canonicalGlyphNames: () => string[];
  canonicalVariableFont: () => CanonicalVariableFont;
};

/** One Electron launch owned by {@link ElectronProcesses}. */
export interface ElectronLaunch {
  /** Diagnostic label for attachments, such as `initial` or `relaunch-1`. */
  readonly label: string;
  /** Isolated user-data directory the application must adopt. */
  readonly userDataDir: string;
  /** Arguments after the main script, such as a document path; empty for none. */
  readonly args: readonly string[];
  /** Environment for the launch; build it with `shiftTestEnvironment()`. */
  readonly env: Record<string, string>;
  /** Window geometry policy applied to the first window. */
  readonly windowSizing: "native" | "visual";
  /**
   * Device pixels per CSS pixel forced for the process; defaults to 1. Fixtures pass
   * Playwright's `deviceScaleFactor` option, so `test.use({ deviceScaleFactor: 2 })` renders
   * at 2× while visual window sizing stays in CSS pixels.
   */
  readonly deviceScaleFactor?: number;
}

/** Launches the application again with the test's user-data directory and dialog script. */
export type RelaunchApp = (options?: {
  /** Additional arguments, such as a document to open on launch; empty for none. */
  readonly args: readonly string[];
  /** Additional Shift E2E variables for this launch. */
  readonly env?: Record<string, string>;
}) => Promise<ElectronApplication>;

/** Records a dialog the renderer opened during a test. */
export interface RecordedDialog {
  readonly type: string;
  readonly message: string;
}
