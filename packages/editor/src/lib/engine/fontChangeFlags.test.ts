import { describe, expect, it } from "vitest";
import { FontChangeFlagSchema } from "@shift/wasm/protocol";
import { memoryFontSession, newMemoryFontSource } from "../../createMemoryFontSession";
import { MemoryClipboard } from "../../testing/emptyMemorySession";
import { SessionEngine } from "./SessionEngine";

/** Mirrors `FontChangeFlag::ALL` in `crates/shift-font/src/changes.rs`, in bit order. */
const RUST_FONT_CHANGE_FLAGS = [
  "metadata",
  "languages",
  "strokeMeasure",
  "glyphs",
  "axes",
  "axisMappings",
  "axisMappingBases",
  "metricDefinitions",
  "sourceMetrics",
  "namedInstances",
  "sources",
  "kerning",
  "layers",
  "scene",
  "grid",
] as const;

describe("FontChangeFlagSchema", () => {
  it("lists every Rust FontChangeFlag name", () => {
    expect([...FontChangeFlagSchema.names]).toEqual([...RUST_FONT_CHANGE_FLAGS]);
  });

  it("gives SessionEngine a revision for each flag and reapply reads strokeMeasure", async () => {
    const { font } = await newMemoryFontSource({ familyName: "Flag Test", unitsPerEm: 1000 });
    const engine = await SessionEngine.open({ kind: "resident", font });
    const session = memoryFontSession(engine, { clipboard: new MemoryClipboard() });

    try {
      for (const flag of FontChangeFlagSchema.names) {
        expect(engine.revision(flag).value).toBeGreaterThanOrEqual(0);
      }

      expect(() => session.font.reapplyLinkedMetricsDisabledReason({ kind: "font" })).not.toThrow();
    } finally {
      session.dispose();
    }
  });
});
