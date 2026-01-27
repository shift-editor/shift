import type { GlyphSnapshot } from "@shift/types";
import type { CommandContext } from "@/lib/commands";
import { createMockEditing } from "./engine";

export function createMockCommandContext(glyph: GlyphSnapshot | null = null): CommandContext {
  return {
    fontEngine: {
      editing: createMockEditing(),
    } as any,
    glyph,
  };
}

export interface MockToolContextOptions {
  viewportSize?: { width: number; height: number };
}
