import REGL from "regl";
import { GPU_HANDLE_INSTANCE_FLOATS, type GpuHandleFrame } from "@/lib/editor/rendering/gpu/types";

const TRIANGLE_HEIGHT_FACTOR = 0.8660254037844386;
const POLYGON_STROKE_SCALE = 0.8;

const UNIT_QUAD = new Float32Array([-1, -1, 1, -1, -1, 1, 1, -1, 1, 1, -1, 1]);

const VERT = `
precision mediump float;

attribute vec2 a_unit;
attribute vec2 a_position;
attribute vec2 a_extent;
attribute float a_rotation;
attribute float a_shape;
attribute float a_size;
attribute float a_line_width;
attribute vec4 a_fill_color;
attribute vec4 a_stroke_color;
attribute vec4 a_overlay_color;
attribute float a_bar_size;
attribute vec4 a_bar_stroke_color;

uniform float u_zoom;
uniform float u_pan_x;
uniform float u_pan_y;
uniform vec2 u_centre;
uniform float u_upm_scale;
uniform float u_logical_width;
uniform float u_logical_height;
uniform float u_padding;
uniform float u_descender;
uniform vec2 u_draw_offset;

varying vec2 v_local;
varying vec2 v_extent;
varying float v_shape;
varying float v_size;
varying float v_line_width;
varying vec4 v_fill_color;
varying vec4 v_stroke_color;
varying vec4 v_overlay_color;
varying float v_bar_size;
varying vec4 v_bar_stroke_color;

vec2 rotatePoint(vec2 p, float angle) {
  float c = cos(angle);
  float s = sin(angle);
  return vec2(c * p.x - s * p.y, s * p.x + c * p.y);
}

vec2 screenToClip(vec2 screen) {
  vec2 zeroToOne = vec2(screen.x / u_logical_width, screen.y / u_logical_height);
  vec2 clip = zeroToOne * 2.0 - 1.0;
  return vec2(clip.x, -clip.y);
}

void main() {
  float baseline_y = u_logical_height - u_padding - u_descender * u_upm_scale;
  vec2 scene = a_position + u_draw_offset;
  vec2 base_screen = vec2(
    scene.x * u_upm_scale + u_padding,
    baseline_y - scene.y * u_upm_scale
  );
  vec2 view_translate = vec2(
    u_pan_x + u_centre.x * (1.0 - u_zoom),
    u_pan_y + u_centre.y * (1.0 - u_zoom)
  );
  vec2 screen = base_screen * u_zoom + view_translate;

  vec2 local = a_unit * a_extent;
  vec2 rotated = rotatePoint(local, -a_rotation);
  vec2 clip = screenToClip(screen + rotated);

  gl_Position = vec4(clip, 0.0, 1.0);
  v_local = local;
  v_extent = a_extent;
  v_shape = a_shape;
  v_size = a_size;
  v_line_width = a_line_width;
  v_fill_color = a_fill_color;
  v_stroke_color = a_stroke_color;
  v_overlay_color = a_overlay_color;
  v_bar_size = a_bar_size;
  v_bar_stroke_color = a_bar_stroke_color;
}
`;

