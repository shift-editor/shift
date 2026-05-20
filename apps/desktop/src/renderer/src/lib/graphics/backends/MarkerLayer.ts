import REGL from "regl";
import { MARKER_INSTANCE_FLOATS } from "@/lib/editor/rendering/markers/types";
import vert from "@/lib/editor/rendering/markers/shaders/handle.vert.glsl";
import frag from "@/lib/editor/rendering/markers/shaders/handle.frag.glsl";
import type { CameraTransform } from "@/lib/editor/managers/Camera";
import type { Point2D } from "@shift/geo";

const UNIT_QUAD = new Float32Array([-1, -1, 1, -1, -1, 1, 1, -1, 1, 1, -1, 1]);
const CLEAR_OPTIONS = {
  color: [0, 0, 0, 0] as [number, number, number, number],
  depth: 1,
};

interface MarkerDrawProps {
  instanceCount: number;
  logicalWidth: number;
  logicalHeight: number;
  layoutHeight: number;
  zoom: number;
  panX: number;
  panY: number;
  centre: [number, number];
  upmScale: number;
  padding: number;
  descender: number;
  drawOffset: [number, number];
}

export class MarkerLayer {
  #regl: REGL.Regl | null = null;
  #instanceBuffer: REGL.Buffer | null = null;
  #drawCommand: REGL.DrawCommand | null = null;
  #available = false;
  #instanceCapacity = 0;
  #centre: [number, number] = [0, 0];
  #drawOffset: [number, number] = [0, 0];
  #drawProps: MarkerDrawProps = {
    instanceCount: 0,
    logicalWidth: 0,
    logicalHeight: 0,
    layoutHeight: 0,
    zoom: 1,
    panX: 0,
    panY: 0,
    centre: this.#centre,
    upmScale: 1,
    padding: 0,
    descender: 0,
    drawOffset: this.#drawOffset,
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

  clear(): void {
    if (!this.#regl || !this.#available) return;
    this.#regl.clear(CLEAR_OPTIONS);
  }

  /** @knipclassignore */
  draw(
    packedInstances: Float32Array,
    instanceCount: number,
    camera: CameraTransform,
    drawOffset: Point2D,
    logicalWidth: number,
    logicalHeight: number,
  ): boolean {
    if (
      !this.#regl ||
      !this.#instanceBuffer ||
      !this.#drawCommand ||
      !this.#available
    )
      return false;

    if (!this.uploadInstances(packedInstances, instanceCount)) return false;

    return this.drawUploaded(
      instanceCount,
      camera,
      drawOffset,
      logicalWidth,
      logicalHeight,
    );
  }

  uploadInstances(
    packedInstances: Float32Array,
    instanceCount: number,
  ): boolean {
    if (
      !this.#regl ||
      !this.#instanceBuffer ||
      !this.#drawCommand ||
      !this.#available
    )
      return false;

    if (instanceCount === 0) return true;

    const requiredLength = instanceCount * MARKER_INSTANCE_FLOATS;
    const data =
      packedInstances.length === requiredLength
        ? packedInstances
        : packedInstances.subarray(0, requiredLength);

    if (requiredLength > this.#instanceCapacity) {
      this.#instanceCapacity = requiredLength;
      this.#instanceBuffer({ usage: "dynamic", type: "float", data });
    } else {
      this.#instanceBuffer.subdata(data);
    }

    return true;
  }

  drawUploaded(
    instanceCount: number,
    camera: CameraTransform,
    drawOffset: Point2D,
    logicalWidth: number,
    logicalHeight: number,
  ): boolean {
    if (
      !this.#regl ||
      !this.#instanceBuffer ||
      !this.#drawCommand ||
      !this.#available
    )
      return false;

    if (instanceCount === 0) {
      this.clear();
      return true;
    }

    this.#regl.clear(CLEAR_OPTIONS);
    this.#centre[0] = camera.centre.x;
    this.#centre[1] = camera.centre.y;
    this.#drawOffset[0] = drawOffset.x;
    this.#drawOffset[1] = drawOffset.y;
    this.#drawProps.instanceCount = instanceCount;
    this.#drawProps.logicalWidth = logicalWidth;
    this.#drawProps.logicalHeight = logicalHeight;
    this.#drawProps.layoutHeight = camera.layoutHeight;
    this.#drawProps.zoom = camera.zoom;
    this.#drawProps.panX = camera.panX;
    this.#drawProps.panY = camera.panY;
    this.#drawProps.upmScale = camera.upmScale;
    this.#drawProps.padding = camera.padding;
    this.#drawProps.descender = camera.descender;
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
          u_zoom: prop("zoom"),
          u_pan_x: prop("panX"),
          u_pan_y: prop("panY"),
          u_centre: prop("centre"),
          u_upm_scale: prop("upmScale"),
          u_logical_width: prop("logicalWidth"),
          u_logical_height: prop("logicalHeight"),
          u_layout_height: prop("layoutHeight"),
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
      console.warn(
        "[MarkerLayer] Failed to initialize WebGL marker renderer",
        error,
      );
      this.#available = false;
      this.#regl = null;
      this.#instanceBuffer = null;
      this.#drawCommand = null;
      this.#instanceCapacity = 0;
    }
  }
}
