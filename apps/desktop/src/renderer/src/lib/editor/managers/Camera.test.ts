import { describe, it, expect, beforeEach } from "vitest";
import { Camera } from "./Camera";
import type { Rect2D } from "@shift/geo";

describe("Camera", () => {
  let camera: Camera;

  beforeEach(() => {
    camera = new Camera();
    camera.setRect({
      x: 0,
      y: 0,
      width: 1000,
      height: 800,
      left: 0,
      top: 0,
      right: 1000,
      bottom: 800,
    } as Rect2D);
    camera.upm = 1000;
    camera.descender = -200;
  });

  describe("initialization", () => {
    it("should initialize with default values", () => {
      expect(camera.zoomLevel).toBe(1);
      expect(camera.panX).toBe(0);
      expect(camera.panY).toBe(0);
      expect(camera.upm).toBe(1000);
      expect(camera.descender).toBe(-200);
    });

    it("should have valid upmScale", () => {
      const scale = camera.upmScale;
      expect(scale).toBeGreaterThan(0);
    });
  });

  describe("coordinate projections", () => {
    it("should project screen to UPM", () => {
      const screenPos = { x: 500, y: 400 };
      const upm = camera.projectScreenToScene(screenPos.x, screenPos.y);
      expect(upm.x).toBeDefined();
      expect(upm.y).toBeDefined();
      expect(typeof upm.x).toBe("number");
      expect(typeof upm.y).toBe("number");
    });

    it("should project UPM to screen", () => {
      const upmPos = { x: 0, y: 0 };
      const screen = camera.projectSceneToScreen(upmPos.x, upmPos.y);
      expect(screen.x).toBeDefined();
      expect(screen.y).toBeDefined();
      expect(typeof screen.x).toBe("number");
      expect(typeof screen.y).toBe("number");
    });

    it("should round-trip screen → UPM → screen", () => {
      const screenX = 500;
      const screenY = 400;

      const upm = camera.projectScreenToScene(screenX, screenY);
      const screen = camera.projectSceneToScreen(upm.x, upm.y);

      expect(screen.x).toBeCloseTo(screenX, 0);
      expect(screen.y).toBeCloseTo(screenY, 0);
    });

    it("should round-trip UPM → screen → UPM", () => {
      const upmX = 100;
      const upmY = 200;

      const screen = camera.projectSceneToScreen(upmX, upmY);
      const upm = camera.projectScreenToScene(screen.x, screen.y);

      expect(upm.x).toBeCloseTo(upmX, 0);
      expect(upm.y).toBeCloseTo(upmY, 0);
    });
  });

  describe("pan", () => {
    it("should update pan values", () => {
      camera.setPan(100, 50);
      expect(camera.panX).toBe(100);
      expect(camera.panY).toBe(50);
    });

    it("should affect screen to UPM projection", () => {
      const screenPos = { x: 500, y: 400 };
      const upmBefore = camera.projectScreenToScene(screenPos.x, screenPos.y);

      camera.setPan(100, 50);

      const upmAfter = camera.projectScreenToScene(screenPos.x, screenPos.y);
      expect(upmAfter.x).not.toBeCloseTo(upmBefore.x, 0);
      expect(upmAfter.y).not.toBeCloseTo(upmBefore.y, 0);
    });

    it("should expose pan as Point2D", () => {
      camera.setPan(100, 50);
      const pan = camera.pan;
      expect(pan.x).toBe(100);
      expect(pan.y).toBe(50);
    });
  });

  describe("zoom", () => {
    it("should have default zoom of 1", () => {
      expect(camera.zoomLevel).toBe(1);
    });

    it("should zoom in to canvas center", () => {
      const oldZoom = camera.zoomLevel;
      camera.zoomIn();
      expect(camera.zoomLevel).toBeGreaterThan(oldZoom);
    });

    it("should zoom out from canvas center", () => {
      camera.zoomIn();
      const beforeZoomOut = camera.zoomLevel;
      camera.zoomOut();
      expect(camera.zoomLevel).toBeLessThan(beforeZoomOut);
    });

    it("should clamp zoom to valid range", () => {
      // Zoom in to max
      for (let i = 0; i < 50; i++) {
        camera.zoomIn();
      }
      expect(camera.zoomLevel).toBeLessThanOrEqual(32);

      // Zoom out to min
      for (let i = 0; i < 100; i++) {
        camera.zoomOut();
      }
      expect(camera.zoomLevel).toBeGreaterThanOrEqual(0.01);
    });
  });

  describe("zoomToPoint", () => {
    it("should maintain UPM coordinate under cursor when zooming in", () => {
      const screenX = 500;
      const screenY = 400;
      const upmBefore = camera.projectScreenToScene(screenX, screenY);

      camera.zoomToPoint(screenX, screenY, 2.0);

      const upmAfter = camera.projectScreenToScene(screenX, screenY);
      expect(upmAfter.x).toBeCloseTo(upmBefore.x, -1);
      expect(upmAfter.y).toBeCloseTo(upmBefore.y, -1);
    });

    it("should maintain UPM coordinate when zooming out", () => {
      camera.zoomToPoint(500, 400, 2.0);

      const screenX = 500;
      const screenY = 400;
      const upmBefore = camera.projectScreenToScene(screenX, screenY);

      camera.zoomToPoint(screenX, screenY, 0.5);

      const upmAfter = camera.projectScreenToScene(screenX, screenY);
      expect(upmAfter.x).toBeCloseTo(upmBefore.x, -1);
      expect(upmAfter.y).toBeCloseTo(upmBefore.y, -1);
    });

    it("should clamp zoom to valid range", () => {
      camera.zoomToPoint(500, 400, 1000);
      expect(camera.zoomLevel).toBeLessThanOrEqual(32);

      camera.zoomToPoint(500, 400, 0.00001);
      expect(camera.zoomLevel).toBeGreaterThanOrEqual(0.01);
    });

    it("should handle zoom at different zoom levels", () => {
      camera.zoomToPoint(500, 400, 1.5);
      expect(camera.zoomLevel).toBeGreaterThan(1);

      const upmBefore = camera.projectScreenToScene(500, 400);
      camera.zoomToPoint(500, 400, 1.5);
      const upmAfter = camera.projectScreenToScene(500, 400);

      expect(upmAfter.x).toBeCloseTo(upmBefore.x, -1);
      expect(upmAfter.y).toBeCloseTo(upmBefore.y, -1);
    });
  });

  describe("zoomToPoint cursor stability", () => {
    it("should keep UPM coordinate stable under cursor during zoom in", () => {
      const screenX = 700;
      const screenY = 300;
      const upmBefore = camera.projectScreenToScene(screenX, screenY);

      camera.zoomToPoint(screenX, screenY, 1.5);

      const upmAfter = camera.projectScreenToScene(screenX, screenY);
      expect(upmAfter.x).toBeCloseTo(upmBefore.x, 0);
      expect(upmAfter.y).toBeCloseTo(upmBefore.y, 0);
    });

    it("should keep UPM coordinate stable under cursor during zoom out", () => {
      const screenX = 200;
      const screenY = 600;
      const upmBefore = camera.projectScreenToScene(screenX, screenY);

      camera.zoomToPoint(screenX, screenY, 0.7);

      const upmAfter = camera.projectScreenToScene(screenX, screenY);
      expect(Math.abs(upmAfter.x - upmBefore.x)).toBeLessThanOrEqual(1);
      expect(Math.abs(upmAfter.y - upmBefore.y)).toBeLessThanOrEqual(1);
    });

    it("should maintain cursor stability through multiple zoom operations", () => {
      const screenX = 400;
      const screenY = 500;
      const upmInitial = camera.projectScreenToScene(screenX, screenY);

      camera.zoomToPoint(screenX, screenY, 1.3);
      camera.zoomToPoint(screenX, screenY, 1.5);
      camera.zoomToPoint(screenX, screenY, 0.8);
      camera.zoomToPoint(screenX, screenY, 1.2);

      const upmFinal = camera.projectScreenToScene(screenX, screenY);
      expect(upmFinal.x).toBeCloseTo(upmInitial.x, 0);
      expect(upmFinal.y).toBeCloseTo(upmInitial.y, 0);
    });

    it("should handle cursor at canvas edges", () => {
      const screenX = 50;
      const screenY = 50;
      const upmBefore = camera.projectScreenToScene(screenX, screenY);

      camera.zoomToPoint(screenX, screenY, 2.0);

      const upmAfter = camera.projectScreenToScene(screenX, screenY);
      expect(upmAfter.x).toBeCloseTo(upmBefore.x, 0);
      expect(upmAfter.y).toBeCloseTo(upmBefore.y, 0);
    });

    it("should work correctly after panning", () => {
      camera.setPan(100, -50);

      const screenX = 500;
      const screenY = 400;
      const upmBefore = camera.projectScreenToScene(screenX, screenY);

      camera.zoomToPoint(screenX, screenY, 1.5);

      const upmAfter = camera.projectScreenToScene(screenX, screenY);
      expect(upmAfter.x).toBeCloseTo(upmBefore.x, 0);
      expect(upmAfter.y).toBeCloseTo(upmBefore.y, 0);
    });
  });

  describe("camera state", () => {
    it("should update UPM", () => {
      camera.upm = 2000;
      expect(camera.upm).toBe(2000);
    });

    it("should update descender", () => {
      camera.descender = -250;
      expect(camera.descender).toBe(-250);
    });

    it("should invalidate matrices when UPM changes", () => {
      const screenPos = { x: 500, y: 400 };
      const upmBefore = camera.projectScreenToScene(screenPos.x, screenPos.y);

      camera.upm = 2000;

      const upmAfter = camera.projectScreenToScene(screenPos.x, screenPos.y);
      expect(upmAfter.x).not.toBeCloseTo(upmBefore.x, 0);
    });

    it("should invalidate matrices when descender changes", () => {
      const screenPos = { x: 500, y: 400 };
      const upmBefore = camera.projectScreenToScene(screenPos.x, screenPos.y);

      camera.descender = -300;

      const upmAfter = camera.projectScreenToScene(screenPos.x, screenPos.y);
      expect(upmAfter.y).not.toBeCloseTo(upmBefore.y, 0);
    });

    it("should preserve scene projection when the canvas width changes", () => {
      camera.zoomToPoint(500, 400, 32);
      const before = camera.projectScreenToScene(120, 120);

      camera.setRect({
        x: 0,
        y: 0,
        width: 800,
        height: 800,
        left: 0,
        top: 0,
        right: 800,
        bottom: 800,
      } as Rect2D);

      const after = camera.projectScreenToScene(120, 120);
      expect(after.x).toBeCloseTo(before.x, 0);
      expect(after.y).toBeCloseTo(before.y, 0);
    });

    it("should preserve scene projection when the canvas height shrinks", () => {
      camera.zoomToPoint(500, 400, 32);
      const before = camera.projectScreenToScene(120, 120);

      camera.setRect({
        x: 0,
        y: 0,
        width: 1000,
        height: 380,
        left: 0,
        top: 0,
        right: 1000,
        bottom: 380,
      } as Rect2D);

      const after = camera.projectScreenToScene(120, 120);
      expect(after.x).toBeCloseTo(before.x, 0);
      expect(after.y).toBeCloseTo(before.y, 0);
    });
  });

  describe("mouse position", () => {
    it("should update and get screen mouse position", () => {
      camera.updateMousePosition(150, 250);
      camera.flushMousePosition();
      const pos = camera.getScreenMousePosition();
      expect(pos.x).toBe(150);
      expect(pos.y).toBe(250);
    });

    it("should compute UPM mouse position from screen position", () => {
      camera.updateMousePosition(500, 400);
      camera.flushMousePosition();
      const upmPos = camera.mousePosition;
      expect(typeof upmPos.x).toBe("number");
      expect(typeof upmPos.y).toBe("number");
    });
  });

  describe("centre point", () => {
    it("should return canvas centre point", () => {
      const centre = camera.centre;
      expect(centre.x).toBe(500);
      expect(centre.y).toBe(400);
    });
  });

  describe("upmScale", () => {
    it("should calculate correct scale factor", () => {
      const scale = camera.upmScale;
      const expectedHeight = camera.layoutHeight - 2 * camera.padding;
      const expectedScale = expectedHeight / camera.upm;
      expect(scale).toBeCloseTo(expectedScale);
    });

    it("should keep scale and padding stable when the live viewport height shrinks", () => {
      const scale = camera.upmScale;
      const padding = camera.padding;

      camera.setRect({
        x: 0,
        y: 0,
        width: 1000,
        height: 380,
        left: 0,
        top: 0,
        right: 1000,
        bottom: 380,
      } as Rect2D);

      expect(camera.layoutHeight).toBe(800);
      expect(camera.logicalHeight).toBe(380);
      expect(camera.padding).toBe(padding);
      expect(camera.upmScale).toBeCloseTo(scale);
    });

    it("should keep scale when the live viewport is shorter than fixed padding", () => {
      const scale = camera.upmScale;
      const padding = camera.padding;

      camera.setRect({
        x: 0,
        y: 0,
        width: 1000,
        height: 180,
        left: 0,
        top: 0,
        right: 1000,
        bottom: 180,
      } as Rect2D);

      expect(camera.padding).toBe(padding);
      expect(camera.upmScale).toBeCloseTo(scale);
    });

    it("should keep scale stable when the live viewport height is invalid after layout", () => {
      const scale = camera.upmScale;

      camera.setRect({
        x: 0,
        y: 0,
        width: 1000,
        height: 0,
        left: 0,
        top: 0,
        right: 1000,
        bottom: 0,
      } as Rect2D);
      expect(camera.upmScale).toBeCloseTo(scale);
    });
  });

  describe("screenToUpmDistance", () => {
    it("should convert screen distance to UPM at default zoom", () => {
      const screenDistance = 10;
      const upmDistance = camera.screenToUpmDistance(screenDistance);
      const expectedDistance = screenDistance / camera.upmScale;
      expect(upmDistance).toBeCloseTo(expectedDistance);
    });

    it("should account for zoom level", () => {
      const screenDistance = 10;
      const distanceAtZoom1 = camera.screenToUpmDistance(screenDistance);

      camera.zoomToPoint(500, 400, 2.0);

      const distanceAtZoom2 = camera.screenToUpmDistance(screenDistance);
      expect(distanceAtZoom2).toBeCloseTo(distanceAtZoom1 / 2);
    });

    it("should return larger UPM distance when zoomed out", () => {
      const screenDistance = 10;
      const distanceAtZoom1 = camera.screenToUpmDistance(screenDistance);

      camera.zoomToPoint(500, 400, 0.5);

      const distanceAtZoomHalf = camera.screenToUpmDistance(screenDistance);
      expect(distanceAtZoomHalf).toBeCloseTo(distanceAtZoom1 * 2);
    });

    it("should return smaller UPM distance when zoomed in", () => {
      const screenDistance = 10;
      const distanceAtZoom1 = camera.screenToUpmDistance(screenDistance);

      camera.zoomToPoint(500, 400, 4.0);

      const distanceAtZoom4 = camera.screenToUpmDistance(screenDistance);
      expect(distanceAtZoom4).toBeCloseTo(distanceAtZoom1 / 4);
    });
  });

  describe("hitRadius", () => {
    it("should return a computed hit radius based on zoom", () => {
      const hitRadius = camera.hitRadius;
      expect(hitRadius).toBeGreaterThan(0);
    });

    it("should increase when zoomed out", () => {
      const hitRadiusAtZoom1 = camera.hitRadius;

      camera.zoomToPoint(500, 400, 0.5);

      const hitRadiusAtZoomHalf = camera.hitRadius;
      expect(hitRadiusAtZoomHalf).toBeCloseTo(hitRadiusAtZoom1 * 2);
    });

    it("should decrease when zoomed in", () => {
      const hitRadiusAtZoom1 = camera.hitRadius;

      camera.zoomToPoint(500, 400, 2.0);

      const hitRadiusAtZoom2 = camera.hitRadius;
      expect(hitRadiusAtZoom2).toBeCloseTo(hitRadiusAtZoom1 / 2);
    });
  });

  describe("complex scenarios", () => {
    it("should handle zoom then pan", () => {
      const screenPos = { x: 500, y: 400 };
      const upmBefore = camera.projectScreenToScene(screenPos.x, screenPos.y);

      camera.zoomToPoint(screenPos.x, screenPos.y, 1.5);
      const upmAfterZoom = camera.projectScreenToScene(screenPos.x, screenPos.y);

      expect(upmAfterZoom.x).toBeCloseTo(upmBefore.x, -1);
      expect(upmAfterZoom.y).toBeCloseTo(upmBefore.y, -1);

      camera.setPan(100, 50);
      const upmAfterPan = camera.projectScreenToScene(screenPos.x, screenPos.y);
      expect(upmAfterPan.x).not.toBeCloseTo(upmBefore.x, -1);
    });

    it("should handle multiple zoom operations", () => {
      const screenPos = { x: 500, y: 400 };
      const upmBefore = camera.projectScreenToScene(screenPos.x, screenPos.y);

      camera.zoomToPoint(screenPos.x, screenPos.y, 1.5);
      camera.zoomToPoint(screenPos.x, screenPos.y, 1.5);
      camera.zoomToPoint(screenPos.x, screenPos.y, 0.667);

      const upmAfter = camera.projectScreenToScene(screenPos.x, screenPos.y);
      expect(upmAfter.x).toBeCloseTo(upmBefore.x, -1);
      expect(upmAfter.y).toBeCloseTo(upmBefore.y, -1);
    });

    it("should maintain zoom bounds across operations", () => {
      for (let i = 0; i < 100; i++) {
        camera.zoomToPoint(500, 400, 1.2);
      }
      expect(camera.zoomLevel).toBeLessThanOrEqual(32);

      for (let i = 0; i < 200; i++) {
        camera.zoomToPoint(500, 400, 0.9);
      }
      expect(camera.zoomLevel).toBeGreaterThanOrEqual(0.01);
    });
  });
});
