use std::{
    env,
    error::Error,
    fs,
    num::NonZeroU64,
    path::PathBuf,
    sync::mpsc,
    time::{Duration, Instant},
};

use shift_glyph_codec::OutlineCommand;
use shift_slug::{
    pack_render_instances, pack_render_params, Atlas, AtlasBuilder, Bounds, Layout, RenderInstance,
    RenderParams, Section, DEFAULT_BAND_COUNT, RENDER_INSTANCE_BYTES, SLUG_WGSL,
};
use skrifa::{
    outline::{DrawSettings, OutlinePen},
    prelude::{LocationRef, Size},
    FontRef, GlyphId, MetadataProvider, Tag,
};
use wgpu::{
    util::{BufferInitDescriptor, DeviceExt},
    BindGroupEntry, BindingResource, BufferBinding, BufferDescriptor, BufferUsages,
    ColorTargetState, ColorWrites, CommandEncoderDescriptor, Device, DeviceDescriptor, Extent3d,
    Features, FragmentState, LoadOp, MemoryHints, Operations, Origin3d, PipelineCompilationOptions,
    PollType, PowerPreference, PrimitiveState, QuerySetDescriptor, QueryType,
    RenderPassColorAttachment, RenderPassDescriptor, RenderPassTimestampWrites,
    RenderPipelineDescriptor, RequestAdapterOptions, ShaderModuleDescriptor, ShaderSource, StoreOp,
    TexelCopyBufferInfo, TexelCopyBufferLayout, TexelCopyTextureInfo, TextureAspect,
    TextureDescriptor, TextureDimension, TextureFormat, TextureUsages, TextureViewDescriptor,
    VertexState,
};

type Result<T> = std::result::Result<T, Box<dyn Error>>;

const COPY_ALIGNMENT: u32 = 256;
const DEFAULT_WIDTH: u32 = 960;
const DEFAULT_HEIGHT: u32 = 640;
const DEFAULT_CELL_SIZE: u32 = 64;
const DEFAULT_ITERATIONS: u32 = 120;
const CELL_PADDING: f32 = 4.0;
const ANTIALIAS_GUARD_PIXELS: f32 = 1.0;

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
    font: Option<PathBuf>,
    band_count: u32,
    settings: Vec<(Tag, f32)>,
    width: u32,
    height: u32,
    cell_size: u32,
    iterations: u32,
    output: Option<PathBuf>,
    full_cell_quads: bool,
}

struct TimestampResources {
    query_set: wgpu::QuerySet,
    resolve_buffer: wgpu::Buffer,
    readback_buffer: wgpu::Buffer,
    query_count: u32,
}

struct TimestampMeasurements {
    durations_ms: Vec<f64>,
    non_monotonic_pairs: usize,
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
    print_adapter(&adapter);

    let Some(font_path) = arguments.font.as_deref() else {
        return Ok(());
    };

    let build_started = Instant::now();
    let (source_bytes, atlas) = build_atlas(font_path, arguments.band_count, &arguments.settings)?;
    let build_elapsed = build_started.elapsed();
    let alignment = usize::try_from(
        adapter
            .limits()
            .min_storage_buffer_offset_alignment
            .max(COPY_ALIGNMENT),
    )?;
    let packed = atlas.pack(alignment)?;
    let layout = packed.layout();
    validate_adapter_limits(&adapter, layout)?;

    let statistics = atlas.statistics();
    println!("source={}", font_path.display());
    println!(
        "source_bytes={} glyphs={} curves={} curve_indices={} atlas_bytes={} build_ms={:.3}",
        source_bytes,
        statistics.glyph_count,
        statistics.curve_count,
        statistics.curve_index_count,
        layout.total_length,
        milliseconds(build_elapsed),
    );

    let required_features = adapter.features() & Features::TIMESTAMP_QUERY;
    let mut required_limits = wgpu::Limits::default();
    required_limits.max_buffer_size = required_limits
        .max_buffer_size
        .max(u64::try_from(layout.total_length)?);
    required_limits.max_storage_buffer_binding_size = required_limits
        .max_storage_buffer_binding_size
        .max(u64::try_from(largest_section(layout).length)?);
    required_limits.max_storage_buffers_per_shader_stage =
        required_limits.max_storage_buffers_per_shader_stage.max(5);
    let (device, queue) = pollster::block_on(adapter.request_device(&DeviceDescriptor {
        label: Some("shift-slug benchmark device"),
        required_features,
        required_limits,
        experimental_features: Default::default(),
        memory_hints: MemoryHints::Performance,
        trace: wgpu::Trace::Off,
    }))?;

