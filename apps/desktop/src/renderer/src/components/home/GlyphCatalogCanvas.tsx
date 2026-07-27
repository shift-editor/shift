import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { Point2D } from "@shift/geo";
import type { GlyphId } from "@shift/types";
import { GlyphNameInput } from "./GlyphNameInput";
import { GlyphPreviewLayout } from "./GlyphPreviewLayout";
import {
  deriveGlyphCatalogLayout,
  deriveVisibleGlyphCatalogCells,
  hitGlyphCatalogCell,
} from "./glyphCatalogLayout";
import { useEditor } from "@/workspace/WorkspaceContext";
import type { SlugGlyphSelection, SlugPreviewStyle, SlugResidentAtlas } from "@/types/slug";
import type {
  GlyphCatalogCanvasProps,
  GlyphCatalogFrame,
  GlyphCatalogItem,
} from "@/types/glyphCatalog";
import {
  captureSlugAtlasSections,
  createSlugAtlasSections,
  createSlugAtlasSplit,
  writeSlugAtlasChunk,
} from "@/lib/slug/SlugAtlas";
import { SlugRenderer } from "@/lib/slug/SlugRenderer";

const COPY_ALIGNMENT = 256;
const UPLOAD_CHUNK_BYTES = 4 * 1024 * 1024;
const PREFERRED_ATLAS_BYTES = 256 * 1024 * 1024;
const MAXIMUM_ATLAS_BYTES = 500 * 1024 * 1024;
const REQUIRED_STORAGE_BUFFERS = 8;
const LABEL_HORIZONTAL_INSET = 8;
const HOVER_RADIUS = 4;

