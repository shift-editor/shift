import { scenePoint, screenPoint, type SceneBounds } from "@shift/editor/spaces";
import { describe, it, expect, beforeEach } from "vitest";
import { Camera } from "@shift/editor/testing";
import type { Rect2D } from "@shift/geo";

/** Scene bounds from their smallest and largest corners. */
function sceneBounds(minX: number, minY: number, maxX: number, maxY: number): SceneBounds {
  return { min: scenePoint(minX, minY), max: scenePoint(maxX, maxY) };
}

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
  });

  describe("initialization", () => {
    it("should initialize with default values", () => {
      expect(camera.zoomLevel).toBe(1);
      expect(camera.pan).toEqual({ x: 0, y: 0 });
    });

    it("uses one screen pixel per scene unit at zoom 1", () => {
      const start = camera.sceneToScreen(scenePoint(0, 0));
      const end = camera.sceneToScreen(scenePoint(1, 0));

      expect(end.x - start.x).toBe(1);
    });
  });

  describe("coordinate projections", () => {
    it("should project screen to UPM", () => {
      const screenPos = { x: 500, y: 400 };
      const upm = camera.screenToScene(screenPoint(screenPos.x, screenPos.y));
      expect(upm.x).toBeDefined();
      expect(upm.y).toBeDefined();
      expect(typeof upm.x).toBe("number");
      expect(typeof upm.y).toBe("number");
    });

    it("should project UPM to screen", () => {
      const upmPos = { x: 0, y: 0 };
      const screen = camera.sceneToScreen(scenePoint(upmPos.x, upmPos.y));
      expect(screen.x).toBeDefined();
      expect(screen.y).toBeDefined();
      expect(typeof screen.x).toBe("number");
      expect(typeof screen.y).toBe("number");
    });

    it("should round-trip screen → UPM → screen", () => {
      const screenX = 500;
      const screenY = 400;

      const upm = camera.screenToScene(screenPoint(screenX, screenY));
      const screen = camera.sceneToScreen(scenePoint(upm.x, upm.y));

      expect(screen.x).toBeCloseTo(screenX, 0);
      expect(screen.y).toBeCloseTo(screenY, 0);
    });

    it("should round-trip UPM → screen → UPM", () => {
      const upmX = 100;
      const upmY = 200;

      const screen = camera.sceneToScreen(scenePoint(upmX, upmY));
      const upm = camera.screenToScene(screenPoint(screen.x, screen.y));

      expect(upm.x).toBeCloseTo(upmX, 0);
      expect(upm.y).toBeCloseTo(upmY, 0);
    });
  });

  describe("pan", () => {
    it("should update pan values", () => {
      camera.setPan({ x: 100, y: 50 });
      expect(camera.pan).toEqual({ x: 100, y: 50 });
    });

    it("should affect screen to UPM projection", () => {
      const screenPos = { x: 500, y: 400 };
      const upmBefore = camera.screenToScene(screenPoint(screenPos.x, screenPos.y));

      camera.setPan({ x: 100, y: 50 });

      const upmAfter = camera.screenToScene(screenPoint(screenPos.x, screenPos.y));
      expect(upmAfter.x).not.toBeCloseTo(upmBefore.x, 0);
      expect(upmAfter.y).not.toBeCloseTo(upmBefore.y, 0);
    });

    it("should expose pan as Point2D", () => {
      camera.setPan({ x: 100, y: 50 });
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
      const upmBefore = camera.screenToScene(screenPoint(screenX, screenY));

      camera.zoomToPoint(screenPoint(screenX, screenY), 2.0);

      const upmAfter = camera.screenToScene(screenPoint(screenX, screenY));
      expect(upmAfter.x).toBeCloseTo(upmBefore.x, -1);
      expect(upmAfter.y).toBeCloseTo(upmBefore.y, -1);
    });

    it("should maintain UPM coordinate when zooming out", () => {
      camera.zoomToPoint(screenPoint(500, 400), 2.0);

      const screenX = 500;
      const screenY = 400;
      const upmBefore = camera.screenToScene(screenPoint(screenX, screenY));

      camera.zoomToPoint(screenPoint(screenX, screenY), 0.5);

      const upmAfter = camera.screenToScene(screenPoint(screenX, screenY));
      expect(upmAfter.x).toBeCloseTo(upmBefore.x, -1);
      expect(upmAfter.y).toBeCloseTo(upmBefore.y, -1);
    });

    it("should clamp zoom to valid range", () => {
      camera.zoomToPoint(screenPoint(500, 400), 1000);
      expect(camera.zoomLevel).toBeLessThanOrEqual(32);

      camera.zoomToPoint(screenPoint(500, 400), 0.00001);
      expect(camera.zoomLevel).toBeGreaterThanOrEqual(0.01);
    });

    it("should handle zoom at different zoom levels", () => {
      camera.zoomToPoint(screenPoint(500, 400), 1.5);
      expect(camera.zoomLevel).toBeGreaterThan(1);

      const upmBefore = camera.screenToScene(screenPoint(500, 400));
      camera.zoomToPoint(screenPoint(500, 400), 1.5);
      const upmAfter = camera.screenToScene(screenPoint(500, 400));

      expect(upmAfter.x).toBeCloseTo(upmBefore.x, -1);
      expect(upmAfter.y).toBeCloseTo(upmBefore.y, -1);
    });
  });

  describe("fitting scene bounds", () => {
    it("centres the bounds and fits them inside the viewport", () => {
      const bounds = sceneBounds(50, -100, 250, 300);
      camera.setPan({ x: 125, y: -75 });

      camera.fitToBounds(bounds);

      const centre = camera.sceneToScreen(scenePoint(150, 100));
      const min = camera.sceneToScreen(bounds.min);
      const max = camera.sceneToScreen(bounds.max);
      expect(camera.zoomLevel).toBe(1.7);
      expect(centre).toEqual(camera.centre);
      expect(Math.abs(max.x - min.x)).toBeCloseTo(340);
      expect(Math.abs(max.y - min.y)).toBeCloseTo(680);
    });

    it("refits initial bounds on resize until manual camera movement", () => {
      const bounds = sceneBounds(0, -100, 200, 300);
      camera.fitInitialBounds(bounds);

      camera.setRect({ width: 600, height: 600 } as Rect2D);
      expect(camera.zoomLevel).toBe(1.275);
      expect(camera.sceneToScreen(scenePoint(100, 100))).toEqual(camera.centre);

      camera.setPan({ x: camera.pan.x + 10, y: camera.pan.y });
      camera.setRect({ width: 1200, height: 1000 } as Rect2D);
      expect(camera.zoomLevel).toBe(1.275);
    });

    it("replaces initial framing when the displayed content changes", () => {
      camera.fitInitialBounds(sceneBounds(0, 0, 200, 400));
      camera.fitInitialBounds(sceneBounds(200, 100, 600, 300));

      expect(camera.zoomLevel).toBe(2.125);
      expect(camera.sceneToScreen(scenePoint(400, 200))).toEqual(camera.centre);
    });

    it("clamps the padded fit scale to the supported zoom range", () => {
      camera.fitToBounds(sceneBounds(0, 0, 1_000_000, 1_000_000));

      expect(camera.zoomLevel).toBe(0.01);
    });

    it("ignores non-finite bounds", () => {
      camera.fitToBounds(sceneBounds(0, 0, Number.NaN, 400));

      expect(camera.zoomLevel).toBe(1);
    });
  });

  describe("zoomToPoint cursor stability", () => {
    it("should keep UPM coordinate stable under cursor during zoom in", () => {
      const screenX = 700;
      const screenY = 300;
      const upmBefore = camera.screenToScene(screenPoint(screenX, screenY));

      camera.zoomToPoint(screenPoint(screenX, screenY), 1.5);

      const upmAfter = camera.screenToScene(screenPoint(screenX, screenY));
      expect(upmAfter.x).toBeCloseTo(upmBefore.x, 10);
      expect(upmAfter.y).toBeCloseTo(upmBefore.y, 10);
    });

    it("should keep UPM coordinate stable under cursor during zoom out", () => {
      const screenX = 200;
      const screenY = 600;
      const upmBefore = camera.screenToScene(screenPoint(screenX, screenY));

      camera.zoomToPoint(screenPoint(screenX, screenY), 0.7);

      const upmAfter = camera.screenToScene(screenPoint(screenX, screenY));
      expect(upmAfter.x).toBeCloseTo(upmBefore.x, 10);
      expect(upmAfter.y).toBeCloseTo(upmBefore.y, 10);
    });

    it("should maintain cursor stability through multiple zoom operations", () => {
      const screenX = 400;
      const screenY = 500;
      const upmInitial = camera.screenToScene(screenPoint(screenX, screenY));

      camera.zoomToPoint(screenPoint(screenX, screenY), 1.3);
      camera.zoomToPoint(screenPoint(screenX, screenY), 1.5);
      camera.zoomToPoint(screenPoint(screenX, screenY), 0.8);
      camera.zoomToPoint(screenPoint(screenX, screenY), 1.2);

      const upmFinal = camera.screenToScene(screenPoint(screenX, screenY));
      expect(upmFinal.x).toBeCloseTo(upmInitial.x, 10);
      expect(upmFinal.y).toBeCloseTo(upmInitial.y, 10);
    });

    it("should handle cursor at canvas edges", () => {
      const screenX = 50;
      const screenY = 50;
      const upmBefore = camera.screenToScene(screenPoint(screenX, screenY));

      camera.zoomToPoint(screenPoint(screenX, screenY), 2.0);

      const upmAfter = camera.screenToScene(screenPoint(screenX, screenY));
      expect(upmAfter.x).toBeCloseTo(upmBefore.x, 10);
      expect(upmAfter.y).toBeCloseTo(upmBefore.y, 10);
    });

    it("should work correctly after panning", () => {
      camera.setPan({ x: 100, y: -50 });

      const screenX = 500;
      const screenY = 400;
      const upmBefore = camera.screenToScene(screenPoint(screenX, screenY));

      camera.zoomToPoint(screenPoint(screenX, screenY), 1.5);

      const upmAfter = camera.screenToScene(screenPoint(screenX, screenY));
      expect(upmAfter.x).toBeCloseTo(upmBefore.x, 10);
      expect(upmAfter.y).toBeCloseTo(upmBefore.y, 10);
    });

    it("keeps an off-centre point fixed across the full zoom range", () => {
      const screen = { x: 723.75, y: 246.25 };
      const scene = camera.screenToScene(screenPoint(screen.x, screen.y));

      for (let index = 0; index < 100; index++)
        camera.zoomToPoint(screenPoint(screen.x, screen.y), 0.8);
      for (let index = 0; index < 100; index++)
        camera.zoomToPoint(screenPoint(screen.x, screen.y), 1.25);

      expect(camera.zoomLevel).toBe(32);
      expect(camera.sceneToScreen(scenePoint(scene.x, scene.y)).x).toBeCloseTo(screen.x, 8);
      expect(camera.sceneToScreen(scenePoint(scene.x, scene.y)).y).toBeCloseTo(screen.y, 8);
    });
  });

  describe("camera state", () => {
    it("should preserve scene projection when the canvas width changes", () => {
      camera.zoomToPoint(screenPoint(500, 400), 32);
      const before = camera.screenToScene(screenPoint(120, 120));

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

      const after = camera.screenToScene(screenPoint(120, 120));
      expect(after.x).toBeCloseTo(before.x, 0);
      expect(after.y).toBeCloseTo(before.y, 0);
    });

    it("should preserve scene projection when the canvas height shrinks", () => {
      camera.zoomToPoint(screenPoint(500, 400), 32);
      const before = camera.screenToScene(screenPoint(120, 120));

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

      const after = camera.screenToScene(screenPoint(120, 120));
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

  describe("visible scene bounds", () => {
    it("covers the canvas plus the margin, undone through pan and zoom", () => {
      camera.setZoom(2);
      camera.setPan({ x: 100, y: 50 });

      const visible = camera.visibleSceneBounds(10);

      expect(visible).toMatchObject({ minX: -55, minY: -30, maxX: 455, maxY: 380 });
    });
  });

  describe("centre point", () => {
    it("should return canvas centre point", () => {
      const centre = camera.centre;
      expect(centre.x).toBe(500);
      expect(centre.y).toBe(400);
    });
  });

  describe("direct zoom scale", () => {
    it("keeps zoom stable when the live viewport height shrinks", () => {
      const zoom = camera.zoomLevel;

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

      expect(camera.logicalHeight).toBe(380);
      expect(camera.zoomLevel).toBe(zoom);
    });

    it("keeps zoom when the live viewport is very short", () => {
      const zoom = camera.zoomLevel;

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

      expect(camera.zoomLevel).toBe(zoom);
    });

    it("keeps zoom stable when the live viewport height is invalid after layout", () => {
      const zoom = camera.zoomLevel;

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
      expect(camera.zoomLevel).toBe(zoom);
    });
  });

  describe("screenToSceneDistance", () => {
    it("should convert screen distance to UPM at default zoom", () => {
      const screenDistance = 10;
      const upmDistance = camera.screenToSceneDistance(screenDistance);
      expect(upmDistance).toBe(screenDistance);
    });

    it("should account for zoom level", () => {
      const screenDistance = 10;
      const distanceAtZoom1 = camera.screenToSceneDistance(screenDistance);

      camera.zoomToPoint(screenPoint(500, 400), 2.0);

      const distanceAtZoom2 = camera.screenToSceneDistance(screenDistance);
      expect(distanceAtZoom2).toBeCloseTo(distanceAtZoom1 / 2);
    });

    it("should return larger UPM distance when zoomed out", () => {
      const screenDistance = 10;
      const distanceAtZoom1 = camera.screenToSceneDistance(screenDistance);

      camera.zoomToPoint(screenPoint(500, 400), 0.5);

      const distanceAtZoomHalf = camera.screenToSceneDistance(screenDistance);
      expect(distanceAtZoomHalf).toBeCloseTo(distanceAtZoom1 * 2);
    });

    it("should return smaller UPM distance when zoomed in", () => {
      const screenDistance = 10;
      const distanceAtZoom1 = camera.screenToSceneDistance(screenDistance);

      camera.zoomToPoint(screenPoint(500, 400), 4.0);

      const distanceAtZoom4 = camera.screenToSceneDistance(screenDistance);
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

      camera.zoomToPoint(screenPoint(500, 400), 0.5);

      const hitRadiusAtZoomHalf = camera.hitRadius;
      expect(hitRadiusAtZoomHalf).toBeCloseTo(hitRadiusAtZoom1 * 2);
    });

    it("should decrease when zoomed in", () => {
      const hitRadiusAtZoom1 = camera.hitRadius;

      camera.zoomToPoint(screenPoint(500, 400), 2.0);

      const hitRadiusAtZoom2 = camera.hitRadius;
      expect(hitRadiusAtZoom2).toBeCloseTo(hitRadiusAtZoom1 / 2);
    });
  });

  describe("complex scenarios", () => {
    it("should handle zoom then pan", () => {
      const screenPos = { x: 500, y: 400 };
      const upmBefore = camera.screenToScene(screenPoint(screenPos.x, screenPos.y));

      camera.zoomToPoint(screenPoint(screenPos.x, screenPos.y), 1.5);
      const upmAfterZoom = camera.screenToScene(screenPoint(screenPos.x, screenPos.y));

      expect(upmAfterZoom.x).toBeCloseTo(upmBefore.x, -1);
      expect(upmAfterZoom.y).toBeCloseTo(upmBefore.y, -1);

      camera.setPan({ x: 100, y: 50 });
      const upmAfterPan = camera.screenToScene(screenPoint(screenPos.x, screenPos.y));
      expect(upmAfterPan.x).not.toBeCloseTo(upmBefore.x, -1);
    });

    it("should handle multiple zoom operations", () => {
      const screenPos = { x: 500, y: 400 };
      const upmBefore = camera.screenToScene(screenPoint(screenPos.x, screenPos.y));

      camera.zoomToPoint(screenPoint(screenPos.x, screenPos.y), 1.5);
      camera.zoomToPoint(screenPoint(screenPos.x, screenPos.y), 1.5);
      camera.zoomToPoint(screenPoint(screenPos.x, screenPos.y), 0.667);

      const upmAfter = camera.screenToScene(screenPoint(screenPos.x, screenPos.y));
      expect(upmAfter.x).toBeCloseTo(upmBefore.x, -1);
      expect(upmAfter.y).toBeCloseTo(upmBefore.y, -1);
    });

    it("should maintain zoom bounds across operations", () => {
      for (let i = 0; i < 100; i++) {
        camera.zoomToPoint(screenPoint(500, 400), 1.2);
      }
      expect(camera.zoomLevel).toBeLessThanOrEqual(32);

      for (let i = 0; i < 200; i++) {
        camera.zoomToPoint(screenPoint(500, 400), 0.9);
      }
      expect(camera.zoomLevel).toBeGreaterThanOrEqual(0.01);
    });
  });
});
