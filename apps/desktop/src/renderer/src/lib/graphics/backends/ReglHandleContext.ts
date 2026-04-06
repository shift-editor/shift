import REGL from "regl";
import { GPU_HANDLE_INSTANCE_FLOATS, type GpuHandleFrame } from "@/lib/editor/rendering/gpu/types";
import vert from "@/lib/editor/rendering/gpu/shaders/handle.vert.glsl";
import frag from "@/lib/editor/rendering/gpu/shaders/handle.frag.glsl";

const UNIT_QUAD = new Float32Array([-1, -1, 1, -1, -1, 1, 1, -1, 1, 1, -1, 1]);

export class ReglHandleContext {
  #regl: REGL.Regl | null = null;
  #instanceBuffer: REGL.Buffer | null = null;
  #drawCommand: REGL.DrawCommand | null = null;
  #available = false;
  #instanceCapacity = 0;

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

  isAvailable(): boolean {
    return this.#available;
  }

  clear(): void {
    if (!this.#regl || !this.#available) return;
    this.#regl.clear({ color: [0, 0, 0, 0], depth: 1 });
  }

  draw(frame: GpuHandleFrame): boolean {
    if (!this.#regl || !this.#instanceBuffer || !this.#drawCommand || !this.#available)
      return false;

    if (frame.instanceCount === 0) {
      this.clear();
      return true;
    }

    if (frame.packedInstances.length > this.#instanceCapacity) {
      this.#instanceCapacity = frame.packedInstances.length;
      this.#instanceBuffer({ usage: "dynamic", type: "float", data: frame.packedInstances });
    } else {
      this.#instanceBuffer.subdata(frame.packedInstances);
    }

    this.#regl.clear({ color: [0, 0, 0, 0], depth: 1 });
    this.#drawCommand({
      instanceCount: frame.instanceCount,
      logicalWidth: frame.logicalWidth,
      logicalHeight: frame.logicalHeight,
      zoom: frame.viewport.zoom,
      panX: frame.viewport.panX,
      panY: frame.viewport.panY,
      centre: [frame.viewport.centre.x, frame.viewport.centre.y],
      upmScale: frame.viewport.upmScale,
      padding: frame.viewport.padding,
      descender: frame.viewport.descender,
      drawOffset: [frame.drawOffset.x, frame.drawOffset.y],
    });
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
      const stride = GPU_HANDLE_INSTANCE_FLOATS * 4;
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
          u_zoom: prop("zoom"),
          u_pan_x: prop("panX"),
          u_pan_y: prop("panY"),
          u_centre: prop("centre"),
          u_upm_scale: prop("upmScale"),
          u_logical_width: prop("logicalWidth"),
          u_logical_height: prop("logicalHeight"),
          u_padding: prop("padding"),
          u_descender: prop("descender"),
          u_draw_offset: prop("drawOffset"),
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
      console.warn("[ReglHandleContext] Failed to initialize WebGL handle renderer", error);
      this.#available = false;
      this.#regl = null;
      this.#instanceBuffer = null;
      this.#drawCommand = null;
      this.#instanceCapacity = 0;
    }
  }
}