const FRAG = `
#extension GL_OES_standard_derivatives : enable
precision mediump float;

varying vec2 v_local;
varying vec2 v_extent;
varying float v_shape;
varying float v_size;
varying float v_line_width;
varying vec4 v_fill_color;
varying vec4 v_stroke_color;
varying vec4 v_overlay_color;
varying float v_bar_size;
varying vec4 v_bar_stroke_color;

float sdCircle(vec2 p, float r) {
  return length(p) - r;
}

float sdBox(vec2 p, vec2 b) {
  vec2 d = abs(p) - b;
  return length(max(d, 0.0)) + min(max(d.x, d.y), 0.0);
}

float sdSegment(vec2 p, vec2 a, vec2 b) {
  vec2 pa = p - a;
  vec2 ba = b - a;
  float h = clamp(dot(pa, ba) / max(dot(ba, ba), 0.0001), 0.0, 1.0);
  return length(pa - ba * h);
}

float sdTriangle(vec2 p, vec2 p0, vec2 p1, vec2 p2) {
  vec2 e0 = p1 - p0;
  vec2 e1 = p2 - p1;
  vec2 e2 = p0 - p2;
  vec2 v0 = p - p0;
  vec2 v1 = p - p1;
  vec2 v2 = p - p2;
  vec2 pq0 = v0 - e0 * clamp(dot(v0, e0) / max(dot(e0, e0), 0.0001), 0.0, 1.0);
  vec2 pq1 = v1 - e1 * clamp(dot(v1, e1) / max(dot(e1, e1), 0.0001), 0.0, 1.0);
  vec2 pq2 = v2 - e2 * clamp(dot(v2, e2) / max(dot(e2, e2), 0.0001), 0.0, 1.0);
  float s = sign(e0.x * e2.y - e0.y * e2.x);
  vec2 d = min(
    min(vec2(dot(pq0, pq0), s * (v0.x * e0.y - v0.y * e0.x)),
        vec2(dot(pq1, pq1), s * (v1.x * e1.y - v1.y * e1.x))),
    vec2(dot(pq2, pq2), s * (v2.x * e2.y - v2.y * e2.x))
  );
  return -sqrt(d.x) * sign(d.y);
}

float shapeCoverage(float distance) {
  float aa = max(fwidth(distance), 0.75);
  return 1.0 - smoothstep(0.0, aa, distance);
}

float strokeCoverage(float distance, float lineWidth) {
  float aa = max(fwidth(distance), 0.75);
  return 1.0 - smoothstep(lineWidth * 0.5, lineWidth * 0.5 + aa, abs(distance));
}

vec4 compositeStrokeThenFill(float distance, vec4 fillColor, vec4 strokeColor, float lineWidth) {
  float fillMask = shapeCoverage(distance) * fillColor.a;
  float strokeMask = strokeCoverage(distance, lineWidth) * strokeColor.a;
  vec4 color = strokeColor * strokeMask;
  color = mix(color, fillColor, fillMask);
  return color;
}

vec4 compositeFillThenStroke(float distance, vec4 fillColor, vec4 strokeColor, float lineWidth) {
  float fillMask = shapeCoverage(distance) * fillColor.a;
  float strokeMask = strokeCoverage(distance, lineWidth) * strokeColor.a;
  vec4 color = fillColor * fillMask;
  color = mix(color, strokeColor, strokeMask);
  return color;
}

void main() {
  float distance = 10000.0;
  vec4 color = vec4(0.0);
  float coverage = 0.0;

  if (v_shape < 0.5) {
    distance = sdBox(v_local, vec2(v_size * 0.5));
    color = compositeFillThenStroke(
      distance,
      v_fill_color,
      v_stroke_color,
      v_line_width * ${POLYGON_STROKE_SCALE}
    );
    coverage = max(shapeCoverage(distance), strokeCoverage(distance, v_line_width * ${POLYGON_STROKE_SCALE}));
  } else if (v_shape < 1.5) {
    distance = sdCircle(v_local, v_size);
    color = compositeStrokeThenFill(distance, v_fill_color, v_stroke_color, v_line_width);
    coverage = max(shapeCoverage(distance), strokeCoverage(distance, v_line_width));
  } else if (v_shape < 2.5) {
    distance = sdCircle(v_local, v_size);
    color = compositeStrokeThenFill(distance, v_fill_color, v_stroke_color, v_line_width);
    coverage = max(shapeCoverage(distance), strokeCoverage(distance, v_line_width));
  } else if (v_shape < 3.5) {
    distance = sdTriangle(
      v_local,
      vec2(v_size, 0.0),
      vec2(-v_size * 0.5, -v_size * ${TRIANGLE_HEIGHT_FACTOR}),
      vec2(-v_size * 0.5, v_size * ${TRIANGLE_HEIGHT_FACTOR})
    );
    color = compositeFillThenStroke(
      distance,
      v_fill_color,
      v_stroke_color,
      v_line_width * ${POLYGON_STROKE_SCALE}
    );
    coverage = max(shapeCoverage(distance), strokeCoverage(distance, v_line_width * ${POLYGON_STROKE_SCALE}));
  } else if (v_shape < 4.5) {
    float barDistance = sdSegment(
      v_local,
      vec2(0.0, -v_bar_size * 0.5),
      vec2(0.0, v_bar_size * 0.5)
    );
    vec2 triangleCenter = vec2(3.0 + v_size, 0.0);
    float triangleDistance = sdTriangle(
      v_local - triangleCenter,
      vec2(v_size, 0.0),
      vec2(-v_size * 0.5, -v_size * ${TRIANGLE_HEIGHT_FACTOR}),
      vec2(-v_size * 0.5, v_size * ${TRIANGLE_HEIGHT_FACTOR})
    );
    vec4 barColor = v_bar_stroke_color * strokeCoverage(barDistance, v_line_width);
    vec4 triangleColor = compositeFillThenStroke(
      triangleDistance,
      v_fill_color,
      v_stroke_color,
      v_line_width * ${POLYGON_STROKE_SCALE}
    );
    color = barColor;
    color = mix(color, triangleColor, max(triangleColor.a, shapeCoverage(triangleDistance)));
    coverage = max(
      strokeCoverage(barDistance, v_line_width * ${POLYGON_STROKE_SCALE}),
      max(
        shapeCoverage(triangleDistance),
        strokeCoverage(triangleDistance, v_line_width * ${POLYGON_STROKE_SCALE})
      )
    );
  } else {
    distance = sdSegment(
      v_local,
      vec2(-v_size * 0.5, 0.0),
      vec2(v_size * 0.5, 0.0)
    );
    color = v_stroke_color * strokeCoverage(distance, v_line_width * ${POLYGON_STROKE_SCALE});
    coverage = strokeCoverage(distance, v_line_width * ${POLYGON_STROKE_SCALE});
  }

  if (coverage <= 0.0 && color.a <= 0.0) {
    discard;
  }

  if (v_overlay_color.a > 0.0) {
    vec4 overlay = vec4(v_overlay_color.rgb, v_overlay_color.a * coverage);
    color = mix(color, overlay, overlay.a);
  }

  gl_FragColor = color;
}
`;

