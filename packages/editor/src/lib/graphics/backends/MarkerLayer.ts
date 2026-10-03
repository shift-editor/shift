import REGL from "regl";
import { MARKER_INSTANCE_FLOATS } from "../../editor/rendering/markers/types";
import vert from "../../editor/rendering/markers/shaders/handle.vert.glsl";
import frag from "../../editor/rendering/markers/shaders/handle.frag.glsl";
import type { MatModel } from "@shift/geo";

const UNIT_QUAD = new Float32Array([-1, -1, 1, -1, -1, 1, 1, -1, 1, 1, -1, 1]);
const CLEAR_OPTIONS = {
  color: [0, 0, 0, 0] as [number, number, number, number],
  depth: 1,
};

interface MarkerDrawProps {
  instanceCount: number;
  logicalWidth: number;
  logicalHeight: number;
  /** Marker position units → screen pixels, column-major. */
  toScreen: Float32Array;
}

export class MarkerLayer {
  #regl: REGL.Regl | null = null;
  #instanceBuffer: REGL.Buffer | null = null;
  #drawCommand: REGL.DrawCommand | null = null;
  #available = false;
  #instanceCapacity = 0;
  #frameDrew = false;
  #drawProps: MarkerDrawProps = {
    instanceCount: 0,
    logicalWidth: 0,
    logicalHeight: 0,
    toScreen: new Float32Array([1, 0, 0, 0, 1, 0, 0, 0, 1]),
  };

  resizeCanvas(canvas: HTMLCanvasElement): void {
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    canvas.width = Math.floor(rect.width * dpr);
    canvas.height = Math.floor(rect.height * dpr);

    if (!this.#regl) {
      this.#initialize(canvas, dpr);
      return;
    }

    this.#regl.poll();
  }

  /** @knipclassignore */
  isAvailable(): boolean {
    return this.#available;
  }

  /** Starts a marker frame and forgets whether any marker content has drawn. */
  begin(): void {
    this.#frameDrew = false;
  }

  /** Clears the marker surface when the frame produced no marker draw. */
  commit(): void {
    if (this.#frameDrew) return;

    this.clear();
  }

  clear(): void {
    if (!this.#regl || !this.#available) return;
    this.#regl.clear(CLEAR_OPTIONS);
  }

  /** @knipclassignore */
  draw(
    packedInstances: Float32Array,
    instanceCount: number,
    toScreen: MatModel,
    logicalWidth: number,
    logicalHeight: number,
  ): boolean {
    if (!this.#regl || !this.#instanceBuffer || !this.#drawCommand || !this.#available)
      return false;

    if (!this.uploadInstances(packedInstances, instanceCount)) return false;

    return this.drawUploaded(instanceCount, toScreen, logicalWidth, logicalHeight);
  }

  uploadInstances(packedInstances: Float32Array, instanceCount: number): boolean {
    if (!this.#regl || !this.#instanceBuffer || !this.#drawCommand || !this.#available)
      return false;

    if (instanceCount === 0) return true;

    const requiredLength = instanceCount * MARKER_INSTANCE_FLOATS;
    const data =
      packedInstances.length === requiredLength
        ? packedInstances
        : packedInstances.subarray(0, requiredLength);

    if (requiredLength > this.#instanceCapacity) {
      const capacity = Math.max(requiredLength, this.#instanceCapacity * 2);
      this.#instanceBuffer({
        usage: "dynamic",
        type: "float",
        length: capacity * Float32Array.BYTES_PER_ELEMENT,
      });
      this.#instanceCapacity = capacity;
    }
    this.#instanceBuffer.subdata(data);

    return true;
  }

  /**
   * Draws the uploaded markers, clearing the surface first.
   *
   * @param toScreen - Maps marker positions to screen pixels; marker sizes stay in pixels.
   * @param logicalWidth - Canvas width in logical pixels.
   * @param logicalHeight - Canvas height in logical pixels.
   */
  drawUploaded(
    instanceCount: number,
    toScreen: MatModel,
    logicalWidth: number,
    logicalHeight: number,
  ): boolean {
    if (!this.#regl || !this.#instanceBuffer || !this.#drawCommand || !this.#available)
      return false;

    this.#frameDrew = true;

    if (instanceCount === 0) {
      this.clear();
      return true;
    }

    this.clear();
    this.#drawProps.instanceCount = instanceCount;
    this.#drawProps.logicalWidth = logicalWidth;
    this.#drawProps.logicalHeight = logicalHeight;
    this.#drawProps.toScreen.set([
      toScreen.a,
      toScreen.b,
      0,
      toScreen.c,
      toScreen.d,
      0,
      toScreen.e,
      toScreen.f,
      1,
    ]);
    this.#drawCommand(this.#drawProps);
    return true;
  }

  destroy(): void {
    this.#drawCommand = null;
    this.#instanceBuffer = null;
    this.#available = false;
    this.#regl?.destroy();
    this.#regl = null;
  }

  #initialize(canvas: HTMLCanvasElement, pixelRatio: number): void {
    try {
      const regl = REGL({
        canvas,
        pixelRatio,
        attributes: {
          alpha: true,
          antialias: true,
          depth: false,
          stencil: false,
          premultipliedAlpha: true,
        },
        extensions: ["ANGLE_instanced_arrays", "OES_standard_derivatives"],
      });

      const quadBuffer = regl.buffer(UNIT_QUAD);
      const instanceBuffer = regl.buffer({
        usage: "dynamic",
        type: "float",
        data: new Float32Array(0),
      });
      const stride = MARKER_INSTANCE_FLOATS * 4;
      const prop = (name: string) => regl.prop(name as never) as never;

      const instanceAttr = (offset: number) => ({
        buffer: instanceBuffer,
        divisor: 1,
        stride,
        offset: offset * 4,
      });

      this.#drawCommand = regl({
        vert,
        frag,
        attributes: {
          a_unit: quadBuffer,
          a_position: instanceAttr(0),
          a_extent: instanceAttr(2),
          a_rotation: instanceAttr(4),
          a_shape: instanceAttr(5),
          a_size: instanceAttr(6),
          a_line_width: instanceAttr(7),
          a_fill_color: instanceAttr(8),
          a_stroke_color: instanceAttr(12),
          a_overlay_color: instanceAttr(16),
          a_bar_size: instanceAttr(20),
          a_bar_stroke_color: instanceAttr(21),
        },
        uniforms: {
          u_to_screen: prop("toScreen"),
          u_logical_width: prop("logicalWidth"),
          u_logical_height: prop("logicalHeight"),
        },
        blend: {
          enable: true,
          func: {
            srcRGB: "src alpha",
            srcAlpha: "src alpha",
            dstRGB: "one minus src alpha",
            dstAlpha: "one minus src alpha",
          },
        },
        count: 6,
        instances: prop("instanceCount"),
      });

      this.#regl = regl;
      this.#instanceBuffer = instanceBuffer;
      this.#instanceCapacity = 0;
      this.#available = true;
    } catch (error) {
      console.warn("[MarkerLayer] Failed to initialize WebGL marker renderer", error);
      this.#available = false;
      this.#regl = null;
      this.#instanceBuffer = null;
      this.#drawCommand = null;
      this.#instanceCapacity = 0;
    }
  }
}
