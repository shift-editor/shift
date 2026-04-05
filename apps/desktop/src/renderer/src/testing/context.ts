import type { GlyphSnapshot } from "@shift/types";
import type { CommandContext } from "@/lib/commands";
import { signal } from "@/lib/reactive/signal";
import { createMockEditing } from "./engine";

export function createMockCommandContext(glyph: GlyphSnapshot | null = null): CommandContext {
  const fontEngine: CommandContext["fontEngine"] = {
    ...createMockEditing(),
    $glyph: signal(glyph),
  };

  return {
    fontEngine,
    glyph,
  };
}
