export default /* glsl */ `
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
