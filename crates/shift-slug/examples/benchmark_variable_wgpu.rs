use std::{env, error::Error, fs, num::NonZeroU64, path::PathBuf, sync::mpsc, time::Instant};

use shift_glyph_codec::OutlineCommand;
use shift_slug::{
    pack_render_instances, Curve, RenderInstance, VariableAtlas, VariableAtlasBuilder,
    DEFAULT_BAND_COUNT, VARIABLE_SLUG_WGSL,
};
use skrifa::{
    outline::{DrawSettings, OutlinePen},
    prelude::{LocationRef, Size},
    FontRef, GlyphId, MetadataProvider, Tag,
};
use wgpu::{
    util::{BufferInitDescriptor, DeviceExt},
    BindGroupEntry, BindingResource, BufferBinding, BufferDescriptor, BufferUsages,
    CommandEncoderDescriptor, ComputePassDescriptor, ComputePipelineDescriptor, Device,
    DeviceDescriptor, MemoryHints, PipelineCompilationOptions, PollType, PowerPreference,
    RequestAdapterOptions, ShaderModuleDescriptor, ShaderSource,
};

type Result<T> = std::result::Result<T, Box<dyn Error>>;

const COPY_ALIGNMENT: u32 = 256;
const DEFAULT_VISIBLE_GLYPHS: usize = 150;

#[derive(Default)]
struct CommandPen(Vec<OutlineCommand<f32>>);

impl OutlinePen for CommandPen {
    fn move_to(&mut self, x: f32, y: f32) {
        self.0.push(OutlineCommand::Move { x, y });
    }

    fn line_to(&mut self, x: f32, y: f32) {
        self.0.push(OutlineCommand::Line { x, y });
    }

    fn quad_to(&mut self, cx: f32, cy: f32, x: f32, y: f32) {
        self.0.push(OutlineCommand::Quad { cx, cy, x, y });
    }

    fn curve_to(&mut self, c1x: f32, c1y: f32, c2x: f32, c2y: f32, x: f32, y: f32) {
        self.0.push(OutlineCommand::Cubic {
            c1x,
            c1y,
            c2x,
            c2y,
            x,
            y,
        });
    }

    fn close(&mut self) {
        self.0.push(OutlineCommand::Close);
    }
}

struct Arguments {
    font: PathBuf,
    axis: Tag,
    base: f32,
    source: f32,
    weight: f32,
    visible_glyphs: usize,
    band_count: u32,
}

#[derive(Clone, Copy)]
struct ScratchLayout {
    curve_count: usize,
    band_count: usize,
    index_count: usize,
}

