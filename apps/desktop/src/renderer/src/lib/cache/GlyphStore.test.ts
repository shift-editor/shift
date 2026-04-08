import { describe, it, expect, beforeEach } from "vitest";
import { GlyphStore } from "./GlyphStore";
import { createFontEngine } from "@/testing";
import type { FontEngine } from "@/engine/FontEngine";

describe("GlyphStore", () => {
  let engine: FontEngine;
  let store: GlyphStore;

  beforeEach(() => {
    engine = createFontEngine();
    store = new GlyphStore(engine);
  });

  it("lazily creates entries on first access", () => {
    expect(store.size).toBe(0);

    engine.startEditSession({ glyphName: "A", unicode: 65 });
    const glyph = store.get("A").value;

    expect(store.size).toBe(1);
    expect(glyph).not.toBeNull();
    expect(glyph!.name).toBe("A");
  });

  it("returns cached signal on subsequent access", () => {
    engine.startEditSession({ glyphName: "A", unicode: 65 });

    const first = store.get("A");
    const second = store.get("A");

    expect(first).toBe(second);
  });

  it("self-heals when editing glyph is mutated", () => {
    engine.startEditSession({ glyphName: "A", unicode: 65 });

    engine.addPoint({ x: 0, y: 0, pointType: "onCurve", smooth: false });
    engine.addPoint({ x: 100, y: 0, pointType: "onCurve", smooth: false });
    engine.addPoint({ x: 100, y: 100, pointType: "onCurve", smooth: false });

    const entry = store.get("A");
    const svgBefore = entry.value!.svgPath;
    expect(svgBefore).not.toBeNull();

    engine.addPoint({ x: 0, y: 100, pointType: "onCurve", smooth: false });

    expect(entry.value!.svgPath).not.toBe(svgBefore);
  });

  it("clear removes all entries", () => {
    engine.startEditSession({ glyphName: "A", unicode: 65 });
    store.get("A");

    store.clear();

    expect(store.size).toBe(0);
  });

  it("dispose stops the effect and clears", () => {
    engine.startEditSession({ glyphName: "A", unicode: 65 });
    store.get("A");

    store.dispose();

    expect(store.size).toBe(0);
  });
});
