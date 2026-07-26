// Derived from the MIT-licensed Slug implementation described in THIRD_PARTY.md.
// This variant resolves resident multi-source geometry and rebuilds visible bands on GPU.

struct GlobalParams {
    viewport_size: vec2<f32>,
    cell_padding: f32,
    _padding: f32,
};

struct VariableParams {
    instance_count: u32,
    band_count: u32,
    _padding: vec2<u32>,
};

struct Instance {
    pixel_rect: vec4<f32>,
    em_transform: vec4<f32>,
    // atlas glyph, scratch curve start, scratch band start, scratch index start
    glyph: vec4<u32>,
};

struct Curve {
    p0: vec2<f32>,
    p1: vec2<f32>,
    p2: vec2<f32>,
};

struct VariableGlyph {
    bounds: vec4<f32>,
    curve_start: u32,
    curve_count: u32,
    source_start: u32,
    source_count: u32,
};

struct VariableSource {
    delta_start: u32,
    weight_index: u32,
};

struct Band {
    start: u32,
    count: u32,
};

struct VertexOutput {
    @builtin(position) position: vec4<f32>,
    @location(0) @interpolate(flat) em_scale: vec2<f32>,
    @location(1) @interpolate(flat) em_offset: vec2<f32>,
    @location(2) @interpolate(flat) instance_index: u32,
};

@group(0) @binding(0) var<uniform> params: GlobalParams;
@group(0) @binding(1) var<storage, read> instances: array<Instance>;
@group(1) @binding(0) var<storage, read> base_curves: array<Curve>;
@group(1) @binding(1) var<storage, read> curve_deltas: array<Curve>;
@group(1) @binding(2) var<storage, read> variable_glyphs: array<VariableGlyph>;
@group(1) @binding(3) var<storage, read> variable_sources: array<VariableSource>;
@group(1) @binding(4) var<storage, read> source_weights: array<f32>;
@group(1) @binding(5) var<uniform> variable: VariableParams;
@group(1) @binding(6) var<storage, read> line_bits: array<u32>;
@group(1) @binding(7) var<storage, read> sparse_deltas: array<u32>;
@group(2) @binding(0) var<storage, read_write> resolved_curves: array<Curve>;
@group(2) @binding(1) var<storage, read_write> resolved_bands: array<Band>;
@group(2) @binding(2) var<storage, read_write> resolved_indices: array<u32>;
@group(2) @binding(3) var<storage, read_write> resolved_glyph_bounds: array<vec4<f32>>;

var<workgroup> workgroup_curve_bounds: array<vec4<f32>, 64>;

fn scale_curve(curve: Curve, scale: f32) -> Curve {
    var result: Curve;
    result.p0 = curve.p0 * scale;
    result.p1 = curve.p1 * scale;
    result.p2 = curve.p2 * scale;
    return result;
}

fn add_scaled_curve(base: Curve, delta: Curve, weight: f32) -> Curve {
    var curve: Curve;
    curve.p0 = base.p0 + delta.p0 * weight;
    curve.p1 = base.p1 + delta.p1 * weight;
    curve.p2 = base.p2 + delta.p2 * weight;
    return curve;
}

fn regenerate_line_control(curve: Curve) -> Curve {
    var result = curve;
    let delta = curve.p2 - curve.p0;
    result.p1 = (curve.p0 + curve.p2) * 0.5;
    if abs(delta.x) > 0.1 && abs(delta.y) > 0.1 {
        let segment_length = length(delta);
        if segment_length > 0.0 {
            let scale = 0.125 / segment_length;
            result.p1.x -= delta.y * scale;
            result.p1.y += delta.x * scale;
        }
    }
    return result;
}

