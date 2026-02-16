import { GapBuffer } from "@/lib/tools/text/GapBuffer";
import type { GlyphRef } from "@/lib/tools/text/layout";

export const DEFAULT_TEXT_RUN_KEY = "__default__";

export interface PersistedTextRun {
  glyphs: GlyphRef[];
  cursorPosition: number;
  originX: number;
  editingIndex: number | null;
  editingGlyph: GlyphRef | null;
}

export interface TextRunEntry {
  buffer: GapBuffer<GlyphRef>;
  originX: number;
  cursorVisible: boolean;
  editingIndex: number | null;
  editingGlyph: GlyphRef | null;
  hoveredIndex: number | null;
  inspectionSlotIndex: number | null;
  inspectionHoveredComponentIndex: number | null;
}

export function createTextRunEntry(): TextRunEntry {
  return {
    buffer: GapBuffer.create<GlyphRef>(),
    originX: 0,
    cursorVisible: false,
    editingIndex: null,
    editingGlyph: null,
    hoveredIndex: null,
    inspectionSlotIndex: null,
    inspectionHoveredComponentIndex: null,
  };
}

export function serializeTextRuns(
  runs: Map<string, TextRunEntry>,
  defaultRunKey = DEFAULT_TEXT_RUN_KEY,
): Record<string, PersistedTextRun> {
  const out: Record<string, PersistedTextRun> = {};
  for (const [key, run] of runs.entries()) {
    if (key === defaultRunKey || run.buffer.length === 0) continue;
    out[key] = {
      glyphs: run.buffer.getText(),
      cursorPosition: run.buffer.cursorPosition,
      originX: run.originX,
      editingIndex: run.editingIndex,
      editingGlyph: run.editingGlyph,
    };
  }
  return out;
}

export function hydrateTextRuns(next: Record<string, PersistedTextRun>): Map<string, TextRunEntry> {
  const runs = new Map<string, TextRunEntry>();
  for (const [glyphKey, run] of Object.entries(next)) {
    runs.set(glyphKey, {
      buffer: GapBuffer.from(run.glyphs, run.cursorPosition),
      originX: run.originX,
      cursorVisible: false,
      editingIndex: run.editingIndex,
      editingGlyph: run.editingGlyph,
      hoveredIndex: null,
      inspectionSlotIndex: null,
      inspectionHoveredComponentIndex: null,
    });
  }
  return runs;
}
