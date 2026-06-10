import { describe, expect, it } from "vitest";
import type { GlyphName, SourceId, Unicode } from "@shift/types";
import type { WorkspaceSnapshot } from "@shared/workspace/protocol";
import { signal } from "@/lib/signals/signal";
import { Font } from "./Font";

const SNAPSHOT: WorkspaceSnapshot = {
  documentId: "11111111-2222-3333-4444-555555555555",
  metadata: { familyName: "Untitled Font" },
  metrics: { unitsPerEm: 2048, ascender: 1638, descender: -410 },
  glyphs: [
    {
      name: "A" as GlyphName,
      unicodes: [65 as Unicode],
      componentBaseGlyphNames: [],
    },
  ],
  sources: [
    {
      id: "source-1" as SourceId,
      name: "Regular",
      location: { values: {} },
    },
  ],
};

describe("Font projects the workspace snapshot", () => {
  it("is unloaded with default metrics while no workspace is open", () => {
    const font = new Font(signal<WorkspaceSnapshot | null>(null));

    expect(font.loaded).toBe(false);
    expect(font.metrics.unitsPerEm).toBe(1000);
    expect(font.glyphRecords()).toEqual([]);
  });

  it("follows a snapshot: loaded, metrics, metadata, directory, sources", () => {
    const $workspace = signal<WorkspaceSnapshot | null>(null);
    const font = new Font($workspace);

    $workspace.set(SNAPSHOT);

    expect(font.loaded).toBe(true);
    expect(font.metrics.unitsPerEm).toBe(2048);
    expect(font.metadata.familyName).toBe("Untitled Font");
    expect(font.hasGlyph("A" as GlyphName)).toBe(true);
    expect(font.nameForUnicode(65 as Unicode)).toBe("A");
    expect(font.sources.map((source) => source.name)).toEqual(["Regular"]);
  });

  it("$loaded flips reactively when the snapshot changes", () => {
    const $workspace = signal<WorkspaceSnapshot | null>(null);
    const font = new Font($workspace);

    expect(font.$loaded.value).toBe(false);

    $workspace.set(SNAPSHOT);

    expect(font.$loaded.value).toBe(true);
  });

  it("resets to the unloaded projection when the workspace goes null", () => {
    const $workspace = signal<WorkspaceSnapshot | null>(SNAPSHOT);
    const font = new Font($workspace);

    expect(font.loaded).toBe(true);

    $workspace.set(null);

    expect(font.loaded).toBe(false);
    expect(font.metrics.unitsPerEm).toBe(1000);
    expect(font.hasGlyph("A" as GlyphName)).toBe(false);
    expect(font.sources).toEqual([]);
  });

  it("an empty loaded font reports records, not the unloaded fallback", () => {
    const $workspace = signal<WorkspaceSnapshot | null>({
      ...SNAPSHOT,
      glyphs: [],
    });
    const font = new Font($workspace);

    expect(font.loaded).toBe(true);
    expect(font.glyphRecords()).toEqual([]);
    expect(font.unicodes).toEqual([]);
  });
});