@compute @workgroup_size(64)
fn resolve_visible_curves(
    @builtin(workgroup_id) workgroup_id: vec3<u32>,
    @builtin(local_invocation_id) local_id: vec3<u32>,
) {
    let instance_index = workgroup_id.x;
    if instance_index >= variable.instance_count {
        return;
    }

    let instance = instances[instance_index];
    let glyph = variable_glyphs[instance.glyph.x];
    var weight_sum = 0.0;
    for (var source_offset = 0u; source_offset < glyph.source_count; source_offset += 1u) {
        let source = variable_sources[glyph.source_start + source_offset];
        weight_sum += source_weights[source.weight_index];
    }

    let maximum_f32 = 3.402823466e+38;
    var local_min = vec2<f32>(maximum_f32);
    var local_max = vec2<f32>(-maximum_f32);
    var local_curve = local_id.x;
    while local_curve < glyph.curve_count {
        let source_index = glyph.curve_start + local_curve;
        var curve = scale_curve(base_curves[source_index], weight_sum);
        for (var source_offset = 0u; source_offset < glyph.source_count; source_offset += 1u) {
            let source = variable_sources[glyph.source_start + source_offset];
            if source.delta_start == 0xffffffffu {
                continue;
            }

            var delta_start = source.delta_start;
            var delta_offset = local_curve;
            if (source.delta_start & 0x80000000u) != 0u {
                let descriptor_start = source.delta_start & 0x7fffffffu;
                delta_start = sparse_deltas[descriptor_start];
                let delta_count = sparse_deltas[descriptor_start + 1u];
                let index_start = descriptor_start + 2u;
                delta_offset = 0xffffffffu;
                var lower = 0u;
                var upper = delta_count;
                while lower < upper {
                    let middle = lower + (upper - lower) / 2u;
                    let candidate = sparse_deltas[index_start + middle];
                    if candidate < local_curve {
                        lower = middle + 1u;
                    } else {
                        upper = middle;
                    }
                }
                if lower < delta_count
                    && sparse_deltas[index_start + lower] == local_curve
                {
                    delta_offset = lower;
                }
            }
            if delta_offset != 0xffffffffu {
                curve = add_scaled_curve(
                    curve,
                    curve_deltas[delta_start + delta_offset],
                    source_weights[source.weight_index],
                );
            }
        }
        let line_word = line_bits[source_index / 32u];
        if (line_word & (1u << (source_index % 32u))) != 0u {
            curve = regenerate_line_control(curve);
        }
        let bounds = curve_bounds(curve);
        local_min = min(local_min, bounds.xy);
        local_max = max(local_max, bounds.zw);
        resolved_curves[instance.glyph.y + local_curve] = curve;
        local_curve += 64u;
    }

    workgroup_curve_bounds[local_id.x] = vec4<f32>(local_min, local_max);
    workgroupBarrier();
    for (var stride = 32u; stride > 0u; stride /= 2u) {
        if local_id.x < stride {
            let other = workgroup_curve_bounds[local_id.x + stride];
            let current = workgroup_curve_bounds[local_id.x];
            workgroup_curve_bounds[local_id.x] = vec4<f32>(
                min(current.xy, other.xy),
                max(current.zw, other.zw),
            );
        }
        workgroupBarrier();
    }
    if local_id.x == 0u {
        resolved_glyph_bounds[instance_index] = select(
            workgroup_curve_bounds[0],
            glyph.bounds,
            glyph.curve_count == 0u,
        );
    }
}

fn curve_bounds(curve: Curve) -> vec4<f32> {
    return vec4<f32>(
        min(min(curve.p0.x, curve.p1.x), curve.p2.x),
        min(min(curve.p0.y, curve.p1.y), curve.p2.y),
        max(max(curve.p0.x, curve.p1.x), curve.p2.x),
        max(max(curve.p0.y, curve.p1.y), curve.p2.y),
    );
}

