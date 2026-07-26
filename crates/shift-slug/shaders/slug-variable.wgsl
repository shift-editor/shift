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

struct PreviewParams {
    color: vec4<f32>,
    // view height, font-space top, preview height, font-space side margin
    geometry: vec4<f32>,
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

struct VariableComponentGlyph {
    part_start: u32,
    part_count: u32,
    component_start: u32,
    component_count: u32,
    root_glyph_index: u32,
    _padding: u32,
};

struct VariableComponentPart {
    glyph_index: u32,
    component_index: u32,
    output_curve_start: u32,
    _padding: u32,
};

struct VariableComponent {
    parent_component: u32,
    source_start: u32,
    source_count: u32,
    source_anchor_start: u32,
    source_anchor_count: u32,
    target_anchor_start: u32,
    target_anchor_count: u32,
    target_component: u32,
};

struct VariableComponentSource {
    weight_index: u32,
    translate_x: f32,
    translate_y: f32,
    rotation: f32,
    scale_x: f32,
    scale_y: f32,
    skew_x: f32,
    skew_y: f32,
    center_x: f32,
    center_y: f32,
};

struct VariableAnchorSource {
    weight_index: u32,
    x: f32,
    y: f32,
};

struct Affine {
    linear: vec4<f32>,
    translation: vec2<f32>,
    _padding: vec2<f32>,
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
@group(1) @binding(8) var<storage, read> source_advances: array<f32>;
@group(1) @binding(9) var<storage, read> component_glyphs: array<VariableComponentGlyph>;
@group(1) @binding(10) var<storage, read> component_parts: array<VariableComponentPart>;
@group(1) @binding(11) var<storage, read> components: array<VariableComponent>;
@group(1) @binding(12) var<storage, read> component_sources: array<VariableComponentSource>;
@group(1) @binding(13) var<storage, read> anchor_sources: array<VariableAnchorSource>;
@group(2) @binding(0) var<storage, read_write> resolved_curves: array<Curve>;
@group(2) @binding(1) var<storage, read_write> resolved_bands: array<Band>;
@group(2) @binding(2) var<storage, read_write> resolved_indices: array<u32>;
@group(2) @binding(3) var<storage, read_write> resolved_glyph_bounds: array<vec4<f32>>;
@group(2) @binding(4) var<storage, read_write> resolved_glyph_advances: array<f32>;
@group(2) @binding(5) var<storage, read_write> resolved_component_transforms: array<Affine>;
@group(3) @binding(0) var<storage, read> preview_resolved_advances: array<f32>;
@group(3) @binding(1) var<uniform> preview: PreviewParams;

var<workgroup> workgroup_curve_bounds: array<vec4<f32>, 64>;
var<workgroup> workgroup_transform_start: u32;

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

fn direct_weight_sum(glyph: VariableGlyph) -> f32 {
    var result = 0.0;
    for (var source_offset = 0u; source_offset < glyph.source_count; source_offset += 1u) {
        let source = variable_sources[glyph.source_start + source_offset];
        result += source_weights[source.weight_index];
    }
    return result;
}

fn direct_advance(glyph: VariableGlyph) -> f32 {
    var result = 0.0;
    for (var source_offset = 0u; source_offset < glyph.source_count; source_offset += 1u) {
        let source_index = glyph.source_start + source_offset;
        let source = variable_sources[source_index];
        result += source_advances[source_index] * source_weights[source.weight_index];
    }
    return result;
}

fn resolve_direct_curve(glyph: VariableGlyph, local_curve: u32, weight_sum: f32) -> Curve {
    let curve_index = glyph.curve_start + local_curve;
    var curve = scale_curve(base_curves[curve_index], weight_sum);
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
            if lower < delta_count && sparse_deltas[index_start + lower] == local_curve {
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
    return curve;
}

fn direct_curve_is_line(glyph: VariableGlyph, local_curve: u32) -> bool {
    let curve_index = glyph.curve_start + local_curve;
    return (line_bits[curve_index / 32u] & (1u << (curve_index % 32u))) != 0u;
}

fn identity_affine() -> Affine {
    return Affine(vec4<f32>(1.0, 0.0, 0.0, 1.0), vec2<f32>(0.0), vec2<f32>(0.0));
}

fn transform_point(transform: Affine, point: vec2<f32>) -> vec2<f32> {
    return vec2<f32>(
        transform.linear.x * point.x + transform.linear.z * point.y + transform.translation.x,
        transform.linear.y * point.x + transform.linear.w * point.y + transform.translation.y,
    );
}

fn transform_curve(transform: Affine, curve: Curve) -> Curve {
    var result: Curve;
    result.p0 = transform_point(transform, curve.p0);
    result.p1 = transform_point(transform, curve.p1);
    result.p2 = transform_point(transform, curve.p2);
    return result;
}

fn compose_affine(outer: Affine, inner: Affine) -> Affine {
    let xx = outer.linear.x * inner.linear.x + outer.linear.z * inner.linear.y;
    let xy = outer.linear.y * inner.linear.x + outer.linear.w * inner.linear.y;
    let yx = outer.linear.x * inner.linear.z + outer.linear.z * inner.linear.w;
    let yy = outer.linear.y * inner.linear.z + outer.linear.w * inner.linear.w;
    let translation = transform_point(outer, inner.translation);
    return Affine(vec4<f32>(xx, xy, yx, yy), translation, vec2<f32>(0.0));
}

fn component_affine(component: VariableComponent) -> Affine {
    var values = array<f32, 9>();
    for (var source_offset = 0u; source_offset < component.source_count; source_offset += 1u) {
        let source = component_sources[component.source_start + source_offset];
        let weight = source_weights[source.weight_index];
        values[0] += source.translate_x * weight;
        values[1] += source.translate_y * weight;
        values[2] += source.rotation * weight;
        values[3] += source.scale_x * weight;
        values[4] += source.scale_y * weight;
        values[5] += source.skew_x * weight;
        values[6] += source.skew_y * weight;
        values[7] += source.center_x * weight;
        values[8] += source.center_y * weight;
    }

    let radians = 0.017453292519943295;
    let cos_rotation = cos(values[2] * radians);
    let sin_rotation = sin(values[2] * radians);
    let tan_skew_x = tan(values[5] * radians);
    let tan_skew_y = tan(values[6] * radians);
    let xx = values[3] * cos_rotation + values[4] * tan_skew_x * sin_rotation;
    let xy = values[3] * sin_rotation - values[4] * tan_skew_x * cos_rotation;
    let yx = -values[4] * sin_rotation + values[3] * tan_skew_y * cos_rotation;
    let yy = values[4] * cos_rotation + values[3] * tan_skew_y * sin_rotation;
    let dx = values[0] + values[7] - (xx * values[7] + yx * values[8]);
    let dy = values[1] + values[8] - (xy * values[7] + yy * values[8]);
    return Affine(vec4<f32>(xx, xy, yx, yy), vec2<f32>(dx, dy), vec2<f32>(0.0));
}

fn anchor_point(source_start: u32, source_count: u32) -> vec2<f32> {
    var result = vec2<f32>(0.0);
    for (var source_offset = 0u; source_offset < source_count; source_offset += 1u) {
        let source = anchor_sources[source_start + source_offset];
        result += vec2<f32>(source.x, source.y) * source_weights[source.weight_index];
    }
    return result;
}

fn transform_scratch_start(instance_index: u32) -> u32 {
    var result = 0u;
    for (var prior_instance = 0u; prior_instance < instance_index; prior_instance += 1u) {
        let glyph = variable_glyphs[instances[prior_instance].glyph.x];
        if (glyph.source_start & 0x80000000u) != 0u {
            let descriptor = component_glyphs[glyph.source_start & 0x7fffffffu];
            result += descriptor.component_count * 2u;
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
    let is_component_glyph = (glyph.source_start & 0x80000000u) != 0u;
    let maximum_f32 = 3.402823466e+38;
    var local_min = vec2<f32>(maximum_f32);
    var local_max = vec2<f32>(-maximum_f32);
    var glyph_advance = 0.0;

    if is_component_glyph {
        let descriptor = component_glyphs[glyph.source_start & 0x7fffffffu];
        let root_glyph = variable_glyphs[descriptor.root_glyph_index];
        glyph_advance = direct_advance(root_glyph);
        if local_id.x == 0u {
            workgroup_transform_start = transform_scratch_start(instance_index);
        }
        workgroupBarrier();

        if local_id.x == 0u {
            let local_start = workgroup_transform_start;
            let resolved_start = local_start + descriptor.component_count;
            for (var component_index = 0u; component_index < descriptor.component_count; component_index += 1u) {
                let component = components[descriptor.component_start + component_index];
                var local_transform = component_affine(component);
                if component.target_component != 0xffffffffu {
                    let source_anchor = anchor_point(
                        component.source_anchor_start,
                        component.source_anchor_count,
                    );
                    let target_anchor = anchor_point(
                        component.target_anchor_start,
                        component.target_anchor_count,
                    );
                    let source = transform_point(local_transform, source_anchor);
                    let target_transform = resolved_component_transforms[
                        local_start + component.target_component
                    ];
                    let target_point = transform_point(target_transform, target_anchor);
                    local_transform.translation += target_point - source;
                }
                var parent_transform = identity_affine();
                if component.parent_component != 0xffffffffu {
                    parent_transform = resolved_component_transforms[
                        resolved_start + component.parent_component
                    ];
                }
                resolved_component_transforms[local_start + component_index] = local_transform;
                resolved_component_transforms[resolved_start + component_index] = compose_affine(
                    parent_transform,
                    local_transform,
                );
            }
        }
        storageBarrier();
        workgroupBarrier();

        let resolved_start = workgroup_transform_start + descriptor.component_count;
        for (var part_offset = 0u; part_offset < descriptor.part_count; part_offset += 1u) {
            let part = component_parts[descriptor.part_start + part_offset];
            let direct_glyph = variable_glyphs[part.glyph_index];
            let weight_sum = direct_weight_sum(direct_glyph);
            var transform = identity_affine();
            if part.component_index != 0xffffffffu {
                transform = resolved_component_transforms[resolved_start + part.component_index];
            }
            var part_curve = local_id.x;
            while part_curve < direct_glyph.curve_count {
                var curve = transform_curve(
                    transform,
                    resolve_direct_curve(direct_glyph, part_curve, weight_sum),
                );
                if direct_curve_is_line(direct_glyph, part_curve) {
                    curve = regenerate_line_control(curve);
                }
                let bounds = curve_bounds(curve);
                local_min = min(local_min, bounds.xy);
                local_max = max(local_max, bounds.zw);
                resolved_curves[
                    instance.glyph.y + part.output_curve_start + part_curve
                ] = curve;
                part_curve += 64u;
            }
        }
    } else {
        let weight_sum = direct_weight_sum(glyph);
        glyph_advance = direct_advance(glyph);
        var local_curve = local_id.x;
        while local_curve < glyph.curve_count {
            var curve = resolve_direct_curve(glyph, local_curve, weight_sum);
            if direct_curve_is_line(glyph, local_curve) {
                curve = regenerate_line_control(curve);
            }
            let bounds = curve_bounds(curve);
            local_min = min(local_min, bounds.xy);
            local_max = max(local_max, bounds.zw);
            resolved_curves[instance.glyph.y + local_curve] = curve;
            local_curve += 64u;
        }
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
        resolved_glyph_advances[instance_index] = glyph_advance;
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

// Advance-fitted preview path. Consumers provide the content rectangle and
// layout values; this shader owns no row, cell, gap, or padding policy.
@vertex
fn vertex_variable_preview(
    @builtin(vertex_index) vertex_index: u32,
    @builtin(instance_index) instance_index: u32,
) -> VertexOutput {
    let instance = instances[instance_index];
    let content_size = max(instance.pixel_rect.zw - instance.pixel_rect.xy, vec2<f32>(1.0));
    let view_height = max(preview.geometry.x, 1.0);
    let advance = preview_resolved_advances[instance_index];
    let side_margin = preview.geometry.w;
    let view_width = max(advance + 2.0 * side_margin, 1.0);
    let requested_size = vec2<f32>(
        max(preview.geometry.z, preview.geometry.z * view_width / view_height),
        preview.geometry.z,
    );
    let preview_size = min(content_size, requested_size);
    let preview_min = (instance.pixel_rect.xy + instance.pixel_rect.zw - preview_size) * 0.5;
    let preview_max = preview_min + preview_size;
    let pixel_position = mix(preview_min, preview_max, quad_coordinate(vertex_index));
    let clip_position = vec2<f32>(
        pixel_position.x / params.viewport_size.x * 2.0 - 1.0,
        1.0 - pixel_position.y / params.viewport_size.y * 2.0,
    );
    let em_scale = vec2<f32>(view_width / preview_size.x, -view_height / preview_size.y);

    var output: VertexOutput;
    output.position = vec4<f32>(clip_position, 0.0, 1.0);
    output.em_scale = em_scale;
    output.em_offset = vec2<f32>(
        -side_margin - preview_min.x * em_scale.x,
        preview.geometry.y - preview_min.y * em_scale.y,
    );
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

@fragment
fn fragment_variable_preview(input: VertexOutput) -> @location(0) vec4<f32> {
    let position_em = input.position.xy * input.em_scale + input.em_offset;
    let coverage = variable_coverage(
        position_em,
        variable_curve_ranges(position_em, input.instance_index),
    );
    let alpha = preview.color.a * coverage;
    return vec4<f32>(preview.color.rgb * alpha, alpha);
}
