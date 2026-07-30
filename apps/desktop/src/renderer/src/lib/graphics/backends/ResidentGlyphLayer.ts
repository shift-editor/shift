import type { GlyphId } from "@shift/types";
import type { GlyphPreviewFrame } from "@/types/glyphPreview";
import type { WorkspaceEditCoordinator } from "@/lib/workspace/WorkspaceEditCoordinator";
import { SlugAtlas } from "@/lib/slug/SlugAtlas";
import { SlugRenderer } from "@/lib/slug/SlugRenderer";

const COPY_ALIGNMENT = 256;
const UPLOAD_CHUNK_BYTES = 4 * 1024 * 1024;
const PREFERRED_PAGE_BYTES = 64 * 1024 * 1024;
const REQUIRED_STORAGE_BUFFERS = 8;

/** Generic paged glyph-preview surface backed by the current Slug implementation. */
export class ResidentGlyphLayer {
  readonly #renderer: SlugRenderer;
  readonly #device: GPUDevice;
  readonly #edits: WorkspaceEditCoordinator;
  readonly #alignment: number;
  readonly #maximumBindingSize: number;

  private constructor(
    renderer: SlugRenderer,
    device: GPUDevice,
    edits: WorkspaceEditCoordinator,
    alignment: number,
    maximumBindingSize: number,
  ) {
    this.#renderer = renderer;
    this.#device = device;
    this.#edits = edits;
    this.#alignment = alignment;
    this.#maximumBindingSize = maximumBindingSize;
  }

  static async create(
    canvas: HTMLCanvasElement,
    edits: WorkspaceEditCoordinator,
    onDeviceLost: (reason: string) => void,
    signal: AbortSignal,
  ): Promise<ResidentGlyphLayer> {
    if (!navigator.gpu) throw new Error("WebGPU is unavailable");

    let device: GPUDevice | null = null;
    let context: GPUCanvasContext | null = null;
    let renderer: SlugRenderer | null = null;

    try {
      const adapter = await navigator.gpu.requestAdapter({ powerPreference: "high-performance" });
      throwIfAborted(signal);
      if (!adapter) throw new Error("WebGPU adapter is unavailable");
      if (adapter.limits.maxStorageBuffersPerShaderStage < REQUIRED_STORAGE_BUFFERS) {
        throw new Error(
          `WebGPU exposes ${adapter.limits.maxStorageBuffersPerShaderStage} storage buffers; ${REQUIRED_STORAGE_BUFFERS} required`,
        );
      }

      device = await adapter.requestDevice({
        requiredLimits: { maxStorageBuffersPerShaderStage: REQUIRED_STORAGE_BUFFERS },
      });
      throwIfAborted(signal);

      context = canvas.getContext("webgpu");
      if (!context) throw new Error("WebGPU canvas context is unavailable");
      const format = navigator.gpu.getPreferredCanvasFormat();
      context.configure({ device, format, alphaMode: "premultiplied" });
      renderer = new SlugRenderer(device, context, format, onDeviceLost);
      const alignment = Math.max(COPY_ALIGNMENT, device.limits.minStorageBufferOffsetAlignment);
      const maximumBindingSize = Math.min(
        device.limits.maxBufferSize,
        device.limits.maxStorageBufferBindingSize,
      );

      const layer = new ResidentGlyphLayer(renderer, device, edits, alignment, maximumBindingSize);
      renderer = null;
      device = null;
      context = null;
      return layer;
    } catch (error) {
      renderer?.destroy();
      context?.unconfigure();
      device?.destroy();
      throw error;
    }
  }

  async loadPage(glyphIds: readonly GlyphId[], signal: AbortSignal): Promise<void> {
    if (glyphIds.length === 0) return;

    let preparedGeneration: number | null = null;
    let atlas: SlugAtlas | null = null;

    async function discardPrepared(
      edits: WorkspaceEditCoordinator,
      generation: number,
    ): Promise<void> {
      await edits.discardSlugAtlasPage(generation);
    }

    try {
      const descriptor = await this.#edits.prepareSlugAtlasPage(glyphIds, this.#alignment);
      preparedGeneration = descriptor.generation;
      throwIfAborted(signal);

      if (descriptor.layout.totalLength > PREFERRED_PAGE_BYTES) {
        console.warn("resident glyph atlas page exceeds preferred size", {
          bytes: descriptor.layout.totalLength,
          preferredBytes: PREFERRED_PAGE_BYTES,
        });
      }

      atlas = SlugAtlas.create(descriptor, this.#device, this.#maximumBindingSize);
      const activeAtlas = atlas;
      const totalLength = await this.#edits.streamSlugAtlasPage(
        descriptor.generation,
        UPLOAD_CHUNK_BYTES,
        (offset, bytes) => {
          throwIfAborted(signal);
          activeAtlas.write(this.#device.queue, offset, bytes);
        },
      );
      preparedGeneration = null;
      throwIfAborted(signal);
      if (totalLength !== descriptor.layout.totalLength) {
        throw new Error(
          `resident glyph page stream wrote ${totalLength} bytes; expected ${descriptor.layout.totalLength}`,
        );
      }

      const loadedAtlas = atlas;
      atlas = null;
      this.#renderer.loadPage(loadedAtlas);
    } catch (error) {
      atlas?.destroy();
      if (preparedGeneration !== null) {
        try {
          await discardPrepared(this.#edits, preparedGeneration);
        } catch (discardError) {
          console.error("failed to release rejected resident glyph atlas page", discardError);
        }
      }
      throw error;
    }
  }

  invalidate(glyphIds: readonly GlyphId[]): void {
    this.#renderer.invalidate(glyphIds);
  }

  hasGlyphs(glyphIds: readonly GlyphId[]): boolean {
    return this.#renderer.hasGlyphs(glyphIds);
  }

  draw(frame: GlyphPreviewFrame): void {
    this.#renderer.draw(frame);
  }

  async complete(): Promise<void> {
    await this.#renderer.complete();
  }

  destroy(): void {
    this.#renderer.destroy();
  }
}

function throwIfAborted(signal: AbortSignal): void {
  if (!signal.aborted) return;

  throw signal.reason instanceof Error ? signal.reason : new Error("resident glyph load aborted");
}