    let upload_started = Instant::now();
    let atlas_buffer = device.create_buffer_init(&BufferInitDescriptor {
        label: Some("shift-slug atlas"),
        contents: packed.as_bytes(),
        usage: BufferUsages::STORAGE,
    });
    let upload_cpu_elapsed = upload_started.elapsed();

    let instance_bytes = build_instances(
        &atlas,
        arguments.width,
        arguments.height,
        arguments.cell_size,
        arguments.full_cell_quads,
    )?;
    let instance_count = u32::try_from(instance_bytes.len() / RENDER_INSTANCE_BYTES)?;
    let uniform_bytes = pack_render_params(RenderParams {
        viewport_width: arguments.width as f32,
        viewport_height: arguments.height as f32,
        cell_padding: if arguments.full_cell_quads {
            CELL_PADDING
        } else {
            0.0
        },
    });
    let uniform_buffer = device.create_buffer_init(&BufferInitDescriptor {
        label: Some("shift-slug globals"),
        contents: &uniform_bytes,
        usage: BufferUsages::UNIFORM,
    });
    let instance_buffer = device.create_buffer_init(&BufferInitDescriptor {
        label: Some("shift-slug visible instances"),
        contents: &instance_bytes,
        usage: BufferUsages::STORAGE | BufferUsages::COPY_DST,
    });

    let pipeline_started = Instant::now();
    let shader = device.create_shader_module(ShaderModuleDescriptor {
        label: Some("shift-slug shared shader"),
        source: ShaderSource::Wgsl(SLUG_WGSL.into()),
    });
    let pipeline = device.create_render_pipeline(&RenderPipelineDescriptor {
        label: Some("shift-slug offscreen pipeline"),
        layout: None,
        vertex: VertexState {
            module: &shader,
            entry_point: Some("vertex_main"),
            compilation_options: PipelineCompilationOptions::default(),
            buffers: &[],
        },
        primitive: PrimitiveState::default(),
        depth_stencil: None,
        multisample: Default::default(),
        fragment: Some(FragmentState {
            module: &shader,
            entry_point: Some("fragment_main"),
            compilation_options: PipelineCompilationOptions::default(),
            targets: &[Some(ColorTargetState {
                format: TextureFormat::Rgba8Unorm,
                blend: None,
                write_mask: ColorWrites::ALL,
            })],
        }),
        multiview_mask: None,
        cache: None,
    });
    let pipeline_elapsed = pipeline_started.elapsed();

    let globals = device.create_bind_group(&wgpu::BindGroupDescriptor {
        label: Some("shift-slug globals bind group"),
        layout: &pipeline.get_bind_group_layout(0),
        entries: &[
            BindGroupEntry {
                binding: 0,
                resource: uniform_buffer.as_entire_binding(),
            },
            BindGroupEntry {
                binding: 1,
                resource: instance_buffer.as_entire_binding(),
            },
        ],
    });
    let atlas_bindings = device.create_bind_group(&wgpu::BindGroupDescriptor {
        label: Some("shift-slug atlas bind group"),
        layout: &pipeline.get_bind_group_layout(1),
        entries: &[
            atlas_entry(0, &atlas_buffer, layout.curves)?,
            atlas_entry(1, &atlas_buffer, layout.curve_indices)?,
            atlas_entry(2, &atlas_buffer, layout.glyphs)?,
            atlas_entry(3, &atlas_buffer, layout.bands)?,
        ],
    });

    let texture = device.create_texture(&TextureDescriptor {
        label: Some("shift-slug offscreen target"),
        size: Extent3d {
            width: arguments.width,
            height: arguments.height,
            depth_or_array_layers: 1,
        },
        mip_level_count: 1,
        sample_count: 1,
        dimension: TextureDimension::D2,
        format: TextureFormat::Rgba8Unorm,
        usage: TextureUsages::RENDER_ATTACHMENT | TextureUsages::COPY_SRC,
        view_formats: &[],
    });
    let view = texture.create_view(&TextureViewDescriptor::default());
    let padded_bytes_per_row = align_copy_bytes(arguments.width * 4);
    let image_readback = device.create_buffer(&BufferDescriptor {
        label: Some("shift-slug image readback"),
        size: u64::from(padded_bytes_per_row) * u64::from(arguments.height),
        usage: BufferUsages::COPY_DST | BufferUsages::MAP_READ,
        mapped_at_creation: false,
    });
    let latency_timestamps =
        timestamp_resources(&device, required_features, arguments.iterations, "latency")?;
    let throughput_timestamps = timestamp_resources(
        &device,
        required_features,
        arguments.iterations,
        "throughput",
    )?;