fn main() -> Result<()> {
    let arguments = arguments()?;
    let instance = wgpu::Instance::default();
    let adapter = pollster::block_on(instance.request_adapter(&RequestAdapterOptions {
        power_preference: PowerPreference::HighPerformance,
        force_fallback_adapter: false,
        compatible_surface: None,
        apply_limit_buckets: false,
    }))?;
    let adapter_info = adapter.get_info();
    println!(
        "adapter={} backend={:?} device_type={:?}",
        adapter_info.name, adapter_info.backend, adapter_info.device_type
    );

    let build_started = Instant::now();
    let (source_bytes, atlas) = build_atlas(&arguments)?;
    let build_elapsed = build_started.elapsed();
    let alignment = usize::try_from(
        adapter
            .limits()
            .min_storage_buffer_offset_alignment
            .max(COPY_ALIGNMENT),
    )?;
    let packed = atlas.pack(alignment)?;
    let layout = packed.layout();
    let glyph_indices = sampled_glyph_indices(atlas.glyphs().len(), arguments.visible_glyphs);
    let (instances, scratch) = build_instances(&atlas, &glyph_indices)?;
    let instance_bytes = pack_render_instances(&instances)?;
    let variable_params = variable_params(arguments.weight, instances.len(), arguments.band_count)?;

    println!(
        "source={} source_bytes={} glyphs={} curves={} variable_bytes={} build_ms={:.3}",
        arguments.font.display(),
        source_bytes,
        atlas.glyphs().len(),
        atlas.base_curves().len(),
        layout.total_length,
        build_elapsed.as_secs_f64() * 1_000.0,
    );
    println!(
        "axis={:?} base={} source={} weight={} visible={} scratch_curves={} scratch_bands={} scratch_indices={} scratch_bytes={}",
        arguments.axis,
        arguments.base,
        arguments.source,
        arguments.weight,
        instances.len(),
        scratch.curve_count,
        scratch.band_count,
        scratch.index_count,
        scratch_bytes(scratch)?,
    );

    let largest_binding = layout
        .base_curves
        .length
        .max(layout.curve_deltas.length)
        .max(layout.glyphs.length)
        .max(scratch.curve_count * 24)
        .max(scratch.band_count * 8)
        .max(scratch.index_count * 4);
    let mut required_limits = wgpu::Limits::default();
    required_limits.max_buffer_size = required_limits
        .max_buffer_size
        .max(u64::try_from(layout.total_length)?)
        .max(u64::try_from(scratch_bytes(scratch)?)?);
    required_limits.max_storage_buffer_binding_size = required_limits
        .max_storage_buffer_binding_size
        .max(u64::try_from(largest_binding)?);
    required_limits.max_storage_buffers_per_shader_stage =
        required_limits.max_storage_buffers_per_shader_stage.max(6);
    let (device, queue) = pollster::block_on(adapter.request_device(&DeviceDescriptor {
        label: Some("shift-slug variable benchmark device"),
        required_features: wgpu::Features::empty(),
        required_limits,
        experimental_features: Default::default(),
        memory_hints: MemoryHints::Performance,
        trace: wgpu::Trace::Off,
    }))?;

    let atlas_buffer = device.create_buffer_init(&BufferInitDescriptor {
        label: Some("shift-slug variable atlas"),
        contents: packed.as_bytes(),
        usage: BufferUsages::STORAGE,
    });
    let instance_buffer = device.create_buffer_init(&BufferInitDescriptor {
        label: Some("shift-slug variable instances"),
        contents: &instance_bytes,
        usage: BufferUsages::STORAGE,
    });
    let variable_buffer = device.create_buffer_init(&BufferInitDescriptor {
        label: Some("shift-slug variable params"),
        contents: &variable_params,
        usage: BufferUsages::UNIFORM,
    });
    let resolved_curve_buffer = storage_buffer(
        &device,
        "shift-slug resolved curves",
        scratch.curve_count * 24,
        BufferUsages::COPY_SRC,
    )?;
    let resolved_band_buffer = storage_buffer(
        &device,
        "shift-slug resolved bands",
        scratch.band_count * 8,
        BufferUsages::COPY_SRC,
    )?;
    let resolved_index_buffer = storage_buffer(
        &device,
        "shift-slug resolved indexes",
        scratch.index_count * 4,
        BufferUsages::COPY_SRC,
    )?;

    let shader = device.create_shader_module(ShaderModuleDescriptor {
        label: Some("shift-slug variable shared shader"),
        source: ShaderSource::Wgsl(VARIABLE_SLUG_WGSL.into()),
    });
    let resolve_pipeline = device.create_compute_pipeline(&ComputePipelineDescriptor {
        label: Some("shift-slug resolve visible curves"),
        layout: None,
        module: &shader,
        entry_point: Some("resolve_visible_curves"),
        compilation_options: PipelineCompilationOptions::default(),
        cache: None,
    });
    let band_pipeline = device.create_compute_pipeline(&ComputePipelineDescriptor {
        label: Some("shift-slug rebuild visible bands"),
        layout: None,
        module: &shader,
        entry_point: Some("rebuild_visible_bands"),
        compilation_options: PipelineCompilationOptions::default(),
        cache: None,
    });

    let resolve_groups = create_resolve_groups(
        &device,
        &resolve_pipeline,
        &instance_buffer,
        &atlas_buffer,
        layout,
        &variable_buffer,
        &resolved_curve_buffer,
    );
    let band_groups = create_band_groups(
        &device,
        &band_pipeline,
        &instance_buffer,
        &atlas_buffer,
        layout,
        &variable_buffer,
        &resolved_curve_buffer,
        &resolved_band_buffer,
        &resolved_index_buffer,
    );

    let curve_readback = readback_buffer(
        &device,
        "shift-slug curve readback",
        scratch.curve_count * 24,
    )?;
    let band_readback =
        readback_buffer(&device, "shift-slug band readback", scratch.band_count * 8)?;
    let index_readback = readback_buffer(
        &device,
        "shift-slug index readback",
        scratch.index_count * 4,
    )?;
    let mut encoder = device.create_command_encoder(&CommandEncoderDescriptor {
        label: Some("shift-slug variable validation encoder"),
    });
    {
        let mut pass = encoder.begin_compute_pass(&ComputePassDescriptor {
            label: Some("shift-slug resolve pass"),
            timestamp_writes: None,
        });
        pass.set_pipeline(&resolve_pipeline);
        for (index, group) in resolve_groups.iter().enumerate() {
            pass.set_bind_group(index as u32, group, &[]);
        }
        pass.dispatch_workgroups(u32::try_from(instances.len())?, 1, 1);
    }
    {
        let mut pass = encoder.begin_compute_pass(&ComputePassDescriptor {
            label: Some("shift-slug band pass"),
            timestamp_writes: None,
        });
        pass.set_pipeline(&band_pipeline);
        for (index, group) in band_groups.iter().enumerate() {
            pass.set_bind_group(index as u32, group, &[]);
        }
        pass.dispatch_workgroups(
            u32::try_from(instances.len())?
                .checked_mul(arguments.band_count * 2)
                .ok_or("band dispatch overflow")?,
            1,
            1,
        );
    }
    encoder.copy_buffer_to_buffer(
        &resolved_curve_buffer,
        0,
        &curve_readback,
        0,
        u64::try_from(scratch.curve_count * 24)?,
    );
    encoder.copy_buffer_to_buffer(
        &resolved_band_buffer,
        0,
        &band_readback,
        0,
        u64::try_from(scratch.band_count * 8)?,
    );
    encoder.copy_buffer_to_buffer(
        &resolved_index_buffer,
        0,
        &index_readback,
        0,
        u64::try_from(scratch.index_count * 4)?,
    );

    let gpu_started = Instant::now();
    queue.submit([encoder.finish()]);
    let curve_bytes = read_buffer(&device, &curve_readback)?;
    let band_bytes = read_buffer(&device, &band_readback)?;
    let index_bytes = read_buffer(&device, &index_readback)?;
    let gpu_elapsed = gpu_started.elapsed();
    let maximum_error = validate_curves(&atlas, &instances, arguments.weight, &curve_bytes)?;
    validate_bands(
        &atlas,
        &instances,
        arguments.weight,
        arguments.band_count,
        &curve_bytes,
        &band_bytes,
        &index_bytes,
    )?;

    println!(
        "gpu_submit_to_readback_ms={:.3} max_curve_error={} curve_validation=pass band_validation=pass",
        gpu_elapsed.as_secs_f64() * 1_000.0,
        maximum_error,
    );

    Ok(())
}