@compute @workgroup_size(1)
fn rebuild_visible_bands(@builtin(workgroup_id) workgroup_id: vec3<u32>) {
    let bands_per_glyph = variable.band_count * 2u;
    let instance_index = workgroup_id.x / bands_per_glyph;
    if instance_index >= variable.instance_count {
        return;
    }

    let local_band = workgroup_id.x % bands_per_glyph;
    let instance = instances[instance_index];
    let glyph = variable_glyphs[instance.glyph.x];
    let horizontal = local_band < variable.band_count;
    let direction_band = select(local_band - variable.band_count, local_band, horizontal);
    let glyph_bounds = resolved_glyph_bounds[instance_index];
    let glyph_size = max(glyph_bounds.zw - glyph_bounds.xy, vec2<f32>(0.0001));
    let axis_min = select(glyph_bounds.x, glyph_bounds.y, horizontal);
    let axis_size = select(glyph_size.x, glyph_size.y, horizontal);
    let band_min = axis_min + axis_size * f32(direction_band) / f32(variable.band_count);
    let band_max = axis_min + axis_size * f32(direction_band + 1u) / f32(variable.band_count);
    let output_start = instance.glyph.w + local_band * glyph.curve_count;

    var count = 0u;
    for (var local_curve = 0u; local_curve < glyph.curve_count; local_curve += 1u) {
        let curve_index = instance.glyph.y + local_curve;
        let bounds = curve_bounds(resolved_curves[curve_index]);
        let curve_min = select(bounds.x, bounds.y, horizontal);
        let curve_max = select(bounds.z, bounds.w, horizontal);
        if curve_max >= band_min && curve_min <= band_max {
            resolved_indices[output_start + count] = curve_index;
            count += 1u;
        }
    }

    resolved_bands[instance.glyph.z + local_band] = Band(output_start, count);
}

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
fn vertex_variable(
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
    output.em_scale = instance.em_transform.xy;
    output.em_offset = instance.em_transform.zw;
    output.instance_index = instance_index;
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

fn variable_curve_ranges(position_em: vec2<f32>, instance_index: u32) -> vec4<u32> {
    let instance = instances[instance_index];
    let glyph_bounds = resolved_glyph_bounds[instance_index];
    let glyph_size = max(glyph_bounds.zw - glyph_bounds.xy, vec2<f32>(0.0001));
    let band_position = (position_em - glyph_bounds.xy) * f32(variable.band_count) / glyph_size;
    let maximum_band = f32(variable.band_count - 1u);
    let selected = vec2<u32>(clamp(band_position, vec2<f32>(0.0), vec2<f32>(maximum_band)));
    let horizontal = resolved_bands[instance.glyph.z + selected.y];
    let vertical = resolved_bands[
        instance.glyph.z + variable.band_count + selected.x
    ];
    return vec4<u32>(horizontal.start, horizontal.count, vertical.start, vertical.count);
}

fn variable_coverage(render_coordinate: vec2<f32>, ranges: vec4<u32>) -> f32 {
    let ems_per_pixel = max(fwidth(render_coordinate), vec2<f32>(1.0 / 65536.0));
    let pixels_per_em = 1.0 / ems_per_pixel;

    var x_coverage = 0.0;
    var x_weight = 0.0;
    for (var offset = 0u; offset < ranges.y; offset += 1u) {
        let curve = resolved_curves[resolved_indices[ranges.x + offset]];
        let p0 = curve.p0 - render_coordinate;
        let p1 = curve.p1 - render_coordinate;
        let p2 = curve.p2 - render_coordinate;
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
        let curve = resolved_curves[resolved_indices[ranges.z + offset]];
        let p0 = curve.p0 - render_coordinate;
        let p1 = curve.p1 - render_coordinate;
        let p2 = curve.p2 - render_coordinate;
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
fn fragment_variable(input: VertexOutput) -> @location(0) vec4<f32> {
    let position_em = input.position.xy * input.em_scale + input.em_offset;
    let coverage = variable_coverage(
        position_em,
        variable_curve_ranges(position_em, input.instance_index),
    );
    return vec4<f32>(0.0, 0.0, 0.0, coverage);
}
