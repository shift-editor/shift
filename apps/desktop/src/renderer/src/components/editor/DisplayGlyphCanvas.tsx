import { useCallback, useEffect, useRef } from "react";
import { Vec2 } from "@shift/geo";
import type { CatalogMetrics } from "@shift/types";
import { zoomMultiplierFromWheel } from "@/lib/transform";
import { Camera } from "@/lib/editor/managers/Camera";
import { Canvas as DrawingCanvas } from "@/lib/editor/rendering/Canvas";
import { Canvas2DSurface } from "@/lib/editor/rendering/CanvasSurface";
import { DisplayGlyphRenderer } from "@/lib/editor/rendering/DisplayGlyphRenderer";
import { MarkerLayer } from "@/lib/graphics/backends/MarkerLayer";
import type { GlyphRenderInput } from "@/types/glyphRender";

interface DisplayGlyphCanvasProps {
  readonly glyph: GlyphRenderInput;
  readonly metrics: CatalogMetrics;
}

/** Hosts retained glyphs on the same Canvas, marker, and overlay primitives as authored glyphs. */
export const DisplayGlyphCanvas = ({ glyph, metrics }: DisplayGlyphCanvasProps) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const backgroundRef = useRef<HTMLCanvasElement>(null);
  const sceneRef = useRef<HTMLCanvasElement>(null);
  const markerRef = useRef<HTMLCanvasElement>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const cameraRef = useRef(new Camera());
  const markerLayerRef = useRef(new MarkerLayer());
  const rendererRef = useRef(new DisplayGlyphRenderer());
  const frameRef = useRef<number | null>(null);

  const draw = useCallback(() => {
    frameRef.current = null;
    const backgroundElement = backgroundRef.current;
    const sceneElement = sceneRef.current;
    const overlayElement = overlayRef.current;
    if (!backgroundElement || !sceneElement || !overlayElement) return;

    const backgroundSurface = Canvas2DSurface.from(backgroundElement);
    const sceneSurface = Canvas2DSurface.from(sceneElement);
    const overlaySurface = Canvas2DSurface.from(overlayElement);
    const camera = cameraRef.current;
    camera.upm = metrics.unitsPerEm;
    camera.descender = metrics.descender;
    camera.setRect(sceneSurface.rect);

    const cameraTransform = {
      zoom: camera.zoomLevel,
      panX: camera.panX,
      panY: camera.panY,
      centre: camera.centre,
      upmScale: camera.upmScale,
      logicalHeight: camera.logicalHeight,
      layoutHeight: camera.layoutHeight,
      padding: camera.padding,
      descender: camera.descender,
    };
    const markerLayer = markerLayerRef.current;

    const backgroundCanvas = new DrawingCanvas(backgroundSurface.ctx, cameraTransform);
    backgroundSurface.ctx.clearRect(0, 0, backgroundSurface.width, backgroundSurface.height);
    backgroundCanvas.withSceneSpace({ x: 0, y: 0 }, () => {
      rendererRef.current.drawBackground(
        { canvas: backgroundCanvas, markers: markerLayer },
        glyph,
        metrics,
      );
    });

    const sceneCanvas = new DrawingCanvas(sceneSurface.ctx, cameraTransform);
    sceneSurface.ctx.clearRect(0, 0, sceneSurface.width, sceneSurface.height);
    markerLayer.begin();
    try {
      sceneCanvas.withSceneSpace({ x: 0, y: 0 }, () => {
        rendererRef.current.drawScene({ canvas: sceneCanvas, markers: markerLayer }, glyph, {
          x: 0,
          y: 0,
        });
      });
    } finally {
      markerLayer.commit();
    }

    overlaySurface.ctx.clearRect(0, 0, overlaySurface.width, overlaySurface.height);
  }, [glyph, metrics]);

  const scheduleDraw = useCallback(() => {
    if (frameRef.current !== null) return;
    frameRef.current = requestAnimationFrame(draw);
  }, [draw]);

  useEffect(() => {
    scheduleDraw();
  }, [scheduleDraw]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return undefined;

    const observer = new ResizeObserver(scheduleDraw);
    observer.observe(container);

    const handleWheel = (event: WheelEvent) => {
      const camera = cameraRef.current;
      const local = {
        x: event.clientX - container.getBoundingClientRect().left,
        y: event.clientY - container.getBoundingClientRect().top,
      };
      if (event.metaKey || event.ctrlKey) {
        event.preventDefault();
        camera.zoomToPoint(
          local.x,
          local.y,
          zoomMultiplierFromWheel(event.deltaY, event.deltaMode),
        );
      } else {
        const pan = Vec2.sub(camera.pan, { x: event.deltaX, y: event.deltaY });
        camera.setPan(pan.x, pan.y);
      }
      scheduleDraw();
    };

    container.addEventListener("wheel", handleWheel, { passive: false });
    return () => {
      observer.disconnect();
      container.removeEventListener("wheel", handleWheel);
    };
  }, [scheduleDraw]);

  useEffect(
    () => () => {
      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
      markerLayerRef.current.destroy();
    },
    [],
  );

  return (
    <div ref={containerRef} className="relative z-20 h-full w-full overflow-hidden">
      <canvas
        id="background-canvas"
        ref={backgroundRef}
        className="pointer-events-none absolute inset-0 h-full w-full bg-canvas"
      />
      <canvas
        id="scene-canvas"
        ref={sceneRef}
        className="pointer-events-none absolute inset-0 h-full w-full"
      />
      <canvas
        id="marker-canvas"
        ref={markerRef}
        className="pointer-events-none absolute inset-0 h-full w-full"
      />
      <canvas
        id="interactive-canvas"
        ref={overlayRef}
        className="absolute inset-0 h-full w-full touch-none"
      />
    </div>
  );
};