    let warm_started = Instant::now();
    let mut warm_encoder = device.create_command_encoder(&CommandEncoderDescriptor {
        label: Some("shift-slug warm-up encoder"),
    });
    encode_render_pass(
        &mut warm_encoder,
        &view,
        &pipeline,
        &globals,
        &atlas_bindings,
        instance_count,
        None,
    );
    queue.submit([warm_encoder.finish()]);
    device.poll(PollType::wait_indefinitely())?;
    let warm_elapsed = warm_started.elapsed();

    let mut latency_wall_ms = Vec::with_capacity(arguments.iterations as usize);
    for iteration in 0..arguments.iterations {
        let started = Instant::now();
        let mut encoder = device.create_command_encoder(&CommandEncoderDescriptor {
            label: Some("shift-slug latency encoder"),
        });
        let writes = latency_timestamps.as_ref().map(|timestamps| {
            let start = iteration * 2;
            RenderPassTimestampWrites {
                query_set: &timestamps.query_set,
                beginning_of_pass_write_index: Some(start),
                end_of_pass_write_index: Some(start + 1),
            }
        });
        encode_render_pass(
            &mut encoder,
            &view,
            &pipeline,
            &globals,
            &atlas_bindings,
            instance_count,
            writes,
        );
        queue.submit([encoder.finish()]);
        device.poll(PollType::wait_indefinitely())?;
        latency_wall_ms.push(milliseconds(started.elapsed()));
    }
    latency_wall_ms.sort_by(f64::total_cmp);
    let latency_gpu = read_timestamps(
        &device,
        &queue,
        latency_timestamps.as_ref(),
        queue.get_timestamp_period(),
    )?;

    let throughput_started = Instant::now();
    let mut throughput_encoder = device.create_command_encoder(&CommandEncoderDescriptor {
        label: Some("shift-slug throughput encoder"),
    });
    for iteration in 0..arguments.iterations {
        let writes = throughput_timestamps.as_ref().map(|timestamps| {
            let start = iteration * 2;
            RenderPassTimestampWrites {
                query_set: &timestamps.query_set,
                beginning_of_pass_write_index: Some(start),
                end_of_pass_write_index: Some(start + 1),
            }
        });
        encode_render_pass(
            &mut throughput_encoder,
            &view,
            &pipeline,
            &globals,
            &atlas_bindings,
            instance_count,
            writes,
        );
    }
    queue.submit([throughput_encoder.finish()]);
    device.poll(PollType::wait_indefinitely())?;
    let throughput_elapsed = throughput_started.elapsed();
    let throughput_gpu = read_timestamps(
        &device,
        &queue,
        throughput_timestamps.as_ref(),
        queue.get_timestamp_period(),
    )?;

    let mut readback_encoder = device.create_command_encoder(&CommandEncoderDescriptor {
        label: Some("shift-slug image readback encoder"),
    });
    readback_encoder.copy_texture_to_buffer(
        TexelCopyTextureInfo {
            texture: &texture,
            mip_level: 0,
            origin: Origin3d::ZERO,
            aspect: TextureAspect::All,
        },
        TexelCopyBufferInfo {
            buffer: &image_readback,
            layout: TexelCopyBufferLayout {
                offset: 0,
                bytes_per_row: Some(padded_bytes_per_row),
                rows_per_image: Some(arguments.height),
            },
        },
        Extent3d {
            width: arguments.width,
            height: arguments.height,
            depth_or_array_layers: 1,
        },
    );
    queue.submit([readback_encoder.finish()]);
    device.poll(PollType::wait_indefinitely())?;

    let image_bytes = read_buffer(&device, &image_readback)?;
    let rgba = unpack_rows(
        &image_bytes,
        arguments.width,
        arguments.height,
        padded_bytes_per_row,
    );
    let alpha: Vec<_> = rgba.chunks_exact(4).map(|pixel| pixel[3]).collect();
    let nonzero_alpha = alpha.iter().filter(|value| **value != 0).count();
    if nonzero_alpha == 0 {
        return Err("offscreen render produced no covered pixels".into());
    }
    if let Some(path) = &arguments.output {
        write_pgm(path, arguments.width, arguments.height, &alpha)?;
    }

