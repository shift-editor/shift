import type { SystemClipboard } from "../lib/clipboard";
import { createMemoryFontSession } from "../createMemoryFontSession";
import type { MemoryFontSession, MemoryToolName } from "../types/fontSession";
import { asSourceId } from "@shift/types";

class MemoryClipboard implements SystemClipboard {
  #value = "";

  writeText(value: string): Promise<void> {
    this.#value = value;
    return Promise.resolve();
  }

  readText(): Promise<string> {
    return Promise.resolve(this.#value);
  }
}

/**
 * Starts a workspace-free editor over a font with one source and no glyphs,
 * for subject tests of editor parts that need an `Editor` but no font data.
 *
 * @param tools - Tools to register, the first active; Select then Hand by default.
 */
export function startEmptyMemorySession(tools?: readonly MemoryToolName[]): MemoryFontSession {
  return createMemoryFontSession({
    clipboard: new MemoryClipboard(),
    tools,
    source: {
      font: {
        metadata: { familyName: "Empty" },
        metrics: { unitsPerEm: 1000 },
        metricDefinitions: [],
        kerning: { groups: [], sources: [] },
        glyphs: [],
        sources: [
          {
            id: asSourceId("source_regular"),
            name: "Regular",
            location: { values: {} },
            metricValues: [],
          },
        ],
        axes: [],
        axisMappings: [],
        axisMappingBases: [],
        namedInstances: [],
      },
      records: [],
      read: () => Promise.resolve([]),
      glyphPreviews: () => Promise.resolve([]),
    },
  });
}
