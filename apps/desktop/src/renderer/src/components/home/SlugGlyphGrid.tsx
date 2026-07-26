import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { GlyphId } from "@shift/types";
import { useEditor } from "@/workspace/WorkspaceContext";
import type { SlugGlyphGridProps, SlugGlyphSelection, SlugPreviewStyle } from "@/types/slug";
import { captureSlugAtlasSections, createSlugAtlasSections } from "@/lib/slug/SlugAtlas";
import { largestSlugBinding, SlugRenderer } from "@/lib/slug/SlugRenderer";
import { GlyphPreviewLayout } from "./GlyphPreviewLayout";

const COPY_ALIGNMENT = 256;
const UPLOAD_CHUNK_BYTES = 4 * 1024 * 1024;
const PREFERRED_ATLAS_BYTES = 256 * 1024 * 1024;
const MAXIMUM_ATLAS_BYTES = 500 * 1024 * 1024;
const REQUIRED_STORAGE_BUFFERS = 18;

/** GPU-resident fill layer; DOM cells remain layout and interaction authority. */
export function SlugGlyphGrid({
  containerRef,
  glyphIds,
  location,
  axes,
  metrics,
  sourceId,
  atlasRevision,
  visible,
  onFirstFrame,
  onUnavailable,
}: SlugGlyphGridProps) {
  const editor = useEditor();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const firstFrameRef = useRef(false);
  const [resident, setResident] = useState<{
    revision: unknown;
    renderer: SlugRenderer;
  } | null>(null);
  const renderer = resident && resident.revision === atlasRevision ? resident.renderer : null;
  const [ready, setReady] = useState(false);

  useEffect(() => {
    firstFrameRef.current = false;
    setReady(false);
    const canvas = canvasRef.current;
    if (!canvas || !navigator.gpu) {
      onUnavailable();
      return undefined;
    }

    const activeCanvas = canvas;
    let cancelled = false;
    let preparedGeneration: number | null = null;
    let streamed = false;
    let pendingDevice: GPUDevice | null = null;
    let pendingAtlasBuffer: GPUBuffer | null = null;
    let currentRenderer: SlugRenderer | null = null;

    async function discardPrepared(): Promise<void> {
      if (streamed || preparedGeneration === null) return;
      const generation = preparedGeneration;
      preparedGeneration = null;
      try {
        await editor.font.editCoordinator.discardSlugAtlas(generation);
      } catch (error) {
        console.error("failed to release rejected Slug atlas", error);
      }
    }

    async function initialize(): Promise<void> {
      try {
        const adapter = await navigator.gpu.requestAdapter({ powerPreference: "high-performance" });
        if (!adapter) throw new Error("WebGPU adapter is unavailable");
        if (adapter.limits.maxStorageBuffersPerShaderStage < REQUIRED_STORAGE_BUFFERS) {
          throw new Error(
            `WebGPU exposes ${adapter.limits.maxStorageBuffersPerShaderStage} storage buffers; ${REQUIRED_STORAGE_BUFFERS} required`,
          );
        }

        const alignment = Math.max(COPY_ALIGNMENT, adapter.limits.minStorageBufferOffsetAlignment);
        const atlas = await editor.font.editCoordinator.prepareSlugAtlas(alignment);
        preparedGeneration = atlas.generation;
        if (cancelled) {
          await discardPrepared();
          return;
        }
        if (atlas.layout.totalLength > MAXIMUM_ATLAS_BYTES) {
          throw new Error(
            `resident Slug atlas is ${atlas.layout.totalLength} bytes; ${MAXIMUM_ATLAS_BYTES} hard maximum`,
          );
        }
        if (atlas.layout.totalLength > adapter.limits.maxBufferSize) {
          throw new Error("resident Slug atlas exceeds this adapter's maximum buffer size");
        }
        const largestBinding = largestSlugBinding(atlas);
        if (largestBinding > adapter.limits.maxStorageBufferBindingSize) {
          throw new Error("resident Slug section exceeds this adapter's storage binding limit");
        }
        if (atlas.layout.totalLength > PREFERRED_ATLAS_BYTES) {
          console.warn("resident Slug atlas exceeds preferred size", {
            bytes: atlas.layout.totalLength,
            preferredBytes: PREFERRED_ATLAS_BYTES,
          });
        }

        const device = await adapter.requestDevice({
          requiredLimits: {
            maxBufferSize: adapter.limits.maxBufferSize,
            maxStorageBufferBindingSize: adapter.limits.maxStorageBufferBindingSize,
            maxStorageBuffersPerShaderStage: REQUIRED_STORAGE_BUFFERS,
          },
        });
        pendingDevice = device;
        if (cancelled) {
          device.destroy();
          pendingDevice = null;
          await discardPrepared();
          return;
        }

        const context = activeCanvas.getContext("webgpu");
        if (!context) throw new Error("WebGPU canvas context is unavailable");
        const format = navigator.gpu.getPreferredCanvasFormat();
        context.configure({ device, format, alphaMode: "premultiplied" });
        const atlasBuffer = device.createBuffer({
          label: "shift Slug resident atlas",
          size: Math.max(4, atlas.layout.totalLength),
          usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
        });
        pendingAtlasBuffer = atlasBuffer;
        const sections = createSlugAtlasSections(atlas);
        const totalLength = await editor.font.editCoordinator.streamSlugAtlas(
          atlas.generation,
          UPLOAD_CHUNK_BYTES,
          (offset, bytes) => {
            if (cancelled) throw new Error("resident Slug upload cancelled");
            device.queue.writeBuffer(atlasBuffer, offset, bytes);
            captureSlugAtlasSections(atlas, sections, offset, bytes);
          },
        );
        streamed = true;
        preparedGeneration = null;
        if (totalLength !== atlas.layout.totalLength) {
          throw new Error(
            `resident Slug stream wrote ${totalLength} bytes; expected ${atlas.layout.totalLength}`,
          );
        }
        if (cancelled) {
          atlasBuffer.destroy();
          device.destroy();
          pendingAtlasBuffer = null;
          pendingDevice = null;
          return;
        }

        device.pushErrorScope("validation");
        const initializedRenderer = new SlugRenderer({
          atlas,
          atlasBuffer,
          sections,
          device,
          context,
          format,
          onDeviceLost: (reason) => {
            if (cancelled) return;
            console.error("resident Slug device lost", reason);
            firstFrameRef.current = false;
            setReady(false);
            setResident(null);
            onUnavailable();
          },
        });
        currentRenderer = initializedRenderer;
        pendingAtlasBuffer = null;
        pendingDevice = null;
        const validationError = await device.popErrorScope();
        if (validationError) throw validationError;
        initializedRenderer.atlasUploadBytes = totalLength;
        if (!cancelled) {
          setResident({ revision: atlasRevision, renderer: initializedRenderer });
        }
      } catch (error) {
        currentRenderer?.destroy();
        pendingAtlasBuffer?.destroy();
        pendingDevice?.destroy();
        pendingAtlasBuffer = null;
        pendingDevice = null;
        await discardPrepared();
        if (!cancelled) {
          console.error("resident Slug initialization failed", error);
          onUnavailable();
        }
      }
    }

    void initialize();
    return () => {
      cancelled = true;
      currentRenderer?.destroy();
      pendingAtlasBuffer?.destroy();
      pendingDevice?.destroy();
      void discardPrepared();
    };
  }, [atlasRevision, editor, onUnavailable]);

  useLayoutEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container || !renderer) return undefined;

    const activeCanvas = canvas;
    const activeContainer = container;
    const activeRenderer = renderer;
    let animationFrame = 0;
    let disposed = false;

    function requestDraw(): void {
      if (animationFrame !== 0) return;
      animationFrame = requestAnimationFrame(draw);
    }

    function draw(): void {
      animationFrame = 0;
      if (disposed) return;

      try {
        activeCanvas.style.height = `${activeContainer.clientHeight}px`;
        const canvasRect = activeCanvas.getBoundingClientRect();
        const ratio = window.devicePixelRatio;
        const width = Math.max(1, Math.round(canvasRect.width * ratio));
        const height = Math.max(1, Math.round(canvasRect.height * ratio));
        if (activeCanvas.width !== width) activeCanvas.width = width;
        if (activeCanvas.height !== height) activeCanvas.height = height;

        const selections = visibleSelections(activeContainer, canvasRect, ratio, sourceId);
        const preview = previewStyle(activeContainer, ratio, metrics);
        activeRenderer.draw({
          weights: activeRenderer.weights(location, axes),
          selections,
          preview,
          viewportWidth: width,
          viewportHeight: height,
        });
        publishDiagnostics(activeCanvas, activeRenderer);
        if (!firstFrameRef.current && selections.length > 0) {
          firstFrameRef.current = true;
          void completeFirstFrame(activeRenderer);
        }
      } catch (error) {
        console.error("resident Slug frame failed", error);
        activeRenderer.destroy();
        firstFrameRef.current = false;
        setReady(false);
        setResident(null);
        onUnavailable();
      }
    }

    async function completeFirstFrame(activeRenderer: SlugRenderer): Promise<void> {
      try {
        await activeRenderer.complete();
        if (disposed) return;
        setReady(true);
        onFirstFrame();
      } catch (error) {
        if (disposed) return;
        console.error("resident Slug first frame failed", error);
        activeRenderer.destroy();
        firstFrameRef.current = false;
        setReady(false);
        setResident(null);
        onUnavailable();
      }
    }

    const observer = new ResizeObserver(requestDraw);
    observer.observe(activeContainer);
    activeContainer.addEventListener("scroll", requestDraw, { passive: true });
    requestDraw();

    return () => {
      disposed = true;
      if (animationFrame !== 0) cancelAnimationFrame(animationFrame);
      observer.disconnect();
      activeContainer.removeEventListener("scroll", requestDraw);
    };
  }, [
    axes,
    containerRef,
    glyphIds,
    location,
    metrics,
    onFirstFrame,
    onUnavailable,
    renderer,
    sourceId,
  ]);

  return (
    <div className="sticky top-0 z-[2] h-0 w-full" aria-hidden="true">
      <canvas
        ref={canvasRef}
        data-slug-ready={ready}
        className="pointer-events-none absolute left-0 top-0 h-[100dvh] w-full"
        style={{ visibility: ready && visible ? "visible" : "hidden" }}
      />
    </div>
  );
}

