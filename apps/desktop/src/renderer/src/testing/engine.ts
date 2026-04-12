import type { GlyphSnapshot, PointSnapshot } from "@shift/types";
import { NativeBridge } from "@/bridge/NativeBridge";
import { Glyphs } from "@shift/font";

export function createBridge(): NativeBridge {
  const { FontEngine: NativeFontEngine } = require("shift-node");
  return new NativeBridge(new NativeFontEngine());
}

export function getAllPoints(snapshot: GlyphSnapshot | null): PointSnapshot[] {
  if (!snapshot) return [];
  return Glyphs.getAllPoints(snapshot);
}

export function getPointCount(snapshot: GlyphSnapshot | null): number {
  if (!snapshot) return 0;
  return Glyphs.getAllPoints(snapshot).length;
}