fn build_atlas(arguments: &Arguments) -> Result<(usize, VariableAtlas)> {
    let bytes = fs::read(&arguments.font)?;
    let font = FontRef::new(&bytes)?;
    let metrics = font.metrics(Size::unscaled(), LocationRef::default());
    let glyph_count = u32::from(metrics.glyph_count);
    let base_location = font.axes().location([(arguments.axis, arguments.base)]);
    let source_location = font.axes().location([(arguments.axis, arguments.source)]);
    let outlines = font.outline_glyphs();
    let mut builder = VariableAtlasBuilder::new(arguments.band_count)?;

    for glyph_id in 0..glyph_count {
        let glyph_id = GlyphId::new(glyph_id);
        let mut base = CommandPen::default();
        let mut source = CommandPen::default();
        if let Some(outline) = outlines.get(glyph_id) {
            outline.draw(
                DrawSettings::unhinted(Size::unscaled(), &base_location),
                &mut base,
            )?;
            outline.draw(
                DrawSettings::unhinted(Size::unscaled(), &source_location),
                &mut source,
            )?;
        }
        builder.add_glyph(base.0, source.0)?;
    }

    Ok((bytes.len(), builder.finish()))
}

fn sampled_glyph_indices(glyph_count: usize, requested: usize) -> Vec<u32> {
    let count = requested.min(glyph_count);
    if count == 0 {
        return Vec::new();
    }
    (0..count)
        .map(|index| {
            let glyph_index = index * glyph_count / count;
            u32::try_from(glyph_index).expect("glyph count fits u32")
        })
        .collect()
}