    println!(
        "viewport={}x{} cell_size={} visible_instances={} iterations={} quad_mode={}",
        arguments.width,
        arguments.height,
        arguments.cell_size,
        instance_count,
        arguments.iterations,
        if arguments.full_cell_quads {
            "full_cell"
        } else {
            "tight_guarded"
        },
    );
    println!(
        "atlas_buffer_create_ms={:.3} pipeline_create_ms={:.3} warm_submit_ms={:.3}",
        milliseconds(upload_cpu_elapsed),
        milliseconds(pipeline_elapsed),
        milliseconds(warm_elapsed),
    );
    println!(
        "latency_submit_to_completion_ms_p50={:.3} p95={:.3} p99={:.3} max={:.3}",
        percentile(&latency_wall_ms, 0.50),
        percentile(&latency_wall_ms, 0.95),
        percentile(&latency_wall_ms, 0.99),
        latency_wall_ms.last().copied().unwrap_or(0.0),
    );
    print_timestamp_measurements("latency", latency_gpu.as_ref())?;
    println!(
        "throughput_batch_wall_ms={:.3} wall_ms_per_pass={:.3}",
        milliseconds(throughput_elapsed),
        milliseconds(throughput_elapsed) / f64::from(arguments.iterations),
    );
    print_timestamp_measurements("throughput", throughput_gpu.as_ref())?;
    println!(
        "pixel_checksum={:016x} nonzero_alpha={} alpha_sum={}",
        fnv1a(&rgba),
        nonzero_alpha,
        alpha.iter().map(|value| u64::from(*value)).sum::<u64>(),
    );

    Ok(())
}

fn print_adapter(adapter: &wgpu::Adapter) {
    let info = adapter.get_info();
    let limits = adapter.limits();
    let features = adapter.features();
    println!("adapter_name={}", info.name);
    println!(
        "backend={:?} device_type={:?} vendor={} device={}",
        info.backend, info.device_type, info.vendor, info.device
    );
    println!("driver={} driver_info={}", info.driver, info.driver_info);
    println!("max_buffer_size={}", limits.max_buffer_size);
    println!(
        "max_storage_buffer_binding_size={}",
        limits.max_storage_buffer_binding_size
    );
    println!(
        "max_storage_buffers_per_shader_stage={}",
        limits.max_storage_buffers_per_shader_stage
    );
    println!(
        "min_storage_buffer_offset_alignment={}",
        limits.min_storage_buffer_offset_alignment
    );
    println!(
        "max_compute_workgroups_per_dimension={}",
        limits.max_compute_workgroups_per_dimension
    );
    println!(
        "max_compute_invocations_per_workgroup={}",
        limits.max_compute_invocations_per_workgroup
    );
    println!(
        "max_compute_workgroup_size={}x{}x{}",
        limits.max_compute_workgroup_size_x,
        limits.max_compute_workgroup_size_y,
        limits.max_compute_workgroup_size_z
    );
    println!(
        "timestamp_query={} timestamp_inside_passes={}",
        features.contains(Features::TIMESTAMP_QUERY),
        features.contains(Features::TIMESTAMP_QUERY_INSIDE_PASSES)
    );
}

fn build_atlas(
    path: &std::path::Path,
    band_count: u32,
    settings: &[(Tag, f32)],
) -> Result<(usize, Atlas)> {
    let bytes = fs::read(path)?;
    let font = FontRef::new(&bytes)?;
    let metrics = font.metrics(Size::unscaled(), LocationRef::default());
    let glyph_count = u32::from(metrics.glyph_count);
    let location = font.axes().location(settings.iter().copied());
    let outlines = font.outline_glyphs();
    let mut builder = AtlasBuilder::new(band_count)?;

    for glyph_id in 0..glyph_count {
        let mut pen = CommandPen::default();
        if let Some(outline) = outlines.get(GlyphId::new(glyph_id)) {
            outline.draw(
                DrawSettings::unhinted(Size::unscaled(), &location),
                &mut pen,
            )?;
        }
        builder.add_glyph(pen.0)?;
    }

    Ok((bytes.len(), builder.finish()))
}

fn validate_adapter_limits(adapter: &wgpu::Adapter, layout: Layout) -> Result<()> {
    let limits = adapter.limits();
    if u64::try_from(layout.total_length)? > limits.max_buffer_size {
        return Err(format!(
            "atlas needs {} bytes but adapter max_buffer_size is {}",
            layout.total_length, limits.max_buffer_size
        )
        .into());
    }
    let largest = largest_section(layout);
    if u64::try_from(largest.length)? > limits.max_storage_buffer_binding_size {
        return Err(format!(
            "atlas section needs {} bytes but adapter max_storage_buffer_binding_size is {}",
            largest.length, limits.max_storage_buffer_binding_size
        )
        .into());
    }
    if limits.max_storage_buffers_per_shader_stage < 5 {
        return Err(format!(
            "renderer needs 5 storage buffers but adapter provides {}",
            limits.max_storage_buffers_per_shader_stage
        )
        .into());
    }
    Ok(())
}