function visibleSelections(
  container: HTMLElement,
  canvasRect: DOMRect,
  ratio: number,
  sourceId: SlugGlyphSelection["sourceId"],
): SlugGlyphSelection[] {
  const selections: SlugGlyphSelection[] = [];
  const buttons = container.querySelectorAll<HTMLElement>("[data-slug-glyph-id]");
  for (const button of buttons) {
    const glyphId = button.dataset.slugGlyphId as GlyphId | undefined;
    if (!glyphId) continue;

    const rect = button.getBoundingClientRect();
    if (
      rect.bottom <= canvasRect.top ||
      rect.top >= canvasRect.bottom ||
      rect.right <= canvasRect.left ||
      rect.left >= canvasRect.right
    ) {
      continue;
    }
    const style = getComputedStyle(button);
    selections.push({
      glyphId,
      sourceId,
      pixelRect: [
        (rect.left + cssPixels(style.paddingLeft) - canvasRect.left) * ratio,
        (rect.top + cssPixels(style.paddingTop) - canvasRect.top) * ratio,
        (rect.right - cssPixels(style.paddingRight) - canvasRect.left) * ratio,
        (rect.bottom - cssPixels(style.paddingBottom) - canvasRect.top) * ratio,
      ],
    });
  }
  return selections;
}

