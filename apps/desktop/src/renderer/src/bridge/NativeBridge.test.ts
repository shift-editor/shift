import { describe, it, expect, beforeEach } from "vitest";
import { NativeBridge } from "./NativeBridge";
import { createBridge } from "@/testing/engine";
import { effect } from "@/lib/reactive";

describe("NativeBridge session lifecycle", () => {
  let bridge: NativeBridge;

  beforeEach(() => {
    bridge = createBridge();
  });

  it("has no session and a null $glyph before any start", () => {
    expect(bridge.hasSession()).toBe(false);
    expect(bridge.$glyph.peek()).toBe(null);
  });

  it("startEditSession opens a session and populates $glyph", () => {
    bridge.startEditSession("A");

    expect(bridge.hasSession()).toBe(true);
    expect(bridge.$glyph.peek()).not.toBe(null);
    expect(bridge.getEditingGlyphName()).toBe("A");
  });

  it("endEditSession clears the session and nulls $glyph", () => {
    bridge.startEditSession("A");
    bridge.endEditSession();

    expect(bridge.hasSession()).toBe(false);
    expect(bridge.$glyph.peek()).toBe(null);
  });

  it("starting the same glyph again is a no-op — $glyph reference is preserved", () => {
    bridge.startEditSession("A");
    const first = bridge.$glyph.peek();

    bridge.startEditSession("A");
    const second = bridge.$glyph.peek();

    expect(second).toBe(first);
  });

  it("switching to a different glyph replaces the Glyph instance", () => {
    bridge.startEditSession("A");
    const first = bridge.$glyph.peek();

    bridge.startEditSession("B");
    const second = bridge.$glyph.peek();

    expect(bridge.getEditingGlyphName()).toBe("B");
    expect(second).not.toBe(first);
  });

  it("$glyph signal notifies subscribers when a session starts", () => {
    let fires = 0;
    const dispose = effect(() => {
      bridge.$glyph.value;
      fires++;
    });
    const initialFires = fires;

    bridge.startEditSession("A");

    expect(fires).toBeGreaterThan(initialFires);
    dispose.dispose();
  });
});
