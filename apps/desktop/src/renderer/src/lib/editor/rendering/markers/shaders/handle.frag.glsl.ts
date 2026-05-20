import sdf from "./sdf.glsl";

const TRIANGLE_HEIGHT_FACTOR = 0.8660254037844386;
const POLYGON_STROKE_SCALE = 0.8;

export default /* glsl */ `
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

${sdf}

void main() {
  float distance = 10000.0;
  vec4 color = vec4(0.0);
  float coverage = 0.0;

  if (v_shape < 0.5) {
    distance = sdBox(v_local, vec2(v_size * 0.5));
    color = compositeFillThenStroke(distance, v_fill_color, v_stroke_color, v_line_width * ${POLYGON_STROKE_SCALE});
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
    color = compositeFillThenStroke(distance, v_fill_color, v_stroke_color, v_line_width * ${POLYGON_STROKE_SCALE});
    coverage = max(shapeCoverage(distance), strokeCoverage(distance, v_line_width * ${POLYGON_STROKE_SCALE}));
  } else if (v_shape < 4.5) {
    float barDistance = sdSegment(v_local, vec2(0.0, -v_bar_size * 0.5), vec2(0.0, v_bar_size * 0.5));
    vec2 triangleCenter = vec2(3.0 + v_size, 0.0);
    float triangleDistance = sdTriangle(
      v_local - triangleCenter,
      vec2(v_size, 0.0),
      vec2(-v_size * 0.5, -v_size * ${TRIANGLE_HEIGHT_FACTOR}),
      vec2(-v_size * 0.5, v_size * ${TRIANGLE_HEIGHT_FACTOR})
    );
    vec4 barColor = v_bar_stroke_color * strokeCoverage(barDistance, v_line_width);
    vec4 triangleColor = compositeFillThenStroke(triangleDistance, v_fill_color, v_stroke_color, v_line_width * ${POLYGON_STROKE_SCALE});
    color = barColor;
    color = mix(color, triangleColor, max(triangleColor.a, shapeCoverage(triangleDistance)));
    coverage = max(
      strokeCoverage(barDistance, v_line_width * ${POLYGON_STROKE_SCALE}),
      max(shapeCoverage(triangleDistance), strokeCoverage(triangleDistance, v_line_width * ${POLYGON_STROKE_SCALE}))
    );
  } else {
    distance = sdSegment(v_local, vec2(-v_size * 0.5, 0.0), vec2(v_size * 0.5, 0.0));
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