/** GPU glyph pixels and Canvas2D catalog chrome over one native scroll viewport. */
export function GlyphCatalogCanvas({
  containerRef,
  glyphs,
  location,
  axes,
  metrics,
  sourceId,
  atlasRevision,
  visible,
  openGlyph,
  onFirstFrame,
  onUnavailable,
}: GlyphCatalogCanvasProps) {
  const editor = useEditor();
  const slugCanvasRef = useRef<HTMLCanvasElement>(null);
  const overlayCanvasRef = useRef<HTMLCanvasElement>(null);
  const inputContainerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const pointerPositionRef = useRef<Point2D | null>(null);
  const hoveredCatalogIndexRef = useRef<number | null>(null);
  const editingGlyphRef = useRef<GlyphCatalogItem | null>(null);
  const firstFrameRef = useRef(false);
  const [hoveredCatalogIndex, setHoveredCatalogIndex] = useState<number | null>(null);
  const [editingCatalogGlyphId, setEditingCatalogGlyphId] = useState<GlyphId | null>(null);
  const [resident, setResident] = useState<{
    revision: unknown;
    renderer: SlugRenderer;
  } | null>(null);
  const renderer = resident && resident.revision === atlasRevision ? resident.renderer : null;
  const [ready, setReady] = useState(false);
  const editingGlyph = editingCatalogGlyphId
    ? (glyphs.find((glyph) => glyph.id === editingCatalogGlyphId) ??
      (editingGlyphRef.current?.id === editingCatalogGlyphId ? editingGlyphRef.current : null))
    : null;

  useEffect(() => {
    firstFrameRef.current = false;
    setReady(false);
    const canvas = slugCanvasRef.current;
    if (!canvas || !navigator.gpu) {
      onUnavailable();
      return undefined;
    }

    const activeCanvas = canvas;
    let cancelled = false;
    let preparedGeneration: number | null = null;
    let streamed = false;
    let pendingDevice: GPUDevice | null = null;
    let pendingResidentAtlas: SlugResidentAtlas | null = null;
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

        const maximumBindingSize = Math.min(
          adapter.limits.maxBufferSize,
          adapter.limits.maxStorageBufferBindingSize,
        );
        const split = createSlugAtlasSplit(atlas.layout.totalLength, maximumBindingSize);
        const largestResidentBuffer = Math.max(split.firstLength, split.secondLength);
        if (atlas.layout.totalLength > PREFERRED_ATLAS_BYTES) {
          console.warn("resident Slug atlas exceeds preferred size", {
            bytes: atlas.layout.totalLength,
            preferredBytes: PREFERRED_ATLAS_BYTES,
          });
        }

        const device = await adapter.requestDevice({
          requiredLimits: {
            maxBufferSize: largestResidentBuffer,
            maxStorageBufferBindingSize: largestResidentBuffer,
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
        const residentAtlas: SlugResidentAtlas = {
          firstBuffer: device.createBuffer({
            label: "shift Slug resident atlas first",
            size: split.firstLength,
            usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
          }),
          secondBuffer: device.createBuffer({
            label: "shift Slug resident atlas second",
            size: split.secondLength,
            usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
          }),
          splitOffset: split.splitOffset,
        };
        pendingResidentAtlas = residentAtlas;
        const sections = createSlugAtlasSections(atlas);
        const totalLength = await editor.font.editCoordinator.streamSlugAtlas(
          atlas.generation,
          UPLOAD_CHUNK_BYTES,
          (offset, bytes) => {
            if (cancelled) throw new Error("resident Slug upload cancelled");
            writeSlugAtlasChunk(device.queue, residentAtlas, offset, bytes);
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
          residentAtlas.firstBuffer.destroy();
          residentAtlas.secondBuffer.destroy();
          device.destroy();
          pendingResidentAtlas = null;
          pendingDevice = null;
          return;
        }

        device.pushErrorScope("validation");
        const initializedRenderer = new SlugRenderer({
          atlas,
          residentAtlas,
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
        pendingResidentAtlas = null;
        pendingDevice = null;
        const validationError = await device.popErrorScope();
        if (validationError) throw validationError;
        initializedRenderer.atlasUploadBytes = totalLength;
        if (!cancelled) {
          setResident({ revision: atlasRevision, renderer: initializedRenderer });
        }
      } catch (error) {
        currentRenderer?.destroy();
        pendingResidentAtlas?.firstBuffer.destroy();
        pendingResidentAtlas?.secondBuffer.destroy();
        pendingDevice?.destroy();
        pendingResidentAtlas = null;
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
      pendingResidentAtlas?.firstBuffer.destroy();
      pendingResidentAtlas?.secondBuffer.destroy();
      pendingDevice?.destroy();
      void discardPrepared();
    };
  }, [atlasRevision, editor, onUnavailable]);

  useLayoutEffect(() => {
    const slugCanvas = slugCanvasRef.current;
    const overlayCanvas = overlayCanvasRef.current;
    const container = containerRef.current;
    const overlayContext = overlayCanvas?.getContext("2d");
    if (!slugCanvas || !overlayCanvas || !container || !overlayContext) return undefined;

    const activeSlugCanvas = slugCanvas;
    const activeOverlayCanvas = overlayCanvas;
    const activeContainer = container;
    const activeOverlayContext = overlayContext;
    const activeRenderer = renderer;
    let animationFrame = 0;
    let disposed = false;

    function updateHoveredCatalogIndex(nextIndex: number | null): void {
      activeContainer.style.cursor = nextIndex === null ? "" : "pointer";
      if (hoveredCatalogIndexRef.current === nextIndex) return;

      hoveredCatalogIndexRef.current = nextIndex;
      setHoveredCatalogIndex(nextIndex);
    }

    function requestDraw(): void {
      if (animationFrame !== 0) return;
      animationFrame = requestAnimationFrame(draw);
    }

    function currentFrame(): GlyphCatalogFrame {
      const layout = deriveGlyphCatalogLayout(
        activeContainer.clientWidth,
        activeContainer.clientHeight,
        glyphs.length,
      );
      return deriveVisibleGlyphCatalogCells(layout, glyphs, activeContainer.scrollTop);
    }

    function draw(): void {
      animationFrame = 0;
      if (disposed) return;

      const ratio = window.devicePixelRatio;
      const width = activeContainer.clientWidth;
      const height = activeContainer.clientHeight;
      resizeCanvas(activeSlugCanvas, width, height, ratio);
      resizeCanvas(activeOverlayCanvas, width, height, ratio);
      const frame = currentFrame();
      const hoveredCell = pointerPositionRef.current
        ? hitGlyphCatalogCell(frame, pointerPositionRef.current)
        : null;
      updateHoveredCatalogIndex(hoveredCell?.catalogIndex ?? null);
      drawCatalogOverlay(
        activeOverlayContext,
        activeContainer,
        frame,
        hoveredCell?.catalogIndex ?? null,
        ratio,
      );
      if (
        editingCatalogGlyphId &&
        !positionGlyphNameInput(inputContainerRef.current, frame, editingCatalogGlyphId)
      ) {
        inputRef.current?.blur();
        editingGlyphRef.current = null;
        setEditingCatalogGlyphId(null);
      }

      if (!activeRenderer) return;

      try {
        const selections: SlugGlyphSelection[] = frame.cells.map((cell) => ({
          glyphId: cell.glyph.id,
          sourceId,
          pixelRect: [
            cell.previewContentRect.left * ratio,
            cell.previewContentRect.top * ratio,
            cell.previewContentRect.right * ratio,
            cell.previewContentRect.bottom * ratio,
          ],
        }));
        const catalogIntersectsViewport =
          frame.layout.totalHeight > frame.scrollTop &&
          frame.scrollTop + frame.layout.viewportHeight > 0;

        if (selections.length > 0 || glyphs.length === 0 || !catalogIntersectsViewport) {
          activeRenderer.draw({
            weights: activeRenderer.weights(location, axes),
            selections,
            preview: previewStyle(activeContainer, ratio, metrics, frame),
            viewportWidth: activeSlugCanvas.width,
            viewportHeight: activeSlugCanvas.height,
          });
          publishDiagnostics(activeSlugCanvas, activeRenderer);
        }
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

    function handlePointerMove(event: PointerEvent): void {
      pointerPositionRef.current = pointerPosition(activeContainer, event);
      requestDraw();
    }

    function handlePointerLeave(): void {
      pointerPositionRef.current = null;
      updateHoveredCatalogIndex(null);
      requestDraw();
    }

    async function handleClick(event: MouseEvent): Promise<void> {
      const frame = currentFrame();
      const point = pointerPosition(activeContainer, event);
      const nameCell = hitGlyphCatalogCell(frame, point, "name");
      if (nameCell) {
        editingGlyphRef.current = nameCell.glyph;
        setEditingCatalogGlyphId(nameCell.glyph.id);
        return;
      }

      const previewCell = hitGlyphCatalogCell(frame, point, "preview");
      if (!previewCell) return;

      try {
        await openGlyph(previewCell.glyph);
      } catch (error) {
        console.error("failed to open catalog Glyph", error);
      }
    }

    async function redrawWhenFontsReady(): Promise<void> {
      try {
        await document.fonts.ready;
        if (!disposed) requestDraw();
      } catch (error) {
        console.error("failed to await catalog fonts", error);
      }
    }

    const observer = new ResizeObserver(requestDraw);
    observer.observe(activeContainer);
    const themeObserver = new MutationObserver(requestDraw);
    themeObserver.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class", "style"],
    });
    activeContainer.addEventListener("scroll", requestDraw, { passive: true });
    activeContainer.addEventListener("pointermove", handlePointerMove, { passive: true });
    activeContainer.addEventListener("pointerleave", handlePointerLeave, { passive: true });
    activeContainer.addEventListener("click", handleClick);
    document.fonts.addEventListener("loadingdone", requestDraw);
    void redrawWhenFontsReady();
    requestDraw();

    return () => {
      disposed = true;
      if (animationFrame !== 0) cancelAnimationFrame(animationFrame);
      observer.disconnect();
      themeObserver.disconnect();
      activeContainer.removeEventListener("scroll", requestDraw);
      activeContainer.removeEventListener("pointermove", handlePointerMove);
      activeContainer.removeEventListener("pointerleave", handlePointerLeave);
      activeContainer.removeEventListener("click", handleClick);
      activeContainer.style.cursor = "";
      document.fonts.removeEventListener("loadingdone", requestDraw);
    };
  }, [
    axes,
    containerRef,
    editingCatalogGlyphId,
    glyphs,
    location,
    metrics,
    onFirstFrame,
    onUnavailable,
    openGlyph,
    renderer,
    sourceId,
  ]);

  useLayoutEffect(() => {
    if (!editingCatalogGlyphId) return;

    const input = inputRef.current;
    input?.focus();
    input?.select();
  }, [editingCatalogGlyphId]);

  return (
    <>
      <canvas
        ref={slugCanvasRef}
        aria-hidden="true"
        data-slug-ready={ready}
        className="pointer-events-none absolute left-0 top-0 z-[2] bg-transparent"
        style={{ visibility: ready && visible ? "visible" : "hidden" }}
      />
      <canvas
        ref={overlayCanvasRef}
        aria-hidden="true"
        data-hovered-catalog-index={hoveredCatalogIndex ?? undefined}
        className="pointer-events-none absolute left-0 top-0 z-[1] bg-transparent"
      />
      {editingGlyph ? (
        <div
          ref={inputContainerRef}
          className="absolute left-0 top-0 z-[3]"
          style={{ height: 28, transform: "translate(-10000px, -10000px)", width: 0 }}
        >
          <GlyphNameInput
            ref={inputRef}
            glyph={editingGlyph}
            onFinished={() => {
              editingGlyphRef.current = null;
              setEditingCatalogGlyphId(null);
            }}
          />
        </div>
      ) : null}
    </>
  );
}

function positionGlyphNameInput(
  container: HTMLDivElement | null,
  frame: GlyphCatalogFrame,
  glyphId: GlyphId,
): boolean {
  if (!container) return false;

  const cell = frame.cells.find((candidate) => candidate.glyph.id === glyphId);
  if (!cell || cell.nameRect.bottom <= 0 || cell.nameRect.top >= frame.layout.viewportHeight) {
    return false;
  }

  container.style.width = `${cell.nameRect.width}px`;
  container.style.height = `${cell.nameRect.height}px`;
  container.style.transform = `translate(${cell.nameRect.x}px, ${cell.nameRect.y}px)`;
  return true;
}

function resizeCanvas(
  canvas: HTMLCanvasElement,
  cssWidth: number,
  cssHeight: number,
  ratio: number,
): void {
  canvas.style.width = `${cssWidth}px`;
  canvas.style.height = `${cssHeight}px`;
  const width = Math.max(1, Math.round(cssWidth * ratio));
  const height = Math.max(1, Math.round(cssHeight * ratio));
  if (canvas.width !== width) canvas.width = width;
  if (canvas.height !== height) canvas.height = height;
}

function drawCatalogOverlay(
  context: CanvasRenderingContext2D,
  container: HTMLElement,
  frame: GlyphCatalogFrame,
  hoveredCatalogIndex: number | null,
  ratio: number,
): void {
  const style = getComputedStyle(container);
  const mutedColor = style.getPropertyValue("--color-muted").trim() || style.color;
  const hoverColor = style.getPropertyValue("--color-hover").trim() || style.color;
  const inputColor = style.getPropertyValue("--color-input").trim() || hoverColor;
  const fontFamily = style.fontFamily;
  context.setTransform(ratio, 0, 0, ratio, 0, 0);
  context.clearRect(0, 0, frame.layout.viewportWidth, frame.layout.viewportHeight);

  for (const cell of frame.cells) {
    if (cell.catalogIndex === hoveredCatalogIndex) {
      context.fillStyle = hoverColor;
      context.beginPath();
      context.roundRect(
        cell.previewRect.x,
        cell.previewRect.y,
        cell.previewRect.width,
        cell.previewRect.height,
        HOVER_RADIUS,
      );
      context.fill();
    }

    context.fillStyle = inputColor;
    context.beginPath();
    context.roundRect(
      cell.nameRect.x,
      cell.nameRect.y,
      cell.nameRect.width,
      cell.nameRect.height,
      HOVER_RADIUS,
    );
    context.fill();

    context.fillStyle = mutedColor;
    context.font = `400 10px ${fontFamily}`;
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.fillText(
      truncateLabel(context, cell.glyph.name, cell.nameRect.width - 2 * LABEL_HORIZONTAL_INSET),
      cell.nameRect.x + cell.nameRect.width / 2,
      cell.nameRect.y + cell.nameRect.height / 2,
    );
  }

  if (frame.layout.glyphCount > 0) return;

  context.fillStyle = mutedColor;
  context.font = `400 12px ${fontFamily}`;
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.fillText(
    "No glyphs match this filter.",
    frame.layout.viewportWidth / 2,
    frame.layout.viewportHeight / 2,
  );
}

function truncateLabel(
  context: CanvasRenderingContext2D,
  label: string,
  maximumWidth: number,
): string {
  if (maximumWidth <= 0) return "";
  if (context.measureText(label).width <= maximumWidth) return label;

  const ellipsis = "…";
  let start = 0;
  let end = label.length;
  while (start < end) {
    const middle = Math.ceil((start + end) / 2);
    const candidate = `${label.slice(0, middle)}${ellipsis}`;
    if (context.measureText(candidate).width <= maximumWidth) {
      start = middle;
    } else {
      end = middle - 1;
    }
  }

  return start > 0 ? `${label.slice(0, start)}${ellipsis}` : ellipsis;
}

function pointerPosition(container: HTMLElement, event: MouseEvent | PointerEvent): Point2D {
  const bounds = container.getBoundingClientRect();
  return { x: event.clientX - bounds.left, y: event.clientY - bounds.top };
}

function previewStyle(
  container: HTMLElement,
  ratio: number,
  metrics: GlyphCatalogCanvasProps["metrics"],
  frame: GlyphCatalogFrame,
): SlugPreviewStyle {
  const [viewHeight, fontTop] = GlyphPreviewLayout.fontViewport(metrics);
  return {
    viewHeight,
    fontTop,
    previewHeight: frame.layout.previewHeight * ratio,
    sideMargin: GlyphPreviewLayout.sideMargin(metrics),
    color: cssColor(getComputedStyle(container).color),
  };
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
