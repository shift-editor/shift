#![cfg(feature = "wgpu-benchmark")]

use std::{num::NonZeroU64, sync::mpsc};

use shift_font::{
    test_support::sample_variable_font, Anchor, Component, Contour, DecomposedTransform, Glyph,
    GlyphId, GlyphLayer, LayerId, Location, PointType,
};
use shift_slug::{
    add_authored_glyph_with_weight_sets, pack_render_instances, AuthoredWeightSet, Curve,
    RenderInstance, Section, VariableAtlasBuilder, VariableLayout, VARIABLE_SLUG_WGSL,
};
use wgpu::{
    util::{BufferInitDescriptor, DeviceExt},
    BindGroupEntry, BindingResource, BufferBinding, BufferDescriptor, BufferUsages,
    CommandEncoderDescriptor, ComputePassDescriptor, ComputePipelineDescriptor, DeviceDescriptor,
    MapMode, MemoryHints, PipelineCompilationOptions, PollType, PowerPreference,
    RequestAdapterOptions, ShaderModuleDescriptor, ShaderSource,
};

#[test]
fn gpu_resolves_varying_component_transforms_and_attachments() {
    let (font, root_id) = component_font();
    let projection = font.glyph_projection(&root_id).unwrap().unwrap();
    let interpolation = projection.interpolation().unwrap();
    let weight_indices = [1, 2];
    let weight_set =
        AuthoredWeightSet::new(interpolation.basis().clone(), weight_indices.to_vec()).unwrap();
    let mut builder = VariableAtlasBuilder::default();
    let authored =
        add_authored_glyph_with_weight_sets(&mut builder, &font, &projection, &[weight_set], 0)
            .unwrap();
    let atlas = builder.finish();

    let mut location = Location::new();
    location.set(font.axes()[0].id(), 600.0);
    let source_weights = interpolation
        .basis()
        .weights_at(&location, font.axes())
        .unwrap();
    let mut weights = vec![1.0_f32, 0.0, 0.0];
    for (weight_index, weight) in weight_indices.iter().zip(source_weights) {
        weights[*weight_index as usize] = weight as f32;
    }
    let expected = atlas
        .resolve_glyph_with_weights(authored.default_glyph, &weights)
        .unwrap();
    let expected_advance = atlas
        .resolve_advance_with_weights(authored.default_glyph, &weights)
        .unwrap();
    let glyph = atlas.glyphs()[authored.default_glyph as usize];
    let descriptor = atlas.component_glyphs()[(glyph.source_start & 0x7fff_ffff) as usize];
    let packed = atlas.pack(256).unwrap();
    let layout = packed.layout();

    let instance = RenderInstance {
        pixel_rect: [0.0, 0.0, 64.0, 64.0],
        em_transform: [1.0, 1.0, 0.0, 0.0],
        glyph_index: authored.default_glyph,
        scratch_curve_start: 0,
        scratch_band_start: 0,
        scratch_index_start: 0,
    };
    let instance_bytes = pack_render_instances(&[instance]).unwrap();
    let mut variable_params = [0_u8; 16];
    variable_params[0..4].copy_from_slice(&1_u32.to_le_bytes());
    variable_params[4..8].copy_from_slice(&atlas.band_count().to_le_bytes());
    let weight_bytes = weights
        .iter()
        .flat_map(|weight| weight.to_le_bytes())
        .collect::<Vec<_>>();

    let gpu = pollster::block_on(async {
        let instance = wgpu::Instance::default();
        let adapter = instance
            .request_adapter(&RequestAdapterOptions {
                power_preference: PowerPreference::HighPerformance,
                force_fallback_adapter: false,
                compatible_surface: None,
                apply_limit_buckets: false,
            })
            .await
            .ok()?;
        if adapter.limits().max_storage_buffers_per_shader_stage < 18 {
            return None;
        }
        let limits = wgpu::Limits {
            max_storage_buffers_per_shader_stage: 18,
            ..Default::default()
        };
        adapter
            .request_device(&DeviceDescriptor {
                label: Some("shift-slug component test device"),
                required_features: wgpu::Features::empty(),
                required_limits: limits,
                experimental_features: Default::default(),
                memory_hints: MemoryHints::Performance,
                trace: wgpu::Trace::Off,
            })
            .await
            .ok()
    });
    let Some((device, queue)) = gpu else {
        eprintln!("skipping component GPU test: no adapter with 18 storage bindings");
        return;
    };

    let atlas_buffer = device.create_buffer_init(&BufferInitDescriptor {
        label: Some("shift-slug component test atlas"),
        contents: packed.as_bytes(),
        usage: BufferUsages::STORAGE,
    });
    let instance_buffer = device.create_buffer_init(&BufferInitDescriptor {
        label: Some("shift-slug component test instance"),
        contents: &instance_bytes,
        usage: BufferUsages::STORAGE,
    });
    let variable_buffer = device.create_buffer_init(&BufferInitDescriptor {
        label: Some("shift-slug component test params"),
        contents: &variable_params,
        usage: BufferUsages::UNIFORM,
    });
    let weight_buffer = device.create_buffer_init(&BufferInitDescriptor {
        label: Some("shift-slug component test weights"),
        contents: &weight_bytes,
        usage: BufferUsages::STORAGE,
    });
    let curve_buffer = storage_buffer(
        &device,
        "shift-slug component test curves",
        expected.len() * 24,
    );
    let bounds_buffer = storage_buffer(&device, "shift-slug component test bounds", 16);
    let advance_buffer = storage_buffer(&device, "shift-slug component test advance", 4);
    let transform_buffer = storage_buffer(
        &device,
        "shift-slug component test transforms",
        descriptor.component_count as usize * 2 * 32,
    );
    let readback = device.create_buffer(&BufferDescriptor {
        label: Some("shift-slug component test readback"),
        size: (expected.len() * 24) as u64,
        usage: BufferUsages::COPY_DST | BufferUsages::MAP_READ,
        mapped_at_creation: false,
    });
    let advance_readback = device.create_buffer(&BufferDescriptor {
        label: Some("shift-slug component advance readback"),
        size: 4,
        usage: BufferUsages::COPY_DST | BufferUsages::MAP_READ,
        mapped_at_creation: false,
    });

    let shader = device.create_shader_module(ShaderModuleDescriptor {
        label: Some("shift-slug component test shader"),
        source: ShaderSource::Wgsl(VARIABLE_SLUG_WGSL.into()),
    });
    let pipeline = device.create_compute_pipeline(&ComputePipelineDescriptor {
        label: Some("shift-slug component test pipeline"),
        layout: None,
        module: &shader,
        entry_point: Some("resolve_visible_curves"),
        compilation_options: PipelineCompilationOptions::default(),
        cache: None,
    });
    let group0 = device.create_bind_group(&wgpu::BindGroupDescriptor {
        label: Some("shift-slug component test instances"),
        layout: &pipeline.get_bind_group_layout(0),
        entries: &[BindGroupEntry {
            binding: 1,
            resource: instance_buffer.as_entire_binding(),
        }],
    });
    let group1 = device.create_bind_group(&wgpu::BindGroupDescriptor {
        label: Some("shift-slug component test resident model"),
        layout: &pipeline.get_bind_group_layout(1),
        entries: &resident_entries(&atlas_buffer, layout, &weight_buffer, &variable_buffer),
    });
    let group2 = device.create_bind_group(&wgpu::BindGroupDescriptor {
        label: Some("shift-slug component test scratch"),
        layout: &pipeline.get_bind_group_layout(2),
        entries: &[
            BindGroupEntry {
                binding: 0,
                resource: curve_buffer.as_entire_binding(),
            },
            BindGroupEntry {
                binding: 3,
                resource: bounds_buffer.as_entire_binding(),
            },
            BindGroupEntry {
                binding: 4,
                resource: advance_buffer.as_entire_binding(),
            },
            BindGroupEntry {
                binding: 5,
                resource: transform_buffer.as_entire_binding(),
            },
        ],
    });

    let mut encoder = device.create_command_encoder(&CommandEncoderDescriptor {
        label: Some("shift-slug component test encoder"),
    });
    {
        let mut pass = encoder.begin_compute_pass(&ComputePassDescriptor {
            label: Some("shift-slug component test pass"),
            timestamp_writes: None,
        });
        pass.set_pipeline(&pipeline);
        pass.set_bind_group(0, &group0, &[]);
        pass.set_bind_group(1, &group1, &[]);
        pass.set_bind_group(2, &group2, &[]);
        pass.dispatch_workgroups(1, 1, 1);
    }
    encoder.copy_buffer_to_buffer(&curve_buffer, 0, &readback, 0, (expected.len() * 24) as u64);
    encoder.copy_buffer_to_buffer(&advance_buffer, 0, &advance_readback, 0, 4);
    queue.submit([encoder.finish()]);

    let bytes = read_buffer(&device, &readback);
    let advance_bytes = read_buffer(&device, &advance_readback);
    let actual = bytes
        .chunks_exact(24)
        .map(|bytes| Curve {
            p0: shift_slug::Point::new(read_f32(bytes, 0), read_f32(bytes, 4)),
            p1: shift_slug::Point::new(read_f32(bytes, 8), read_f32(bytes, 12)),
            p2: shift_slug::Point::new(read_f32(bytes, 16), read_f32(bytes, 20)),
        })
        .collect::<Vec<_>>();
    let maximum_error = actual
        .iter()
        .zip(&expected)
        .flat_map(|(actual, expected)| {
            [
                (actual.p0.x - expected.p0.x).abs(),
                (actual.p0.y - expected.p0.y).abs(),
                (actual.p1.x - expected.p1.x).abs(),
                (actual.p1.y - expected.p1.y).abs(),
                (actual.p2.x - expected.p2.x).abs(),
                (actual.p2.y - expected.p2.y).abs(),
            ]
        })
        .fold(0.0_f32, f32::max);
    let actual_advance = read_f32(&advance_bytes, 0);

    assert!(
        maximum_error <= 0.001,
        "GPU component error was {maximum_error}"
    );
    assert!((actual_advance - expected_advance).abs() <= 0.001);
}