fn largest_section(layout: Layout) -> Section {
    [
        layout.curves,
        layout.curve_indices,
        layout.glyphs,
        layout.bands,
    ]
    .into_iter()
    .max_by_key(|section| section.length)
    .unwrap_or_default()
}

fn atlas_entry<'a>(
    binding: u32,
    buffer: &'a wgpu::Buffer,
    section: Section,
) -> Result<BindGroupEntry<'a>> {
    Ok(BindGroupEntry {
        binding,
        resource: BindingResource::Buffer(BufferBinding {
            buffer,
            offset: u64::try_from(section.offset)?,
            size: NonZeroU64::new(u64::try_from(section.length)?),
        }),
    })
}

fn build_instances(
    atlas: &Atlas,
    width: u32,
    height: u32,
    cell_size: u32,
    full_cell_quads: bool,
) -> Result<Vec<u8>> {
    let columns = width / cell_size;
    let rows = height / cell_size;
    if columns == 0 || rows == 0 {
        return Err("viewport must fit at least one complete cell".into());
    }
    if atlas.glyphs().is_empty() {
        return Err("atlas contains no glyphs".into());
    }

    let instance_count = columns.checked_mul(rows).ok_or("instance count overflow")?;
    let mut instances = Vec::with_capacity(usize::try_from(instance_count)?);
    let glyph_count = u32::try_from(atlas.glyphs().len())?;
    for index in 0..instance_count {
        let column = index % columns;
        let row = index / columns;
        let glyph_index = ((u64::from(index) * u64::from(glyph_count)) / u64::from(instance_count))
            .min(u64::from(glyph_count - 1)) as u32;
        let bounds = atlas.glyphs()[glyph_index as usize].bounds;
        let cell_rect = [
            (column * cell_size) as f32,
            (row * cell_size) as f32,
            ((column + 1) * cell_size) as f32,
            ((row + 1) * cell_size) as f32,
        ];
        let fitted_bounds = aspect_fitted_bounds(bounds, cell_size as f32, cell_size as f32);
        let em_transform = pixel_to_em_transform(cell_rect, fitted_bounds);
        let pixel_rect = if full_cell_quads {
            cell_rect
        } else {
            tight_guarded_rect(bounds, cell_rect, fitted_bounds)
        };
        instances.push(RenderInstance {
            pixel_rect,
            em_transform,
            glyph_index,
        });
    }
    Ok(pack_render_instances(&instances)?)
}

fn aspect_fitted_bounds(bounds: Bounds, pixel_width: f32, pixel_height: f32) -> [f32; 4] {
    let width = bounds.width();
    let height = bounds.height();
    if width <= f32::EPSILON || height <= f32::EPSILON {
        return [0.0, 0.0, 1.0, 1.0];
    }

    let center_x = (bounds.min_x + bounds.max_x) * 0.5;
    let center_y = (bounds.min_y + bounds.max_y) * 0.5;
    let target_aspect = pixel_width / pixel_height;
    let (fitted_width, fitted_height) = if width / height < target_aspect {
        (height * target_aspect, height)
    } else {
        (width, width / target_aspect)
    };
    [
        center_x - fitted_width * 0.5,
        center_y - fitted_height * 0.5,
        center_x + fitted_width * 0.5,
        center_y + fitted_height * 0.5,
    ]
}

fn pixel_to_em_transform(cell_rect: [f32; 4], fitted_bounds: [f32; 4]) -> [f32; 4] {
    let drawable = [
        cell_rect[0] + CELL_PADDING,
        cell_rect[1] + CELL_PADDING,
        cell_rect[2] - CELL_PADDING,
        cell_rect[3] - CELL_PADDING,
    ];
    let scale_x = (fitted_bounds[2] - fitted_bounds[0]) / (drawable[2] - drawable[0]);
    let scale_y = -(fitted_bounds[3] - fitted_bounds[1]) / (drawable[3] - drawable[1]);
    [
        scale_x,
        scale_y,
        fitted_bounds[0] - drawable[0] * scale_x,
        fitted_bounds[3] - drawable[1] * scale_y,
    ]
}

