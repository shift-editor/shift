import { describe, it, expect, beforeEach, vi } from "vitest";
import { EdgePanManager } from "./EdgePanManager";
import type { Rect2D } from "@shift/types";

describe("EdgePanManager", () => {
  const canvasBounds: Rect2D = {
    x: 0,
    y: 0,
    width: 800,
    height: 600,
    left: 0,
    top: 0,
    right: 800,
    bottom: 600,
  };

  beforeEach(() => {
    vi.stubGlobal("requestAnimationFrame", (_cb: () => void) => 0);
  });

  it("calls handlePointerMove with force: true when ticking so tool feedback moves with pan", () => {
    const handlePointerMove = vi.fn();
    const editor = {
      getToolManager: () => ({ handlePointerMove, isDragging: true }),
      pan: { x: 0, y: 0 },
      setPan: vi.fn(),
      requestRedraw: vi.fn(),
    };

    const manager = new EdgePanManager(editor as any, { marginSize: 50 });
    manager.update({ x: 10, y: 300 }, canvasBounds);

    expect(handlePointerMove).toHaveBeenCalledWith(
      { x: 10, y: 300 },
      { shiftKey: false, altKey: false },
      { force: true },
    );
  });
});