fn component_font() -> (shift_font::Font, GlyphId) {
    let mut font = sample_variable_font();
    let root_id = font.glyphs_by_unicode(0x41).next().unwrap().id();
    let layers = font
        .glyph(root_id.clone())
        .unwrap()
        .layers()
        .values()
        .map(|layer| (layer.id(), layer.source_id()))
        .collect::<Vec<_>>();

    let base_id = GlyphId::from_raw("gpu-component-base");
    let mut base = Glyph::with_id(base_id.clone(), "gpu-component-base");
    let mark_id = GlyphId::from_raw("gpu-component-mark");
    let mut mark = Glyph::with_id(mark_id.clone(), "gpu-component-mark");
    for (source_index, (_, source_id)) in layers.iter().enumerate() {
        let mut base_layer = triangle_layer(source_id.clone(), source_index as f64 * 15.0);
        base_layer.add_anchor(Anchor::new(
            Some("top".to_string()),
            100.0 + source_index as f64 * 60.0,
            180.0 + source_index as f64 * 30.0,
        ));
        base.set_layer(base_layer);

        let mut mark_layer = triangle_layer(source_id.clone(), source_index as f64 * 5.0);
        mark_layer.add_anchor(Anchor::new(
            Some("_top".to_string()),
            10.0 + source_index as f64 * 5.0,
            5.0 + source_index as f64 * 2.0,
        ));
        mark.set_layer(mark_layer);
    }
    font.insert_glyph(base).unwrap();
    font.insert_glyph(mark).unwrap();

    for (source_index, (layer_id, _)) in layers.into_iter().enumerate() {
        let layer = font.layer_mut(layer_id).unwrap();
        layer.add_component(Component::with_transform(
            base_id.clone(),
            "gpu-component-base",
            DecomposedTransform {
                translate_x: source_index as f64 * 20.0,
                rotation: source_index as f64 * 20.0,
                scale_x: 1.0 + source_index as f64 * 0.4,
                scale_y: 1.0 + source_index as f64 * 0.2,
                skew_x: source_index as f64 * 5.0,
                skew_y: source_index as f64 * -3.0,
                t_center_x: source_index as f64 * 20.0,
                t_center_y: source_index as f64 * 10.0,
                ..DecomposedTransform::identity()
            },
        ));
        layer.add_component(Component::new(mark_id.clone(), "gpu-component-mark"));
    }
    (font, root_id)
}

