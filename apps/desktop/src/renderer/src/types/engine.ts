import type { CommandResult, ContourId, GlyphSnapshot, PointId, PointType } from "@shift/types";
import type { NativeFontEngine } from "@/engine/native";

export interface EngineCore {
  readonly native: NativeFontEngine;
  hasSession(): boolean;
  getGlyph(): GlyphSnapshot | null;
  commit(operation: () => string): void;
  commit<T>(operation: () => string, extract: (result: CommandResult) => T): T;
  emitGlyph(glyph: GlyphSnapshot | null): void;
}

export interface PasteResult {
  success: boolean;
  createdPointIds: PointId[];
  createdContourIds: ContourId[];
  error?: string;
}

export interface PointEdit {
  id?: PointId;
  x: number;
  y: number;
  pointType: PointType;
  smooth: boolean;
}