fn build_instances(
    atlas: &VariableAtlas,
    glyph_indices: &[u32],
) -> Result<(Vec<RenderInstance>, ScratchLayout)> {
    let mut instances = Vec::with_capacity(glyph_indices.len());
    let mut curve_count = 0_usize;
    let mut band_count = 0_usize;
    let mut index_count = 0_usize;
    let bands_per_glyph = usize::try_from(atlas.band_count() * 2)?;

    for glyph_index in glyph_indices.iter().copied() {
        let glyph = atlas
            .glyphs()
            .get(glyph_index as usize)
            .ok_or("sampled glyph index is out of range")?;
        instances.push(RenderInstance {
            glyph_index,
            scratch_curve_start: u32::try_from(curve_count)?,
            scratch_band_start: u32::try_from(band_count)?,
            scratch_index_start: u32::try_from(index_count)?,
            ..Default::default()
        });
        curve_count = curve_count
            .checked_add(glyph.curve_count as usize)
            .ok_or("scratch curve count overflow")?;
        band_count = band_count
            .checked_add(bands_per_glyph)
            .ok_or("scratch band count overflow")?;
        index_count = index_count
            .checked_add(
                (glyph.curve_count as usize)
                    .checked_mul(bands_per_glyph)
                    .ok_or("scratch index count overflow")?,
            )
            .ok_or("scratch index count overflow")?;
    }

    Ok((
        instances,
        ScratchLayout {
            curve_count,
            band_count,
            index_count,
        },
    ))
}

fn variable_params(weight: f32, instances: usize, band_count: u32) -> Result<[u8; 16]> {
    if !weight.is_finite() {
        return Err("weight must be finite".into());
    }
    let mut bytes = [0; 16];
    bytes[0..4].copy_from_slice(&weight.to_le_bytes());
    bytes[4..8].copy_from_slice(&u32::try_from(instances)?.to_le_bytes());
    bytes[8..12].copy_from_slice(&band_count.to_le_bytes());
    Ok(bytes)
}

fn storage_buffer(
    device: &Device,
    label: &'static str,
    size: usize,
    extra_usage: BufferUsages,
) -> Result<wgpu::Buffer> {
    Ok(device.create_buffer(&BufferDescriptor {
        label: Some(label),
        size: u64::try_from(size.max(4))?,
        usage: BufferUsages::STORAGE | extra_usage,
        mapped_at_creation: false,
    }))
}

fn readback_buffer(device: &Device, label: &'static str, size: usize) -> Result<wgpu::Buffer> {
    Ok(device.create_buffer(&BufferDescriptor {
        label: Some(label),
        size: u64::try_from(size.max(4))?,
        usage: BufferUsages::COPY_DST | BufferUsages::MAP_READ,
        mapped_at_creation: false,
    }))
}

#[allow(clippy::too_many_arguments)]
fn create_resolve_groups(
    device: &Device,
    pipeline: &wgpu::ComputePipeline,
    instance_buffer: &wgpu::Buffer,
    atlas_buffer: &wgpu::Buffer,
    layout: shift_slug::VariableLayout,
    variable_buffer: &wgpu::Buffer,
    resolved_curve_buffer: &wgpu::Buffer,
) -> [wgpu::BindGroup; 3] {
    let group0 = device.create_bind_group(&wgpu::BindGroupDescriptor {
        label: Some("shift-slug resolve globals"),
        layout: &pipeline.get_bind_group_layout(0),
        entries: &[BindGroupEntry {
            binding: 1,
            resource: instance_buffer.as_entire_binding(),
        }],
    });
    let group1 = device.create_bind_group(&wgpu::BindGroupDescriptor {
        label: Some("shift-slug resolve resident model"),
        layout: &pipeline.get_bind_group_layout(1),
        entries: &[
            atlas_entry(0, atlas_buffer, layout.base_curves),
            atlas_entry(1, atlas_buffer, layout.curve_deltas),
            atlas_entry(2, atlas_buffer, layout.glyphs),
            BindGroupEntry {
                binding: 3,
                resource: variable_buffer.as_entire_binding(),
            },
        ],
    });
    let group2 = device.create_bind_group(&wgpu::BindGroupDescriptor {
        label: Some("shift-slug resolve scratch"),
        layout: &pipeline.get_bind_group_layout(2),
        entries: &[BindGroupEntry {
            binding: 0,
            resource: resolved_curve_buffer.as_entire_binding(),
        }],
    });
    [group0, group1, group2]
}

