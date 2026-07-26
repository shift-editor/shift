// Derived from the MIT-licensed Slug implementation described in THIRD_PARTY.md.
// Shift keeps atlas ranges wide and checked instead of using packed 24/8-bit fields.

struct GlobalParams {
    viewport_size: vec2<f32>,
    cell_padding: f32,
    _padding: f32,
};

struct Instance {
    pixel_rect: vec4<f32>,
    em_rect: vec4<f32>,
    glyph: vec4<u32>,
};

struct Curve {
    p0: vec2<f32>,
    p1: vec2<f32>,
    p2: vec2<f32>,
};

struct Glyph {
    bounds: vec4<f32>,
    curve_start: u32,
    curve_count: u32,
    band_start: u32,
    band_count: u32,
};

struct Band {
    start: u32,
    count: u32,
};

struct VertexOutput {
    @builtin(position) position: vec4<f32>,
    @location(0) position_em: vec2<f32>,
    @location(1) @interpolate(flat) glyph_index: u32,
};

@group(0) @binding(0) var<uniform> params: GlobalParams;
@group(0) @binding(1) var<storage, read> instances: array<Instance>;
@group(1) @binding(0) var<storage, read> curves: array<Curve>;
@group(1) @binding(1) var<storage, read> curve_indices: array<u32>;
@group(1) @binding(2) var<storage, read> glyphs: array<Glyph>;
@group(1) @binding(3) var<storage, read> bands: array<Band>;

fn quad_coordinate(vertex_index: u32) -> vec2<f32> {
    const coordinates = array<vec2<f32>, 6>(
        vec2<f32>(0.0, 0.0),
        vec2<f32>(1.0, 0.0),
        vec2<f32>(0.0, 1.0),
        vec2<f32>(0.0, 1.0),
        vec2<f32>(1.0, 0.0),
        vec2<f32>(1.0, 1.0),
    );
    return coordinates[vertex_index];
}

@vertex
fn vertex_main(
    @builtin(vertex_index) vertex_index: u32,
    @builtin(instance_index) instance_index: u32,
) -> VertexOutput {
    let instance = instances[instance_index];
    let uv = quad_coordinate(vertex_index);
    let cell_min = instance.pixel_rect.xy + vec2<f32>(params.cell_padding);
    let cell_max = instance.pixel_rect.zw - vec2<f32>(params.cell_padding);
    let pixel_position = mix(cell_min, cell_max, uv);
    let clip_position = vec2<f32>(
        pixel_position.x / params.viewport_size.x * 2.0 - 1.0,
        1.0 - pixel_position.y / params.viewport_size.y * 2.0,
    );

    var output: VertexOutput;
    output.position = vec4<f32>(clip_position, 0.0, 1.0);
    output.position_em = vec2<f32>(
        mix(instance.em_rect.x, instance.em_rect.z, uv.x),
        mix(instance.em_rect.w, instance.em_rect.y, uv.y),
    );
    output.glyph_index = instance.glyph.x;
    return output;
}

fn calculate_root_code(y1: f32, y2: f32, y3: f32) -> u32 {
    let i1 = bitcast<u32>(y1) >> 31u;
    let i2 = bitcast<u32>(y2) >> 30u;
    let i3 = bitcast<u32>(y3) >> 29u;
    let shift = (i3 & 4u) | (((i2 & 2u) | (i1 & ~2u)) & ~4u);
    return (0x2E74u >> shift) & 0x0101u;
}

fn solve_horizontal(p0: vec2<f32>, p1: vec2<f32>, p2: vec2<f32>) -> vec2<f32> {
    let a = p0 - p1 * 2.0 + p2;
    let b = p0 - p1;
    let reciprocal_a = 1.0 / a.y;
    let reciprocal_b = 0.5 / b.y;
    let discriminant = sqrt(max(b.y * b.y - a.y * p0.y, 0.0));
    var t1 = (b.y - discriminant) * reciprocal_a;
    var t2 = (b.y + discriminant) * reciprocal_a;

    if abs(a.y) < 1.0 / 65536.0 {
        t1 = p0.y * reciprocal_b;
        t2 = p0.y * reciprocal_b;
    }

    return vec2<f32>(
        (a.x * t1 - b.x * 2.0) * t1 + p0.x,
        (a.x * t2 - b.x * 2.0) * t2 + p0.x,
    );
}

