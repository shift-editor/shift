import { describe, it, expect, beforeEach } from "vitest";
import { ViewportManager } from "./ViewportManager";
import type { Rect2D } from "@shift/types";

describe("ViewportManager", () => {
  let viewport: ViewportManager;

  beforeEach(() => {
    viewport = new ViewportManager();
    viewport.setRect({
      x: 0,
      y: 0,
      width: 1000,
      height: 800,
      left: 0,
      top: 0,
      right: 1000,
      bottom: 800,
    } as Rect2D);
    viewport.upm = 1000;
    viewport.descender = -200;
  });

  describe("initialization", () => {
    it("should initialize with default values", () => {
      expect(viewport.zoomLevel).toBe(1);
      expect(viewport.panX).toBe(0);
      expect(viewport.panY).toBe(0);
      expect(viewport.upm).toBe(1000);
      expect(viewport.descender).toBe(-200);
    });

    it("should have valid upmScale", () => {
      const scale = viewport.upmScale;
      expect(scale).toBeGreaterThan(0);
    });
  });

  describe("coordinate projections", () => {
    it("should project screen to UPM", () => {
      const screenPos = { x: 500, y: 400 };
      const upm = viewport.projectScreenToUpm(screenPos.x, screenPos.y);
      expect(upm.x).toBeDefined();
      expect(upm.y).toBeDefined();
      expect(typeof upm.x).toBe("number");
      expect(typeof upm.y).toBe("number");
    });

    it("should project UPM to screen", () => {
      const upmPos = { x: 0, y: 0 };
      const screen = viewport.projectUpmToScreen(upmPos.x, upmPos.y);
      expect(screen.x).toBeDefined();
      expect(screen.y).toBeDefined();
      expect(typeof screen.x).toBe("number");
      expect(typeof screen.y).toBe("number");
    });

    it("should round-trip screen → UPM → screen", () => {
      const screenX = 500;
      const screenY = 400;

      const upm = viewport.projectScreenToUpm(screenX, screenY);
      const screen = viewport.projectUpmToScreen(upm.x, upm.y);

      expect(screen.x).toBeCloseTo(screenX, 0);
      expect(screen.y).toBeCloseTo(screenY, 0);
    });

    it("should round-trip UPM → screen → UPM", () => {
      const upmX = 100;
      const upmY = 200;

      const screen = viewport.projectUpmToScreen(upmX, upmY);
      const upm = viewport.projectScreenToUpm(screen.x, screen.y);

      expect(upm.x).toBeCloseTo(upmX, 0);
      expect(upm.y).toBeCloseTo(upmY, 0);
    });
  });

  describe("pan", () => {
    it("should update pan values", () => {
      viewport.setPan(100, 50);
      expect(viewport.panX).toBe(100);
      expect(viewport.panY).toBe(50);
    });

    it("should affect screen to UPM projection", () => {
      const screenPos = { x: 500, y: 400 };
      const upmBefore = viewport.projectScreenToUpm(screenPos.x, screenPos.y);

      viewport.setPan(100, 50);

      const upmAfter = viewport.projectScreenToUpm(screenPos.x, screenPos.y);
      expect(upmAfter.x).not.toBeCloseTo(upmBefore.x, 0);
      expect(upmAfter.y).not.toBeCloseTo(upmBefore.y, 0);
    });

    it("should expose pan as Point2D", () => {
      viewport.setPan(100, 50);
      const pan = viewport.pan;
      expect(pan.x).toBe(100);
      expect(pan.y).toBe(50);
    });
  });

  describe("zoom", () => {
    it("should have default zoom of 1", () => {
      expect(viewport.zoomLevel).toBe(1);
    });

    it("should zoom in to canvas center", () => {
      const oldZoom = viewport.zoomLevel;
      viewport.zoomIn();
      expect(viewport.zoomLevel).toBeGreaterThan(oldZoom);
    });

    it("should zoom out from canvas center", () => {
      viewport.zoomIn();
      const beforeZoomOut = viewport.zoomLevel;
      viewport.zoomOut();
      expect(viewport.zoomLevel).toBeLessThan(beforeZoomOut);
    });

    it("should clamp zoom to valid range", () => {
      // Zoom in to max
      for (let i = 0; i < 50; i++) {
        viewport.zoomIn();
      }
      expect(viewport.zoomLevel).toBeLessThanOrEqual(32);

      // Zoom out to min
      for (let i = 0; i < 100; i++) {
        viewport.zoomOut();
      }
      expect(viewport.zoomLevel).toBeGreaterThanOrEqual(0.01);
    });
  });

  describe("zoomToPoint", () => {
    it("should maintain UPM coordinate under cursor when zooming in", () => {
      const screenX = 500;
      const screenY = 400;
      const upmBefore = viewport.projectScreenToUpm(screenX, screenY);

      viewport.zoomToPoint(screenX, screenY, 2.0);

      const upmAfter = viewport.projectScreenToUpm(screenX, screenY);
      expect(upmAfter.x).toBeCloseTo(upmBefore.x, -1);
      expect(upmAfter.y).toBeCloseTo(upmBefore.y, -1);
    });

    it("should maintain UPM coordinate when zooming out", () => {
      viewport.zoomToPoint(500, 400, 2.0);

      const screenX = 500;
      const screenY = 400;
      const upmBefore = viewport.projectScreenToUpm(screenX, screenY);

      viewport.zoomToPoint(screenX, screenY, 0.5);

      const upmAfter = viewport.projectScreenToUpm(screenX, screenY);
      expect(upmAfter.x).toBeCloseTo(upmBefore.x, -1);
      expect(upmAfter.y).toBeCloseTo(upmBefore.y, -1);
    });

    it("should clamp zoom to valid range", () => {
      viewport.zoomToPoint(500, 400, 1000);
      expect(viewport.zoomLevel).toBeLessThanOrEqual(32);

      viewport.zoomToPoint(500, 400, 0.00001);
      expect(viewport.zoomLevel).toBeGreaterThanOrEqual(0.01);
    });

    it("should handle zoom at different zoom levels", () => {
      viewport.zoomToPoint(500, 400, 1.5);
      expect(viewport.zoomLevel).toBeGreaterThan(1);

      const upmBefore = viewport.projectScreenToUpm(500, 400);
      viewport.zoomToPoint(500, 400, 1.5);
      const upmAfter = viewport.projectScreenToUpm(500, 400);

      expect(upmAfter.x).toBeCloseTo(upmBefore.x, -1);
      expect(upmAfter.y).toBeCloseTo(upmBefore.y, -1);
    });
  });

  describe("zoomToPoint cursor stability", () => {
    it("should keep UPM coordinate stable under cursor during zoom in", () => {
      const screenX = 700;
      const screenY = 300;
      const upmBefore = viewport.projectScreenToUpm(screenX, screenY);

      viewport.zoomToPoint(screenX, screenY, 1.5);

      const upmAfter = viewport.projectScreenToUpm(screenX, screenY);
      expect(upmAfter.x).toBeCloseTo(upmBefore.x, 0);
      expect(upmAfter.y).toBeCloseTo(upmBefore.y, 0);
    });

    it("should keep UPM coordinate stable under cursor during zoom out", () => {
      const screenX = 200;
      const screenY = 600;
      const upmBefore = viewport.projectScreenToUpm(screenX, screenY);

      viewport.zoomToPoint(screenX, screenY, 0.7);

      const upmAfter = viewport.projectScreenToUpm(screenX, screenY);
      expect(Math.abs(upmAfter.x - upmBefore.x)).toBeLessThanOrEqual(1);
      expect(Math.abs(upmAfter.y - upmBefore.y)).toBeLessThanOrEqual(1);
    });

    it("should maintain cursor stability through multiple zoom operations", () => {
      const screenX = 400;
      const screenY = 500;
      const upmInitial = viewport.projectScreenToUpm(screenX, screenY);

      viewport.zoomToPoint(screenX, screenY, 1.3);
      viewport.zoomToPoint(screenX, screenY, 1.5);
      viewport.zoomToPoint(screenX, screenY, 0.8);
      viewport.zoomToPoint(screenX, screenY, 1.2);

      const upmFinal = viewport.projectScreenToUpm(screenX, screenY);
      expect(upmFinal.x).toBeCloseTo(upmInitial.x, 0);
      expect(upmFinal.y).toBeCloseTo(upmInitial.y, 0);
    });

    it("should handle cursor at canvas edges", () => {
      const screenX = 50;
      const screenY = 50;
      const upmBefore = viewport.projectScreenToUpm(screenX, screenY);

      viewport.zoomToPoint(screenX, screenY, 2.0);

      const upmAfter = viewport.projectScreenToUpm(screenX, screenY);
      expect(upmAfter.x).toBeCloseTo(upmBefore.x, 0);
      expect(upmAfter.y).toBeCloseTo(upmBefore.y, 0);
    });

    it("should work correctly after panning", () => {
      viewport.setPan(100, -50);

      const screenX = 500;
      const screenY = 400;
      const upmBefore = viewport.projectScreenToUpm(screenX, screenY);

      viewport.zoomToPoint(screenX, screenY, 1.5);

      const upmAfter = viewport.projectScreenToUpm(screenX, screenY);
      expect(upmAfter.x).toBeCloseTo(upmBefore.x, 0);
      expect(upmAfter.y).toBeCloseTo(upmBefore.y, 0);
    });
  });

  describe("viewport state", () => {
    it("should update UPM", () => {
      viewport.upm = 2000;
      expect(viewport.upm).toBe(2000);
    });

    it("should update descender", () => {
      viewport.descender = -250;
      expect(viewport.descender).toBe(-250);
    });

    it("should invalidate matrices when UPM changes", () => {
      const screenPos = { x: 500, y: 400 };
      const upmBefore = viewport.projectScreenToUpm(screenPos.x, screenPos.y);

      viewport.upm = 2000;

      const upmAfter = viewport.projectScreenToUpm(screenPos.x, screenPos.y);
      expect(upmAfter.x).not.toBeCloseTo(upmBefore.x, 0);
    });

    it("should invalidate matrices when descender changes", () => {
      const screenPos = { x: 500, y: 400 };
      const upmBefore = viewport.projectScreenToUpm(screenPos.x, screenPos.y);

      viewport.descender = -300;

      const upmAfter = viewport.projectScreenToUpm(screenPos.x, screenPos.y);
      expect(upmAfter.y).not.toBeCloseTo(upmBefore.y, 0);
    });
  });

  describe("mouse position", () => {
    it("should update and get screen mouse position", () => {
      viewport.updateMousePosition(150, 250);
      viewport.flushMousePosition();
      const pos = viewport.getScreenMousePosition();
      expect(pos.x).toBe(150);
      expect(pos.y).toBe(250);
    });

    it("should compute UPM mouse position from screen position", () => {
      viewport.updateMousePosition(500, 400);
      viewport.flushMousePosition();
      const upmPos = viewport.mousePosition;
      expect(typeof upmPos.x).toBe("number");
      expect(typeof upmPos.y).toBe("number");
    });
  });

  describe("centre point", () => {
    it("should return canvas centre point", () => {
      const centre = viewport.centre;
      expect(centre.x).toBe(500);
      expect(centre.y).toBe(400);
    });
  });

  describe("upmScale", () => {
    it("should calculate correct scale factor", () => {
      const scale = viewport.upmScale;
      const expectedHeight = viewport.logicalHeight - 2 * viewport.padding;
      const expectedScale = expectedHeight / viewport.upm;
      expect(scale).toBeCloseTo(expectedScale);
    });

    it("should return 1 if height is invalid", () => {
      viewport.setRect({
        x: 0,
        y: 0,
        width: 1000,
        height: 0,
        left: 0,
        top: 0,
        right: 1000,
        bottom: 0,
      } as Rect2D);
      expect(viewport.upmScale).toBe(1);
    });
  });

  describe("screenToUpmDistance", () => {
    it("should convert screen distance to UPM at default zoom", () => {
      const screenDistance = 10;
      const upmDistance = viewport.screenToUpmDistance(screenDistance);
      const expectedDistance = screenDistance / viewport.upmScale;
      expect(upmDistance).toBeCloseTo(expectedDistance);
    });

    it("should account for zoom level", () => {
      const screenDistance = 10;
      const distanceAtZoom1 = viewport.screenToUpmDistance(screenDistance);

      viewport.zoomToPoint(500, 400, 2.0);

      const distanceAtZoom2 = viewport.screenToUpmDistance(screenDistance);
      expect(distanceAtZoom2).toBeCloseTo(distanceAtZoom1 / 2);
    });

    it("should return larger UPM distance when zoomed out", () => {
      const screenDistance = 10;
      const distanceAtZoom1 = viewport.screenToUpmDistance(screenDistance);

      viewport.zoomToPoint(500, 400, 0.5);

      const distanceAtZoomHalf = viewport.screenToUpmDistance(screenDistance);
      expect(distanceAtZoomHalf).toBeCloseTo(distanceAtZoom1 * 2);
    });

    it("should return smaller UPM distance when zoomed in", () => {
      const screenDistance = 10;
      const distanceAtZoom1 = viewport.screenToUpmDistance(screenDistance);

      viewport.zoomToPoint(500, 400, 4.0);

      const distanceAtZoom4 = viewport.screenToUpmDistance(screenDistance);
      expect(distanceAtZoom4).toBeCloseTo(distanceAtZoom1 / 4);
    });
  });

  describe("hitRadius", () => {
    it("should return a computed hit radius based on zoom", () => {
      const hitRadius = viewport.hitRadius;
      expect(hitRadius).toBeGreaterThan(0);
    });

    it("should increase when zoomed out", () => {
      const hitRadiusAtZoom1 = viewport.hitRadius;

      viewport.zoomToPoint(500, 400, 0.5);

      const hitRadiusAtZoomHalf = viewport.hitRadius;
      expect(hitRadiusAtZoomHalf).toBeCloseTo(hitRadiusAtZoom1 * 2);
    });

    it("should decrease when zoomed in", () => {
      const hitRadiusAtZoom1 = viewport.hitRadius;

      viewport.zoomToPoint(500, 400, 2.0);

      const hitRadiusAtZoom2 = viewport.hitRadius;
      expect(hitRadiusAtZoom2).toBeCloseTo(hitRadiusAtZoom1 / 2);
    });
  });

  describe("complex scenarios", () => {
    it("should handle zoom then pan", () => {
      const screenPos = { x: 500, y: 400 };
      const upmBefore = viewport.projectScreenToUpm(screenPos.x, screenPos.y);

      viewport.zoomToPoint(screenPos.x, screenPos.y, 1.5);
      const upmAfterZoom = viewport.projectScreenToUpm(screenPos.x, screenPos.y);

      expect(upmAfterZoom.x).toBeCloseTo(upmBefore.x, -1);
      expect(upmAfterZoom.y).toBeCloseTo(upmBefore.y, -1);

      viewport.setPan(100, 50);
      const upmAfterPan = viewport.projectScreenToUpm(screenPos.x, screenPos.y);
      expect(upmAfterPan.x).not.toBeCloseTo(upmBefore.x, -1);
    });

    it("should handle multiple zoom operations", () => {
      const screenPos = { x: 500, y: 400 };
      const upmBefore = viewport.projectScreenToUpm(screenPos.x, screenPos.y);

      viewport.zoomToPoint(screenPos.x, screenPos.y, 1.5);
      viewport.zoomToPoint(screenPos.x, screenPos.y, 1.5);
      viewport.zoomToPoint(screenPos.x, screenPos.y, 0.667);

      const upmAfter = viewport.projectScreenToUpm(screenPos.x, screenPos.y);
      expect(upmAfter.x).toBeCloseTo(upmBefore.x, -1);
      expect(upmAfter.y).toBeCloseTo(upmBefore.y, -1);
    });

    it("should maintain zoom bounds across operations", () => {
      for (let i = 0; i < 100; i++) {
        viewport.zoomToPoint(500, 400, 1.2);
      }
      expect(viewport.zoomLevel).toBeLessThanOrEqual(32);

      for (let i = 0; i < 200; i++) {
        viewport.zoomToPoint(500, 400, 0.9);
      }
      expect(viewport.zoomLevel).toBeGreaterThanOrEqual(0.01);
    });
  });
});
