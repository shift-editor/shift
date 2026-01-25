import { describe, it, expect, beforeEach, vi } from "vitest";
import { SelectCommands, type BoundingRectEdge } from "./commands";
import type { Rect2D } from "@shift/types";

describe("SelectCommands resize helpers", () => {
  describe("getAnchorPointForEdge", () => {
    const bounds: Rect2D = {
      x: 100,
      y: 100,
      width: 100,
      height: 100,
      left: 100,
      right: 200,
      top: 100,
      bottom: 200,
    };

    const mockEditor = {
      createToolContext: vi.fn(() => ({
        glyph: null,
        selectedPoints: new Set(),
        selectionMode: "committed",
        screen: { hitRadius: 8 },
      })),
    } as any;

    let commands: SelectCommands;

    beforeEach(() => {
      commands = new SelectCommands(mockEditor);
    });

    it("returns diagonal opposite corner for top-left (dragging from minX, maxY)", () => {
      const anchor = commands.getAnchorPointForEdge("top-left", bounds);
      expect(anchor).toEqual({ x: bounds.right, y: bounds.top });
    });

    it("returns diagonal opposite corner for top-right (dragging from maxX, maxY)", () => {
      const anchor = commands.getAnchorPointForEdge("top-right", bounds);
      expect(anchor).toEqual({ x: bounds.left, y: bounds.top });
    });

    it("returns diagonal opposite corner for bottom-left (dragging from minX, minY)", () => {
      const anchor = commands.getAnchorPointForEdge("bottom-left", bounds);
      expect(anchor).toEqual({ x: bounds.right, y: bounds.bottom });
    });

    it("returns diagonal opposite corner for bottom-right (dragging from maxX, minY)", () => {
      const anchor = commands.getAnchorPointForEdge("bottom-right", bounds);
      expect(anchor).toEqual({ x: bounds.left, y: bounds.bottom });
    });

    it("returns opposite edge center for left edge", () => {
      const anchor = commands.getAnchorPointForEdge("left", bounds);
      expect(anchor).toEqual({ x: bounds.right, y: 150 });
    });

    it("returns opposite edge center for right edge", () => {
      const anchor = commands.getAnchorPointForEdge("right", bounds);
      expect(anchor).toEqual({ x: bounds.left, y: 150 });
    });

    it("returns opposite edge center for top edge", () => {
      const anchor = commands.getAnchorPointForEdge("top", bounds);
      expect(anchor).toEqual({ x: 150, y: bounds.bottom });
    });

    it("returns opposite edge center for bottom edge", () => {
      const anchor = commands.getAnchorPointForEdge("bottom", bounds);
      expect(anchor).toEqual({ x: 150, y: bounds.top });
    });
  });

  describe("calculateScaleFactors", () => {
    const initialBounds: Rect2D = {
      x: 100,
      y: 100,
      width: 100,
      height: 100,
      left: 100,
      right: 200,
      top: 100,
      bottom: 200,
    };

    const mockEditor = {
      createToolContext: vi.fn(),
    } as any;

    let commands: SelectCommands;

    beforeEach(() => {
      commands = new SelectCommands(mockEditor);
    });

    it("calculates correct scale for corner drag - scale up", () => {
      const anchorPoint = { x: 100, y: 200 };
      const currentPos = { x: 250, y: 50 };
      const { sx, sy } = commands.calculateScaleFactors(
        "bottom-right",
        currentPos,
        anchorPoint,
        initialBounds,
        false,
      );
      expect(sx).toBeCloseTo(1.5);
      expect(sy).toBeCloseTo(1.5);
    });

    it("calculates correct scale for corner drag - scale down", () => {
      const anchorPoint = { x: 100, y: 200 };
      const currentPos = { x: 150, y: 150 };
      const { sx, sy } = commands.calculateScaleFactors(
        "bottom-right",
        currentPos,
        anchorPoint,
        initialBounds,
        false,
      );
      expect(sx).toBeCloseTo(0.5);
      expect(sy).toBeCloseTo(0.5);
    });

    it("calculates uniform scale when shift is held", () => {
      const anchorPoint = { x: 100, y: 200 };
      const currentPos = { x: 250, y: 120 };
      const { sx, sy } = commands.calculateScaleFactors(
        "bottom-right",
        currentPos,
        anchorPoint,
        initialBounds,
        true,
      );
      expect(sx).toEqual(sy);
    });

    it("calculates correct scale for horizontal edge drag", () => {
      const anchorPoint = { x: 100, y: 150 };
      const currentPos = { x: 300, y: 150 };
      const { sx, sy } = commands.calculateScaleFactors(
        "right",
        currentPos,
        anchorPoint,
        initialBounds,
        false,
      );
      expect(sx).toBeCloseTo(2.0);
      expect(sy).toBeCloseTo(1.0);
    });

    it("calculates correct scale for vertical edge drag", () => {
      const anchorPoint = { x: 150, y: 100 };
      const currentPos = { x: 150, y: 300 };
      const { sx, sy } = commands.calculateScaleFactors(
        "bottom",
        currentPos,
        anchorPoint,
        initialBounds,
        false,
      );
      expect(sx).toBeCloseTo(1.0);
      expect(sy).toBeCloseTo(2.0);
    });

    it("does not flip for normal top-left corner drag", () => {
      const anchorPoint = { x: 200, y: 100 };
      const currentPos = { x: 80, y: 220 };
      const { sx, sy } = commands.calculateScaleFactors(
        "top-left",
        currentPos,
        anchorPoint,
        initialBounds,
        false,
      );
      expect(sx).toBeGreaterThan(0);
      expect(sy).toBeGreaterThan(0);
    });

    it("does not flip for normal top-right corner drag", () => {
      const anchorPoint = { x: 100, y: 100 };
      const currentPos = { x: 220, y: 220 };
      const { sx, sy } = commands.calculateScaleFactors(
        "top-right",
        currentPos,
        anchorPoint,
        initialBounds,
        false,
      );
      expect(sx).toBeGreaterThan(0);
      expect(sy).toBeGreaterThan(0);
    });

    it("flips Y when top-left corner crosses below anchor", () => {
      const anchorPoint = { x: 200, y: 100 };
      const currentPos = { x: 80, y: 50 };
      const { sx, sy } = commands.calculateScaleFactors(
        "top-left",
        currentPos,
        anchorPoint,
        initialBounds,
        false,
      );
      expect(sx).toBeGreaterThan(0);
      expect(sy).toBeLessThan(0);
    });

    it("flips X when left corner crosses right of anchor", () => {
      const anchorPoint = { x: 200, y: 150 };
      const currentPos = { x: 250, y: 150 };
      const { sx, sy } = commands.calculateScaleFactors(
        "left",
        currentPos,
        anchorPoint,
        initialBounds,
        false,
      );
      expect(sx).toBeLessThan(0);
      expect(sy).toBeCloseTo(1.0);
    });
  });

  describe("corner resize scaling preserves relative positions", () => {
    const mockEditor = {
      createToolContext: vi.fn(),
    } as any;

    let commands: SelectCommands;

    beforeEach(() => {
      commands = new SelectCommands(mockEditor);
    });

    it("point at anchor corner stays fixed during scale", () => {
      const initialBounds: Rect2D = {
        x: 100,
        y: 100,
        width: 100,
        height: 100,
        left: 100,
        right: 200,
        top: 100,
        bottom: 200,
      };

      const anchor = commands.getAnchorPointForEdge("bottom-right", initialBounds);
      const { sx, sy } = commands.calculateScaleFactors(
        "bottom-right",
        { x: 250, y: 250 },
        anchor,
        initialBounds,
        false,
      );

      const pointAtAnchor = { x: anchor.x, y: anchor.y };
      const newX = anchor.x + (pointAtAnchor.x - anchor.x) * sx;
      const newY = anchor.y + (pointAtAnchor.y - anchor.y) * sy;

      expect(newX).toBeCloseTo(anchor.x);
      expect(newY).toBeCloseTo(anchor.y);
    });

    it("point at dragged corner moves to new position", () => {
      const initialBounds: Rect2D = {
        x: 100,
        y: 100,
        width: 100,
        height: 100,
        left: 100,
        right: 200,
        top: 100,
        bottom: 200,
      };

      const anchor = commands.getAnchorPointForEdge("bottom-right", initialBounds);
      const draggedCorner = { x: 200, y: 100 };
      const newPos = { x: 250, y: 50 };

      const { sx, sy } = commands.calculateScaleFactors(
        "bottom-right",
        newPos,
        anchor,
        initialBounds,
        false,
      );

      const newX = anchor.x + (draggedCorner.x - anchor.x) * sx;
      const newY = anchor.y + (draggedCorner.y - anchor.y) * sy;

      expect(newX).toBeCloseTo(newPos.x);
      expect(newY).toBeCloseTo(newPos.y);
    });
  });
});
