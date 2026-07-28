import type { GlyphPreviewFrame } from "@/types/glyphPreview";
import type { WorkspaceEditCoordinator } from "@/lib/workspace/WorkspaceEditCoordinator";
import { SlugAtlas } from "@/lib/slug/SlugAtlas";
import { SlugRenderer } from "@/lib/slug/SlugRenderer";

const COPY_ALIGNMENT = 256;
const UPLOAD_CHUNK_BYTES = 4 * 1024 * 1024;
const PREFERRED_ATLAS_BYTES = 256 * 1024 * 1024;
const REQUIRED_STORAGE_BUFFERS = 8;

/** Generic resident glyph-preview surface backed by the current Slug implementation. */
export class ResidentGlyphLayer {
  readonly #renderer: SlugRenderer;

  private constructor(renderer: SlugRenderer) {
    this.#renderer = renderer;
  }

  static async create(
    canvas: HTMLCanvasElement,
    edits: WorkspaceEditCoordinator,
    onDeviceLost: (reason: string) => void,
    signal: AbortSignal,
  ): Promise<ResidentGlyphLayer> {
    if (!navigator.gpu) throw new Error("WebGPU is unavailable");

    let preparedGeneration: number | null = null;
    let device: GPUDevice | null = null;
    let context: GPUCanvasContext | null = null;
    let atlas: SlugAtlas | null = null;
    let renderer: SlugRenderer | null = null;

    async function discardPrepared(): Promise<void> {
      if (preparedGeneration === null) return;
      const generation = preparedGeneration;
      preparedGeneration = null;
      await edits.discardSlugAtlas(generation);
    }

    try {
      const adapter = await navigator.gpu.requestAdapter({ powerPreference: "high-performance" });
      throwIfAborted(signal);
      if (!adapter) throw new Error("WebGPU adapter is unavailable");
      if (adapter.limits.maxStorageBuffersPerShaderStage < REQUIRED_STORAGE_BUFFERS) {
        throw new Error(
          `WebGPU exposes ${adapter.limits.maxStorageBuffersPerShaderStage} storage buffers; ${REQUIRED_STORAGE_BUFFERS} required`,
        );
      }

      const alignment = Math.max(COPY_ALIGNMENT, adapter.limits.minStorageBufferOffsetAlignment);
      const descriptor = await edits.prepareSlugAtlas(alignment);
      preparedGeneration = descriptor.generation;
      throwIfAborted(signal);

      const maximumBindingSize = Math.min(
        adapter.limits.maxBufferSize,
        adapter.limits.maxStorageBufferBindingSize,
      );
      const [, firstLength, secondLength] = SlugAtlas.bindingLengths(
        descriptor.layout.totalLength,
        maximumBindingSize,
      );
      const largestResidentBuffer = Math.max(firstLength, secondLength);
      if (descriptor.layout.totalLength > PREFERRED_ATLAS_BYTES) {
        console.warn("resident glyph atlas exceeds preferred size", {
          bytes: descriptor.layout.totalLength,
          preferredBytes: PREFERRED_ATLAS_BYTES,
          adapterMaximumBytes: maximumBindingSize * 2,
        });
      }

      device = await adapter.requestDevice({
        requiredLimits: {
          maxBufferSize: largestResidentBuffer,
          maxStorageBufferBindingSize: largestResidentBuffer,
          maxStorageBuffersPerShaderStage: REQUIRED_STORAGE_BUFFERS,
        },
      });
      throwIfAborted(signal);

      context = canvas.getContext("webgpu");
      if (!context) throw new Error("WebGPU canvas context is unavailable");
      const format = navigator.gpu.getPreferredCanvasFormat();
      context.configure({ device, format, alphaMode: "premultiplied" });
      atlas = SlugAtlas.create(descriptor, device, maximumBindingSize);
      const activeAtlas = atlas;
      const uploadDevice = device;
      const totalLength = await edits.streamSlugAtlas(
        descriptor.generation,
        UPLOAD_CHUNK_BYTES,
        (offset, bytes) => {
          throwIfAborted(signal);
          activeAtlas.write(uploadDevice.queue, offset, bytes);
        },
      );
      preparedGeneration = null;
      throwIfAborted(signal);
      if (totalLength !== descriptor.layout.totalLength) {
        throw new Error(
          `resident glyph stream wrote ${totalLength} bytes; expected ${descriptor.layout.totalLength}`,
        );
      }

      device.pushErrorScope("validation");
      const initializedRenderer = new SlugRenderer(atlas, device, context, format, onDeviceLost);
      renderer = initializedRenderer;
      atlas = null;
      const activeDevice = device;
      device = null;
      context = null;
      const validationError = await activeDevice.popErrorScope();
      if (validationError) throw validationError;
      throwIfAborted(signal);

      return new ResidentGlyphLayer(initializedRenderer);
    } catch (error) {
      renderer?.destroy();
      atlas?.destroy();
      context?.unconfigure();
      device?.destroy();
      try {
        await discardPrepared();
      } catch (discardError) {
        console.error("failed to release rejected resident glyph atlas", discardError);
      }
      throw error;
    }
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
