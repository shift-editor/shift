import { describe, it, expect, beforeEach } from "vitest";
import { Clipboard } from "./Clipboard";
import type { ShiftContent, SystemClipboard } from "./types";

class MemoryClipboard implements SystemClipboard {
  text = "";

  writeText(text: string): void {
    this.text = text;
  }

  readText(): string {
    return this.text;
  }
}

const content = (): ShiftContent => ({
  contours: [
    {
      closed: true,
      points: [
        { x: 0, y: 0, pointType: "onCurve", smooth: false },
        { x: 100, y: 0, pointType: "onCurve", smooth: false },
      ],
    },
  ],
});

describe("Clipboard", () => {
  let system: MemoryClipboard;
  let clipboard: Clipboard;

  beforeEach(() => {
    system = new MemoryClipboard();
    clipboard = new Clipboard(system);
  });

  it("writes Shift content as a versioned clipboard payload", async () => {
    const written = await clipboard.write(content());

    expect(written).toBe(true);

    const payload = JSON.parse(system.text);
    expect(payload.format).toBe("shift/glyph-data");
    expect(payload.version).toBe(1);
    expect(payload.content.contours).toHaveLength(1);
    expect(payload.metadata.sourceApp).toBe("shift");
  });

  it("reads Shift clipboard payloads as glyph content", async () => {
    await clipboard.write(content());

    const result = await clipboard.read();

    expect(result.kind).toBe("content");
    if (result.kind !== "content") return;

    expect(result.source).toBe("shift");
    expect(result.content.contours[0]?.points).toHaveLength(2);
  });

  it("returns unsupported for non-empty text that no importer accepts", async () => {
    system.writeText("plain text");

    const result = await clipboard.read();

    expect(result.kind).toBe("unsupported");
  });

  it("returns empty for an empty system clipboard", async () => {
    const result = await clipboard.read();

    expect(result.kind).toBe("empty");
  });

  it("compounds paste offsets until reset", () => {
    expect(clipboard.nextPasteOffset()).toEqual({ x: 20, y: -20 });
    expect(clipboard.nextPasteOffset()).toEqual({ x: 40, y: -40 });

    clipboard.resetPasteOffset();

    expect(clipboard.nextPasteOffset()).toEqual({ x: 20, y: -20 });
  });
});