function previewStyle(
  container: HTMLElement,
  ratio: number,
  metrics: SlugGlyphGridProps["metrics"],
): SlugPreviewStyle {
  const preview = container.querySelector<HTMLElement>("[data-slug-preview]");
  if (!preview) throw new Error("resident Slug preview measurement is unavailable");
  const previewHeight = preview.getBoundingClientRect().height * ratio;
  const [viewHeight, fontTop] = GlyphPreviewLayout.fontViewport(metrics);
  return {
    viewHeight,
    fontTop,
    previewHeight,
    sideMargin: GlyphPreviewLayout.sideMargin(metrics),
    color: cssColor(getComputedStyle(container).color),
  };
}

function cssPixels(value: string): number {
  const pixels = Number.parseFloat(value);
  return Number.isFinite(pixels) ? pixels : 0;
}

function cssColor(value: string): readonly [number, number, number, number] {
  const numbers = value.match(/[\d.]+/g)?.map(Number) ?? [];
  if (numbers.length < 3) return [0, 0, 0, 1];
  return [
    Math.min(255, numbers[0] ?? 0) / 255,
    Math.min(255, numbers[1] ?? 0) / 255,
    Math.min(255, numbers[2] ?? 0) / 255,
    Math.min(1, numbers[3] ?? 1),
  ];
}

function publishDiagnostics(canvas: HTMLCanvasElement, renderer: SlugRenderer): void {
  const diagnostics = renderer.diagnostics;
  canvas.dataset.slugAtlasUploadBytes = String(diagnostics.atlasUploadBytes);
  canvas.dataset.slugResidentBufferBytes = String(diagnostics.residentBufferBytes);
  canvas.dataset.slugScratchBufferBytes = String(diagnostics.scratchBufferBytes);
  canvas.dataset.slugAllocatedBufferBytes = String(diagnostics.allocatedBufferBytes);
  canvas.dataset.slugGeometryUploads = String(diagnostics.geometryUploads);
  canvas.dataset.slugGeometryUploadBytes = String(diagnostics.geometryUploadBytes);
  canvas.dataset.slugWeightUploadBytes = String(diagnostics.weightUploadBytes);
  canvas.dataset.slugInstanceUploadBytes = String(diagnostics.instanceUploadBytes);
  canvas.dataset.slugFrames = String(diagnostics.frames);
  canvas.dataset.slugDeviceLosses = String(diagnostics.deviceLosses);
}