fn tight_guarded_rect(bounds: Bounds, cell_rect: [f32; 4], fitted_bounds: [f32; 4]) -> [f32; 4] {
    if bounds.width() <= f32::EPSILON || bounds.height() <= f32::EPSILON {
        let center_x = (cell_rect[0] + cell_rect[2]) * 0.5;
        let center_y = (cell_rect[1] + cell_rect[3]) * 0.5;
        return [center_x, center_y, center_x, center_y];
    }

    let drawable = [
        cell_rect[0] + CELL_PADDING,
        cell_rect[1] + CELL_PADDING,
        cell_rect[2] - CELL_PADDING,
        cell_rect[3] - CELL_PADDING,
    ];
    let scale_x = (drawable[2] - drawable[0]) / (fitted_bounds[2] - fitted_bounds[0]);
    let scale_y = (drawable[3] - drawable[1]) / (fitted_bounds[3] - fitted_bounds[1]);
    let actual_pixels = [
        drawable[0] + (bounds.min_x - fitted_bounds[0]) * scale_x,
        drawable[1] + (fitted_bounds[3] - bounds.max_y) * scale_y,
        drawable[0] + (bounds.max_x - fitted_bounds[0]) * scale_x,
        drawable[1] + (fitted_bounds[3] - bounds.min_y) * scale_y,
    ];
    [
        (actual_pixels[0] - ANTIALIAS_GUARD_PIXELS).max(drawable[0]),
        (actual_pixels[1] - ANTIALIAS_GUARD_PIXELS).max(drawable[1]),
        (actual_pixels[2] + ANTIALIAS_GUARD_PIXELS).min(drawable[2]),
        (actual_pixels[3] + ANTIALIAS_GUARD_PIXELS).min(drawable[3]),
    ]
}

fn timestamp_resources(
    device: &Device,
    features: Features,
    iterations: u32,
    mode: &str,
) -> Result<Option<TimestampResources>> {
    if !features.contains(Features::TIMESTAMP_QUERY) {
        return Ok(None);
    }
    let query_count = iterations
        .checked_mul(2)
        .ok_or("timestamp query count overflow")?;
    if query_count > wgpu::QUERY_SET_MAX_QUERIES {
        return Err(format!(
            "{} iterations exceed the timestamp query limit of {}",
            iterations,
            wgpu::QUERY_SET_MAX_QUERIES / 2
        )
        .into());
    }
    let byte_length = u64::from(query_count) * 8;
    let query_label = format!("shift-slug {mode} timestamps");
    let resolve_label = format!("shift-slug {mode} timestamp resolve");
    let readback_label = format!("shift-slug {mode} timestamp readback");
    Ok(Some(TimestampResources {
        query_set: device.create_query_set(&QuerySetDescriptor {
            label: Some(&query_label),
            ty: QueryType::Timestamp,
            count: query_count,
        }),
        resolve_buffer: device.create_buffer(&BufferDescriptor {
            label: Some(&resolve_label),
            size: byte_length,
            usage: BufferUsages::QUERY_RESOLVE | BufferUsages::COPY_SRC,
            mapped_at_creation: false,
        }),
        readback_buffer: device.create_buffer(&BufferDescriptor {
            label: Some(&readback_label),
            size: byte_length,
            usage: BufferUsages::COPY_DST | BufferUsages::MAP_READ,
            mapped_at_creation: false,
        }),
        query_count,
    }))
}

fn read_timestamps(
    device: &Device,
    queue: &wgpu::Queue,
    resources: Option<&TimestampResources>,
    period_nanoseconds: f32,
) -> Result<Option<TimestampMeasurements>> {
    let Some(resources) = resources else {
        return Ok(None);
    };
    let byte_length = u64::from(resources.query_count) * 8;
    let mut encoder = device.create_command_encoder(&CommandEncoderDescriptor {
        label: Some("shift-slug timestamp readback encoder"),
    });
    encoder.resolve_query_set(
        &resources.query_set,
        0..resources.query_count,
        &resources.resolve_buffer,
        0,
    );
    encoder.copy_buffer_to_buffer(
        &resources.resolve_buffer,
        0,
        &resources.readback_buffer,
        0,
        byte_length,
    );
    queue.submit([encoder.finish()]);
    device.poll(PollType::wait_indefinitely())?;
    let bytes = read_buffer(device, &resources.readback_buffer)?;
    Ok(Some(timestamp_milliseconds(&bytes, period_nanoseconds)))
}