fn solve_vertical(p0: vec2<f32>, p1: vec2<f32>, p2: vec2<f32>) -> vec2<f32> {
    let a = p0 - p1 * 2.0 + p2;
    let b = p0 - p1;
    let reciprocal_a = 1.0 / a.x;
    let reciprocal_b = 0.5 / b.x;
    let discriminant = sqrt(max(b.x * b.x - a.x * p0.x, 0.0));
    var t1 = (b.x - discriminant) * reciprocal_a;
    var t2 = (b.x + discriminant) * reciprocal_a;

    if abs(a.x) < 1.0 / 65536.0 {
        t1 = p0.x * reciprocal_b;
        t2 = p0.x * reciprocal_b;
    }

    return vec2<f32>(
        (a.y * t1 - b.y * 2.0) * t1 + p0.y,
        (a.y * t2 - b.y * 2.0) * t2 + p0.y,
    );
}

fn calculate_coverage(x_coverage: f32, y_coverage: f32, x_weight: f32, y_weight: f32) -> f32 {
    let weighted = abs(x_coverage * x_weight + y_coverage * y_weight)
        / max(x_weight + y_weight, 1.0 / 65536.0);
    let coverage = saturate(max(weighted, min(abs(x_coverage), abs(y_coverage))));
    return sqrt(coverage);
}

fn curve_ranges(position_em: vec2<f32>, glyph_index: u32) -> vec4<u32> {
    let glyph = glyphs[glyph_index];
    let glyph_size = max(glyph.bounds.zw - glyph.bounds.xy, vec2<f32>(0.0001));
    let band_position = (position_em - glyph.bounds.xy) * f32(glyph.band_count) / glyph_size;
    let maximum_band = f32(glyph.band_count - 1u);
    let selected = vec2<u32>(clamp(band_position, vec2<f32>(0.0), vec2<f32>(maximum_band)));
    let horizontal = bands[glyph.band_start + selected.y];
    let vertical = bands[glyph.band_start + glyph.band_count + selected.x];
    return vec4<u32>(horizontal.start, horizontal.count, vertical.start, vertical.count);
}

fn slug_coverage(render_coordinate: vec2<f32>, ranges: vec4<u32>) -> f32 {
    let ems_per_pixel = max(fwidth(render_coordinate), vec2<f32>(1.0 / 65536.0));
    let pixels_per_em = 1.0 / ems_per_pixel;

    var x_coverage = 0.0;
    var x_weight = 0.0;
    for (var offset = 0u; offset < ranges.y; offset += 1u) {
        let curve = curves[curve_indices[ranges.x + offset]];
        let p0 = curve.p0 - render_coordinate;
        let p1 = curve.p1 - render_coordinate;
        let p2 = curve.p2 - render_coordinate;
        if max(max(p0.x, p1.x), p2.x) * pixels_per_em.x < -0.5 {
            break;
        }

        let code = calculate_root_code(p0.y, p1.y, p2.y);
        if code != 0u {
            let roots = solve_horizontal(p0, p1, p2) * pixels_per_em.y;
            if (code & 1u) != 0u {
                x_coverage += saturate(roots.x + 0.5);
                x_weight = max(x_weight, saturate(1.0 - abs(roots.x) * 2.0));
            }
            if code > 1u {
                x_coverage -= saturate(roots.y + 0.5);
                x_weight = max(x_weight, saturate(1.0 - abs(roots.y) * 2.0));
            }
        }
    }

    var y_coverage = 0.0;
    var y_weight = 0.0;
    for (var offset = 0u; offset < ranges.w; offset += 1u) {
        let curve = curves[curve_indices[ranges.z + offset]];
        let p0 = curve.p0 - render_coordinate;
        let p1 = curve.p1 - render_coordinate;
        let p2 = curve.p2 - render_coordinate;
        if max(max(p0.y, p1.y), p2.y) * pixels_per_em.y < -0.5 {
            break;
        }

        let code = calculate_root_code(p0.x, p1.x, p2.x);
        if code != 0u {
            let roots = solve_vertical(p0, p1, p2) * pixels_per_em.x;
            if (code & 1u) != 0u {
                y_coverage -= saturate(roots.x + 0.5);
                y_weight = max(y_weight, saturate(1.0 - abs(roots.x) * 2.0));
            }
            if code > 1u {
                y_coverage += saturate(roots.y + 0.5);
                y_weight = max(y_weight, saturate(1.0 - abs(roots.y) * 2.0));
            }
        }
    }

    return calculate_coverage(x_coverage, y_coverage, x_weight, y_weight);
}

@fragment
fn fragment_main(input: VertexOutput) -> @location(0) vec4<f32> {
    let coverage = slug_coverage(input.position_em, curve_ranges(input.position_em, input.glyph_index));
    return vec4<f32>(0.0, 0.0, 0.0, coverage);
}