fn triangle_layer(source_id: shift_font::SourceId, shift: f64) -> GlyphLayer {
    let mut layer = GlyphLayer::with_width(LayerId::new(), source_id, 500.0);
    let mut contour = Contour::new();
    contour.add_point(shift, 0.0, PointType::OnCurve, false);
    contour.add_point(50.0 + shift, 100.0, PointType::OnCurve, false);
    contour.add_point(100.0 + shift, 0.0, PointType::OnCurve, false);
    contour.close();
    layer.add_contour(contour);
    layer
}

fn storage_buffer(device: &wgpu::Device, label: &'static str, size: usize) -> wgpu::Buffer {
    device.create_buffer(&BufferDescriptor {
        label: Some(label),
        size: size.max(4) as u64,
        usage: BufferUsages::STORAGE | BufferUsages::COPY_SRC,
        mapped_at_creation: false,
    })
}

fn resident_entries<'a>(
    atlas_buffer: &'a wgpu::Buffer,
    layout: VariableLayout,
    weight_buffer: &'a wgpu::Buffer,
    variable_buffer: &'a wgpu::Buffer,
) -> [BindGroupEntry<'a>; 14] {
    [
        atlas_entry(0, atlas_buffer, layout.base_curves),
        atlas_entry(1, atlas_buffer, layout.curve_deltas),
        atlas_entry(2, atlas_buffer, layout.glyphs),
        atlas_entry(3, atlas_buffer, layout.sources),
        BindGroupEntry {
            binding: 4,
            resource: weight_buffer.as_entire_binding(),
        },
        BindGroupEntry {
            binding: 5,
            resource: variable_buffer.as_entire_binding(),
        },
        atlas_entry(6, atlas_buffer, layout.line_bits),
        atlas_entry(7, atlas_buffer, layout.sparse_deltas),
        atlas_entry(8, atlas_buffer, layout.source_advances),
        atlas_entry(9, atlas_buffer, layout.component_glyphs),
        atlas_entry(10, atlas_buffer, layout.component_parts),
        atlas_entry(11, atlas_buffer, layout.components),
        atlas_entry(12, atlas_buffer, layout.component_sources),
        atlas_entry(13, atlas_buffer, layout.anchor_sources),
    ]
}

fn atlas_entry(binding: u32, buffer: &wgpu::Buffer, section: Section) -> BindGroupEntry<'_> {
    BindGroupEntry {
        binding,
        resource: BindingResource::Buffer(BufferBinding {
            buffer,
            offset: section.offset as u64,
            size: NonZeroU64::new(section.length as u64),
        }),
    }
}

fn read_buffer(device: &wgpu::Device, buffer: &wgpu::Buffer) -> Vec<u8> {
    let slice = buffer.slice(..);
    let (sender, receiver) = mpsc::channel();
    slice.map_async(MapMode::Read, move |result| sender.send(result).unwrap());
    device.poll(PollType::wait_indefinitely()).unwrap();
    receiver.recv().unwrap().unwrap();
    let bytes = slice.get_mapped_range().unwrap().to_vec();
    buffer.unmap();
    bytes
}

fn read_f32(bytes: &[u8], offset: usize) -> f32 {
    f32::from_le_bytes(bytes[offset..offset + 4].try_into().unwrap())
}