#[allow(clippy::too_many_arguments)]
fn create_band_groups(
    device: &Device,
    pipeline: &wgpu::ComputePipeline,
    instance_buffer: &wgpu::Buffer,
    atlas_buffer: &wgpu::Buffer,
    layout: shift_slug::VariableLayout,
    variable_buffer: &wgpu::Buffer,
    resolved_curve_buffer: &wgpu::Buffer,
    resolved_band_buffer: &wgpu::Buffer,
    resolved_index_buffer: &wgpu::Buffer,
) -> [wgpu::BindGroup; 3] {
    let group0 = device.create_bind_group(&wgpu::BindGroupDescriptor {
        label: Some("shift-slug band instances"),
        layout: &pipeline.get_bind_group_layout(0),
        entries: &[BindGroupEntry {
            binding: 1,
            resource: instance_buffer.as_entire_binding(),
        }],
    });
    let group1 = device.create_bind_group(&wgpu::BindGroupDescriptor {
        label: Some("shift-slug band resident model"),
        layout: &pipeline.get_bind_group_layout(1),
        entries: &[
            atlas_entry(2, atlas_buffer, layout.glyphs),
            BindGroupEntry {
                binding: 3,
                resource: variable_buffer.as_entire_binding(),
            },
        ],
    });
    let group2 = device.create_bind_group(&wgpu::BindGroupDescriptor {
        label: Some("shift-slug band scratch"),
        layout: &pipeline.get_bind_group_layout(2),
        entries: &[
            BindGroupEntry {
                binding: 0,
                resource: resolved_curve_buffer.as_entire_binding(),
            },
            BindGroupEntry {
                binding: 1,
                resource: resolved_band_buffer.as_entire_binding(),
            },
            BindGroupEntry {
                binding: 2,
                resource: resolved_index_buffer.as_entire_binding(),
            },
        ],
    });
    [group0, group1, group2]
}

fn atlas_entry(
    binding: u32,
    buffer: &wgpu::Buffer,
    section: shift_slug::Section,
) -> BindGroupEntry<'_> {
    BindGroupEntry {
        binding,
        resource: BindingResource::Buffer(BufferBinding {
            buffer,
            offset: section.offset as u64,
            size: NonZeroU64::new(section.length as u64),
        }),
    }
}

fn scratch_bytes(layout: ScratchLayout) -> Result<usize> {
    (layout.curve_count * 24)
        .checked_add(layout.band_count * 8)
        .and_then(|bytes| bytes.checked_add(layout.index_count * 4))
        .ok_or_else(|| "scratch byte count overflow".into())
}

fn validate_curves(
    atlas: &VariableAtlas,
    instances: &[RenderInstance],
    weight: f32,
    bytes: &[u8],
) -> Result<f32> {
    let mut maximum_error = 0.0_f32;
    for instance in instances {
        let expected = atlas.resolve_glyph(instance.glyph_index, weight)?;
        for (local_index, expected_curve) in expected.iter().enumerate() {
            let curve_index = instance.scratch_curve_start as usize + local_index;
            let actual = read_curve(bytes, curve_index)?;
            for (expected, actual) in curve_values(*expected_curve).zip(curve_values(actual)) {
                maximum_error = maximum_error.max((expected - actual).abs());
            }
        }
    }
    if maximum_error > 0.001 {
        return Err(format!("GPU curve error {maximum_error} exceeds 0.001").into());
    }
    Ok(maximum_error)
}

fn validate_bands(
    atlas: &VariableAtlas,
    instances: &[RenderInstance],
    weight: f32,
    band_count: u32,
    curve_bytes: &[u8],
    band_bytes: &[u8],
    index_bytes: &[u8],
) -> Result<()> {
    for instance in instances {
        let glyph = atlas.glyphs()[instance.glyph_index as usize];
        let expected_curves = atlas.resolve_glyph(instance.glyph_index, weight)?;
        let width = (glyph.bounds.max_x - glyph.bounds.min_x).max(0.0001);
        let height = (glyph.bounds.max_y - glyph.bounds.min_y).max(0.0001);
        for local_band in 0..band_count * 2 {
            let horizontal = local_band < band_count;
            let direction_band = if horizontal {
                local_band
            } else {
                local_band - band_count
            };
            let (axis_min, axis_size) = if horizontal {
                (glyph.bounds.min_y, height)
            } else {
                (glyph.bounds.min_x, width)
            };
            let band_min = axis_min + axis_size * direction_band as f32 / band_count as f32;
            let band_max = axis_min + axis_size * (direction_band + 1) as f32 / band_count as f32;
            let expected = expected_curves
                .iter()
                .enumerate()
                .filter_map(|(index, curve)| {
                    let bounds = curve.bounds();
                    let (curve_min, curve_max) = if horizontal {
                        (bounds.min_y, bounds.max_y)
                    } else {
                        (bounds.min_x, bounds.max_x)
                    };
                    (curve_max >= band_min && curve_min <= band_max)
                        .then_some(instance.scratch_curve_start + index as u32)
                })
                .collect::<Vec<_>>();
            let band = read_band(
                band_bytes,
                instance.scratch_band_start as usize + local_band as usize,
            )?;
            let actual = (0..band.1)
                .map(|offset| read_u32(index_bytes, band.0 as usize + offset as usize))
                .collect::<Result<Vec<_>>>()?;
            if actual != expected {
                return Err(format!(
                    "glyph {} band {local_band} differs: expected {} indexes, got {}",
                    instance.glyph_index,
                    expected.len(),
                    actual.len()
                )
                .into());
            }
            for curve_index in actual {
                let _ = read_curve(curve_bytes, curve_index as usize)?;
            }
        }
    }
    Ok(())
}