export class ReglHandleContext {
  #regl: REGL.Regl | null = null;
  #instanceBuffer: REGL.Buffer | null = null;
  #drawCommand: REGL.DrawCommand | null = null;
  #available = false;
  #instanceCapacity = 0;

  resizeCanvas(canvas: HTMLCanvasElement): void {
    const viewportRect = canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.floor(viewportRect.width * dpr);
    canvas.height = Math.floor(viewportRect.height * dpr);

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
    if (!this.#regl || !this.#instanceBuffer || !this.#drawCommand || !this.#available) {
      return false;
    }

    if (frame.instanceCount === 0) {
      this.clear();
      return true;
    }

    if (frame.packedInstances.length > this.#instanceCapacity) {
      this.#instanceCapacity = frame.packedInstances.length;
      this.#instanceBuffer({
        usage: "dynamic",
        type: "float",
        data: frame.packedInstances,
      });
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
      const prop = (name: string) => regl.prop(name as never) as never;

      this.#drawCommand = regl({
        vert: VERT,
        frag: FRAG,
        attributes: {
          a_unit: quadBuffer,
          a_position: {
            buffer: instanceBuffer,
            divisor: 1,
            stride: GPU_HANDLE_INSTANCE_FLOATS * 4,
            offset: 0,
          },
          a_extent: {
            buffer: instanceBuffer,
            divisor: 1,
            stride: GPU_HANDLE_INSTANCE_FLOATS * 4,
            offset: 2 * 4,
          },
          a_rotation: {
            buffer: instanceBuffer,
            divisor: 1,
            stride: GPU_HANDLE_INSTANCE_FLOATS * 4,
            offset: 4 * 4,
          },
          a_shape: {
            buffer: instanceBuffer,
            divisor: 1,
            stride: GPU_HANDLE_INSTANCE_FLOATS * 4,
            offset: 5 * 4,
          },
          a_size: {
            buffer: instanceBuffer,
            divisor: 1,
            stride: GPU_HANDLE_INSTANCE_FLOATS * 4,
            offset: 6 * 4,
          },
          a_line_width: {
            buffer: instanceBuffer,
            divisor: 1,
            stride: GPU_HANDLE_INSTANCE_FLOATS * 4,
            offset: 7 * 4,
          },
          a_fill_color: {
            buffer: instanceBuffer,
            divisor: 1,
            stride: GPU_HANDLE_INSTANCE_FLOATS * 4,
            offset: 8 * 4,
          },
          a_stroke_color: {
            buffer: instanceBuffer,
            divisor: 1,
            stride: GPU_HANDLE_INSTANCE_FLOATS * 4,
            offset: 12 * 4,
          },
          a_overlay_color: {
            buffer: instanceBuffer,
            divisor: 1,
            stride: GPU_HANDLE_INSTANCE_FLOATS * 4,
            offset: 16 * 4,
          },
          a_bar_size: {
            buffer: instanceBuffer,
            divisor: 1,
            stride: GPU_HANDLE_INSTANCE_FLOATS * 4,
            offset: 20 * 4,
          },
          a_bar_stroke_color: {
            buffer: instanceBuffer,
            divisor: 1,
            stride: GPU_HANDLE_INSTANCE_FLOATS * 4,
            offset: 21 * 4,
          },
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
