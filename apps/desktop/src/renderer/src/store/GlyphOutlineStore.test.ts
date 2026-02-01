import { describe, it, expect, vi, beforeEach } from "vitest";
import { effect } from "@/lib/reactive/signal";
import { GlyphOutlineStore } from "./GlyphOutlineStore";

describe("GlyphOutlineStore", () => {
  let store: GlyphOutlineStore;

  beforeEach(() => {
    store = new GlyphOutlineStore();
  });

  describe("getGlyphVersion", () => {
    it("should return a signal with default version for unknown glyphs", () => {
      const versionSignal = store.getGlyphVersion(65);
      expect(versionSignal.value).toBe(0);
    });

    it("should return the same signal instance for the same unicode", () => {
      const first = store.getGlyphVersion(65);
      const second = store.getGlyphVersion(65);
      expect(first).toBe(second);
    });

    it("should return different signal instances for different unicodes", () => {
      const a = store.getGlyphVersion(65);
      const b = store.getGlyphVersion(66);
      expect(a).not.toBe(b);
    });
  });

  describe("invalidateGlyph", () => {
    it("should increment the version signal", () => {
      const versionSignal = store.getGlyphVersion(65);
      expect(versionSignal.value).toBe(0);

      store.invalidateGlyph(65);
      expect(versionSignal.value).toBe(1);

      store.invalidateGlyph(65);
      expect(versionSignal.value).toBe(2);
    });

    it("should notify subscribers when invalidated", () => {
      const versionSignal = store.getGlyphVersion(65);
      const subscriber = vi.fn();

      effect(() => {
        versionSignal.value;
        subscriber();
      });

      expect(subscriber).toHaveBeenCalledTimes(1);

      store.invalidateGlyph(65);
      expect(subscriber).toHaveBeenCalledTimes(2);
    });

    it("should notify the same signal subscriber after invalidation (critical bug fix)", () => {
      const versionSignal = store.getGlyphVersion(65);
      const subscriber = vi.fn();
      const dispose = effect(() => {
        versionSignal.value;
        subscriber();
      });

      expect(subscriber).toHaveBeenCalledTimes(1);

      store.invalidateGlyph(65);
      expect(subscriber).toHaveBeenCalledTimes(2);

      const sameSignal = store.getGlyphVersion(65);
      expect(sameSignal).toBe(versionSignal);

      dispose.dispose();
    });
  });

  describe("onFontLoaded", () => {
    it("should clear glyph versions", () => {
      store.invalidateGlyph(65);
      const versionBefore = store.getGlyphVersion(65).value;
      expect(versionBefore).toBe(1);

      store.onFontLoaded([65, 66, 67]);

      const versionAfter = store.getGlyphVersion(65).value;
      expect(versionAfter).toBe(0);
    });

    it("should set font unicodes", () => {
      store.onFontLoaded([65, 66, 67]);
      expect(store.fontUnicodes.value).toEqual([65, 66, 67]);
    });

    it("should set fontLoaded to true", () => {
      expect(store.fontLoaded.value).toBe(false);
      store.onFontLoaded([65, 66, 67]);
      expect(store.fontLoaded.value).toBe(true);
    });
  });

  describe("onFontUnloaded", () => {
    it("should clear glyph versions and reset state", () => {
      store.onFontLoaded([65, 66, 67]);
      store.invalidateGlyph(65);

      store.onFontUnloaded();

      expect(store.fontLoaded.value).toBe(false);
      expect(store.fontUnicodes.value).toEqual([]);
      expect(store.fontMetrics.value).toBeNull();
    });
  });
});