fn read_curve(bytes: &[u8], index: usize) -> Result<Curve> {
    let start = index.checked_mul(24).ok_or("curve offset overflow")?;
    let values = (0..6)
        .map(|value_index| read_f32(bytes, start / 4 + value_index))
        .collect::<Result<Vec<_>>>()?;
    Ok(Curve {
        p0: shift_slug::Point::new(values[0], values[1]),
        p1: shift_slug::Point::new(values[2], values[3]),
        p2: shift_slug::Point::new(values[4], values[5]),
    })
}

fn read_band(bytes: &[u8], index: usize) -> Result<(u32, u32)> {
    Ok((read_u32(bytes, index * 2)?, read_u32(bytes, index * 2 + 1)?))
}

fn read_u32(bytes: &[u8], index: usize) -> Result<u32> {
    let start = index.checked_mul(4).ok_or("u32 offset overflow")?;
    Ok(u32::from_le_bytes(
        bytes
            .get(start..start + 4)
            .ok_or("u32 read is out of range")?
            .try_into()?,
    ))
}

fn read_f32(bytes: &[u8], index: usize) -> Result<f32> {
    Ok(f32::from_bits(read_u32(bytes, index)?))
}

fn curve_values(curve: Curve) -> impl Iterator<Item = f32> {
    [
        curve.p0.x, curve.p0.y, curve.p1.x, curve.p1.y, curve.p2.x, curve.p2.y,
    ]
    .into_iter()
}

fn read_buffer(device: &Device, buffer: &wgpu::Buffer) -> Result<Vec<u8>> {
    let (sender, receiver) = mpsc::channel();
    buffer.map_async(wgpu::MapMode::Read, .., move |result| {
        let _ = sender.send(result);
    });
    device.poll(PollType::wait_indefinitely())?;
    receiver.recv()??;
    let bytes = buffer.get_mapped_range(..)?.to_vec();
    buffer.unmap();
    Ok(bytes)
}

fn arguments() -> Result<Arguments> {
    let mut values = env::args().skip(1);
    let font = values
        .next()
        .map(PathBuf::from)
        .ok_or("usage: benchmark_variable_wgpu FONT TAG=BASE,SOURCE [--weight VALUE] [--visible COUNT] [--bands COUNT]")?;
    let axis = values
        .next()
        .ok_or("axis endpoints must have TAG=BASE,SOURCE form")?;
    let (tag, endpoints) = axis
        .split_once('=')
        .ok_or("axis endpoints must have TAG=BASE,SOURCE form")?;
    let tag: [u8; 4] = tag
        .as_bytes()
        .try_into()
        .map_err(|_| "axis tag must contain exactly four ASCII bytes")?;
    let (base, source) = endpoints
        .split_once(',')
        .ok_or("axis endpoints must have TAG=BASE,SOURCE form")?;
    let mut arguments = Arguments {
        font,
        axis: Tag::new(&tag),
        base: base.parse()?,
        source: source.parse()?,
        weight: 0.5,
        visible_glyphs: DEFAULT_VISIBLE_GLYPHS,
        band_count: DEFAULT_BAND_COUNT,
    };

    while let Some(option) = values.next() {
        match option.as_str() {
            "--weight" => {
                arguments.weight = values.next().ok_or("--weight requires a value")?.parse()?
            }
            "--visible" => {
                arguments.visible_glyphs =
                    values.next().ok_or("--visible requires a count")?.parse()?
            }
            "--bands" => {
                arguments.band_count = values.next().ok_or("--bands requires a count")?.parse()?
            }
            _ => return Err(format!("unknown option {option}").into()),
        }
    }

    if !(0.0..=1.0).contains(&arguments.weight) {
        return Err("--weight must be in 0..=1".into());
    }
    if arguments.visible_glyphs == 0 {
        return Err("--visible must be greater than zero".into());
    }
    Ok(arguments)
}