fn print_timestamp_measurements(
    mode: &str,
    measurements: Option<&TimestampMeasurements>,
) -> Result<()> {
    let Some(measurements) = measurements else {
        println!("{mode}_gpu_timestamps=unsupported");
        return Ok(());
    };
    if measurements.durations_ms.is_empty() {
        return Err(format!("all {mode} GPU timestamp pairs were non-monotonic").into());
    }
    println!(
        "{mode}_gpu_pass_ms_p50={:.3} p95={:.3} p99={:.3} max={:.3} valid_pairs={} non_monotonic_pairs={}",
        percentile(&measurements.durations_ms, 0.50),
        percentile(&measurements.durations_ms, 0.95),
        percentile(&measurements.durations_ms, 0.99),
        measurements.durations_ms.last().copied().unwrap_or(0.0),
        measurements.durations_ms.len(),
        measurements.non_monotonic_pairs,
    );
    Ok(())
}

fn encode_render_pass(
    encoder: &mut wgpu::CommandEncoder,
    view: &wgpu::TextureView,
    pipeline: &wgpu::RenderPipeline,
    globals: &wgpu::BindGroup,
    atlas: &wgpu::BindGroup,
    instance_count: u32,
    timestamp_writes: Option<RenderPassTimestampWrites<'_>>,
) {
    let color_attachments = [Some(RenderPassColorAttachment {
        view,
        depth_slice: None,
        resolve_target: None,
        ops: Operations {
            load: LoadOp::Clear(wgpu::Color::TRANSPARENT),
            store: StoreOp::Store,
        },
    })];
    let mut pass = encoder.begin_render_pass(&RenderPassDescriptor {
        label: Some("shift-slug offscreen pass"),
        color_attachments: &color_attachments,
        depth_stencil_attachment: None,
        timestamp_writes,
        occlusion_query_set: None,
        multiview_mask: None,
    });
    pass.set_pipeline(pipeline);
    pass.set_bind_group(0, globals, &[]);
    pass.set_bind_group(1, atlas, &[]);
    pass.draw(0..6, 0..instance_count);
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

fn align_copy_bytes(value: u32) -> u32 {
    value.div_ceil(COPY_ALIGNMENT) * COPY_ALIGNMENT
}

fn unpack_rows(bytes: &[u8], width: u32, height: u32, padded_bytes_per_row: u32) -> Vec<u8> {
    let row_bytes = width as usize * 4;
    let padded = padded_bytes_per_row as usize;
    let mut output = Vec::with_capacity(row_bytes * height as usize);
    for row in bytes.chunks_exact(padded).take(height as usize) {
        output.extend_from_slice(&row[..row_bytes]);
    }
    output
}

fn timestamp_milliseconds(bytes: &[u8], period_nanoseconds: f32) -> TimestampMeasurements {
    let timestamps: Vec<_> = bytes
        .chunks_exact(8)
        .map(|bytes| u64::from_le_bytes(bytes.try_into().expect("timestamp is eight bytes")))
        .collect();
    let mut non_monotonic_pairs = 0;
    let mut durations_ms: Vec<_> = timestamps
        .chunks_exact(2)
        .filter_map(|pair| {
            let ticks = pair[1].checked_sub(pair[0]);
            if ticks.is_none() {
                non_monotonic_pairs += 1;
            }
            ticks.map(|ticks| ticks as f64 * f64::from(period_nanoseconds) / 1_000_000.0)
        })
        .collect();
    durations_ms.sort_by(f64::total_cmp);
    TimestampMeasurements {
        durations_ms,
        non_monotonic_pairs,
    }
}

fn percentile(values: &[f64], quantile: f64) -> f64 {
    if values.is_empty() {
        return 0.0;
    }
    values[((values.len() - 1) as f64 * quantile).round() as usize]
}

fn write_pgm(path: &std::path::Path, width: u32, height: u32, alpha: &[u8]) -> Result<()> {
    let mut bytes = format!("P5\n{width} {height}\n255\n").into_bytes();
    bytes.extend_from_slice(alpha);
    fs::write(path, bytes)?;
    Ok(())
}

fn fnv1a(bytes: &[u8]) -> u64 {
    bytes.iter().fold(0xcbf2_9ce4_8422_2325, |hash, byte| {
        (hash ^ u64::from(*byte)).wrapping_mul(0x0000_0100_0000_01b3)
    })
}

fn milliseconds(duration: Duration) -> f64 {
    duration.as_secs_f64() * 1_000.0
}

fn arguments() -> Result<Arguments> {
    let mut values = env::args().skip(1).peekable();
    let font = values
        .next_if(|value| !value.starts_with("--") && !value.contains('='))
        .map(PathBuf::from);
    let mut arguments = Arguments {
        font,
        band_count: DEFAULT_BAND_COUNT,
        settings: Vec::new(),
        width: DEFAULT_WIDTH,
        height: DEFAULT_HEIGHT,
        cell_size: DEFAULT_CELL_SIZE,
        iterations: DEFAULT_ITERATIONS,
        output: None,
        full_cell_quads: false,
    };

    while let Some(value) = values.next() {
        match value.as_str() {
            "--bands" => arguments.band_count = required_value(&mut values, "--bands")?.parse()?,
            "--width" => arguments.width = required_value(&mut values, "--width")?.parse()?,
            "--height" => arguments.height = required_value(&mut values, "--height")?.parse()?,
            "--cell-size" => {
                arguments.cell_size = required_value(&mut values, "--cell-size")?.parse()?
            }
            "--iterations" => {
                arguments.iterations = required_value(&mut values, "--iterations")?.parse()?
            }
            "--full-cell-quads" => arguments.full_cell_quads = true,
            "--output" => {
                arguments.output = Some(PathBuf::from(required_value(&mut values, "--output")?))
            }
            _ => arguments.settings.push(parse_setting(&value)?),
        }
    }

    if arguments.width == 0
        || arguments.height == 0
        || arguments.cell_size <= (CELL_PADDING * 2.0) as u32
        || arguments.iterations == 0
    {
        return Err(
            "width, height, iterations, and cell size above eight pixels are required".into(),
        );
    }
    if arguments.font.is_none() && (arguments.output.is_some() || !arguments.settings.is_empty()) {
        return Err("font-dependent options require a FONT argument".into());
    }

    Ok(arguments)
}

fn required_value(values: &mut impl Iterator<Item = String>, option: &str) -> Result<String> {
    values
        .next()
        .ok_or_else(|| format!("{option} requires a value").into())
}

fn parse_setting(value: &str) -> Result<(Tag, f32)> {
    let (tag, coordinate) = value
        .split_once('=')
        .ok_or("unknown option or axis setting; expected TAG=VALUE")?;
    let tag: [u8; 4] = tag
        .as_bytes()
        .try_into()
        .map_err(|_| "axis tag must contain exactly four ASCII bytes")?;
    Ok((Tag::new(&tag), coordinate.parse()?))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn default_workload_has_150_visible_instances() {
        assert_eq!(
            (DEFAULT_WIDTH / DEFAULT_CELL_SIZE) * (DEFAULT_HEIGHT / DEFAULT_CELL_SIZE),
            150
        );
    }

    #[test]
    fn tight_quad_uses_the_full_cell_fragment_transform() {
        let bounds = Bounds {
            min_x: -100.0,
            min_y: -250.0,
            max_x: 700.0,
            max_y: 900.0,
        };
        let cell = [0.0, 0.0, 64.0, 64.0];
        let fitted = aspect_fitted_bounds(bounds, 64.0, 64.0);
        let transform = pixel_to_em_transform(cell, fitted);
        let tight_pixels = tight_guarded_rect(bounds, cell, fitted);
        let em_at_top_left = [
            4.0 * transform[0] + transform[2],
            4.0 * transform[1] + transform[3],
        ];
        let em_at_bottom_right = [
            60.0 * transform[0] + transform[2],
            60.0 * transform[1] + transform[3],
        ];

        assert!((em_at_top_left[0] - fitted[0]).abs() < 0.001);
        assert!((em_at_top_left[1] - fitted[3]).abs() < 0.001);
        assert!((em_at_bottom_right[0] - fitted[2]).abs() < 0.001);
        assert!((em_at_bottom_right[1] - fitted[1]).abs() < 0.001);
        assert!(tight_pixels[0] >= 4.0 && tight_pixels[1] >= 4.0);
        assert!(tight_pixels[2] <= 60.0 && tight_pixels[3] <= 60.0);
    }

    #[test]
    fn non_monotonic_timestamp_pairs_are_reported_not_wrapped() {
        let bytes: Vec<_> = [100_u64, 120, 50, 40, 1, 1]
            .into_iter()
            .flat_map(u64::to_le_bytes)
            .collect();
        let measurements = timestamp_milliseconds(&bytes, 2.0);

        assert_eq!(measurements.non_monotonic_pairs, 1);
        assert_eq!(measurements.durations_ms.len(), 2);
        assert_eq!(measurements.durations_ms[0], 0.0);
        assert!((measurements.durations_ms[1] - 0.000_04).abs() < f64::EPSILON);
    }
}
