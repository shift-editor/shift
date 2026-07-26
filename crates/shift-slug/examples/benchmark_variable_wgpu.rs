use std::{env, error::Error, fs, num::NonZeroU64, path::PathBuf, sync::mpsc, time::Instant};

use shift_glyph_codec::OutlineCommand;
use shift_slug::{
    pack_render_instances, pack_render_params, Bounds, Curve, RenderInstance, RenderParams,
    SlugError, VariableAtlas, VariableAtlasBuilder, DEFAULT_BAND_COUNT, VARIABLE_SLUG_WGSL,
};
use skrifa::{
    outline::{DrawSettings, OutlinePen},
    prelude::{LocationRef, Size},
    FontRef, GlyphId, MetadataProvider, Tag,
};
use wgpu::{
    util::{BufferInitDescriptor, DeviceExt},
    BindGroupEntry, BindingResource, BufferBinding, BufferDescriptor, BufferUsages, Color,
    ColorTargetState, ColorWrites, CommandEncoderDescriptor, ComputePassDescriptor,
    ComputePipelineDescriptor, Device, DeviceDescriptor, Extent3d, FragmentState, LoadOp,
    MemoryHints, Operations, Origin3d, PipelineCompilationOptions, PollType, PowerPreference,
    PrimitiveState, RenderPassColorAttachment, RenderPassDescriptor, RenderPipelineDescriptor,
    RequestAdapterOptions, ShaderModuleDescriptor, ShaderSource, StoreOp, TexelCopyBufferInfo,
    TexelCopyBufferLayout, TexelCopyTextureInfo, TextureAspect, TextureDescriptor,
    TextureDimension, TextureFormat, TextureUsages, TextureViewDescriptor, VertexState,
};

type Result<T> = std::result::Result<T, Box<dyn Error>>;

const COPY_ALIGNMENT: u32 = 256;
const DEFAULT_VISIBLE_GLYPHS: usize = 150;
const DEFAULT_ITERATIONS: u32 = 120;
const GRID_COLUMNS: usize = 15;
const CELL_SIZE: u32 = 64;
const CELL_PADDING: f32 = 4.0;

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
    iterations: u32,
    build_only: bool,
}

#[derive(Clone, Copy)]
struct ScratchLayout {
    curve_count: usize,
    band_count: usize,
    index_count: usize,
    glyph_count: usize,
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
    let (source_bytes, exact_variant_count, atlas) = build_atlas(&arguments)?;
    let build_elapsed = build_started.elapsed();
    let alignment = usize::try_from(
        adapter
            .limits()
            .min_storage_buffer_offset_alignment
            .max(COPY_ALIGNMENT),
    )?;
    let pack_started = Instant::now();
    let (packed, layout, upload_chunk_count) = if arguments.build_only {
        let mut chunk_count = 0_usize;
        let mut streamed_length = 0_usize;
        let layout = atlas.write_packed_chunks(alignment, 4 * 1024 * 1024, |chunk| {
            assert_eq!(chunk.offset, streamed_length);
            streamed_length += chunk.bytes.len();
            chunk_count += 1;
        })?;
        assert_eq!(streamed_length, layout.total_length);
        (None, layout, chunk_count)
    } else {
        let packed = atlas.pack(alignment)?;
        let layout = packed.layout();
        (Some(packed), layout, 1)
    };
    let pack_elapsed = pack_started.elapsed();
    let glyph_indices = sampled_glyph_indices(atlas.glyphs().len(), arguments.visible_glyphs);
    let (instances, scratch) = build_instances(&atlas, &glyph_indices)?;
    let instance_bytes = pack_render_instances(&instances)?;
    let variable_params = variable_params(instances.len(), arguments.band_count)?;
    let initial_weights = source_weights(arguments.weight)?;

    println!(
        "source={} source_bytes={} glyphs={} exact_variants={} curves={} variable_bytes={} build_ms={:.3} pack_ms={:.3} upload_chunks={}",
        arguments.font.display(),
        source_bytes,
        atlas.glyphs().len(),
        exact_variant_count,
        atlas.base_curves().len(),
        layout.total_length,
        build_elapsed.as_secs_f64() * 1_000.0,
        pack_elapsed.as_secs_f64() * 1_000.0,
        upload_chunk_count,
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
    let statistics = atlas.statistics();
    println!(
        "delta_curves={} sparse_indices={} dense_sources={} sparse_sources={}",
        statistics.delta_curve_count,
        statistics.delta_index_count,
        statistics.dense_delta_source_count,
        statistics.sparse_delta_source_count,
    );
    if arguments.build_only {
        return Ok(());
    }
    let packed = packed.expect("non-build-only execution creates contiguous benchmark bytes");

    let largest_binding = layout
        .base_curves
        .length
        .max(layout.curve_deltas.length)
        .max(layout.sparse_deltas.length)
        .max(layout.glyphs.length)
        .max(layout.sources.length)
        .max(layout.source_advances.length)
        .max(layout.line_bits.length)
        .max(scratch.curve_count * 24)
        .max(scratch.band_count * 8)
        .max(scratch.index_count * 4)
        .max(scratch.glyph_count * 16)
        .max(scratch.glyph_count * 4);
    let mut required_limits = wgpu::Limits::default();
    required_limits.max_buffer_size = required_limits
        .max_buffer_size
        .max(u64::try_from(layout.total_length)?)
        .max(u64::try_from(scratch_bytes(scratch)?)?);
    required_limits.max_storage_buffer_binding_size = required_limits
        .max_storage_buffer_binding_size
        .max(u64::try_from(largest_binding)?);
    required_limits.max_storage_buffers_per_shader_stage =
        required_limits.max_storage_buffers_per_shader_stage.max(12);
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
    let weight_buffer = device.create_buffer_init(&BufferInitDescriptor {
        label: Some("shift-slug source weights"),
        contents: &initial_weights,
        usage: BufferUsages::STORAGE | BufferUsages::COPY_DST,
    });
    let viewport_width = (GRID_COLUMNS as u32) * CELL_SIZE;
    let viewport_height = u32::try_from(instances.len().div_ceil(GRID_COLUMNS))?
        .max(1)
        .checked_mul(CELL_SIZE)
        .ok_or("viewport height overflow")?;
    let global_bytes = pack_render_params(RenderParams {
        viewport_width: viewport_width as f32,
        viewport_height: viewport_height as f32,
        cell_padding: CELL_PADDING,
    });
    let global_buffer = device.create_buffer_init(&BufferInitDescriptor {
        label: Some("shift-slug variable render params"),
        contents: &global_bytes,
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
    let resolved_bounds_buffer = storage_buffer(
        &device,
        "shift-slug resolved glyph bounds",
        scratch.glyph_count * 16,
        BufferUsages::COPY_SRC,
    )?;
    let resolved_advance_buffer = storage_buffer(
        &device,
        "shift-slug resolved glyph advances",
        scratch.glyph_count * 4,
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
    let render_pipeline = device.create_render_pipeline(&RenderPipelineDescriptor {
        label: Some("shift-slug variable render pipeline"),
        layout: None,
        vertex: VertexState {
            module: &shader,
            entry_point: Some("vertex_variable"),
            compilation_options: PipelineCompilationOptions::default(),
            buffers: &[],
        },
        primitive: PrimitiveState::default(),
        depth_stencil: None,
        multisample: Default::default(),
        fragment: Some(FragmentState {
            module: &shader,
            entry_point: Some("fragment_variable"),
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

    let resolve_groups = create_resolve_groups(
        &device,
        &resolve_pipeline,
        &instance_buffer,
        &atlas_buffer,
        layout,
        &weight_buffer,
        &variable_buffer,
        &resolved_curve_buffer,
        &resolved_bounds_buffer,
        &resolved_advance_buffer,
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
        &resolved_bounds_buffer,
    );
    let render_groups = create_render_groups(
        &device,
        &render_pipeline,
        &global_buffer,
        &instance_buffer,
        &variable_buffer,
        &resolved_curve_buffer,
        &resolved_band_buffer,
        &resolved_index_buffer,
        &resolved_bounds_buffer,
    );
    let target = device.create_texture(&TextureDescriptor {
        label: Some("shift-slug variable target"),
        size: Extent3d {
            width: viewport_width,
            height: viewport_height,
            depth_or_array_layers: 1,
        },
        mip_level_count: 1,
        sample_count: 1,
        dimension: TextureDimension::D2,
        format: TextureFormat::Rgba8Unorm,
        usage: TextureUsages::RENDER_ATTACHMENT | TextureUsages::COPY_SRC,
        view_formats: &[],
    });
    let target_view = target.create_view(&TextureViewDescriptor::default());
    let padded_bytes_per_row = (viewport_width * 4).div_ceil(COPY_ALIGNMENT) * COPY_ALIGNMENT;
    let pixel_readback = readback_buffer(
        &device,
        "shift-slug variable pixel readback",
        padded_bytes_per_row as usize * viewport_height as usize,
    )?;

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
    let bounds_readback = readback_buffer(
        &device,
        "shift-slug bounds readback",
        scratch.glyph_count * 16,
    )?;
    let advance_readback = readback_buffer(
        &device,
        "shift-slug advance readback",
        scratch.glyph_count * 4,
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
    {
        let mut pass = encoder.begin_render_pass(&RenderPassDescriptor {
            label: Some("shift-slug variable render pass"),
            color_attachments: &[Some(RenderPassColorAttachment {
                view: &target_view,
                depth_slice: None,
                resolve_target: None,
                ops: Operations {
                    load: LoadOp::Clear(Color::TRANSPARENT),
                    store: StoreOp::Store,
                },
            })],
            depth_stencil_attachment: None,
            timestamp_writes: None,
            occlusion_query_set: None,
            multiview_mask: None,
        });
        pass.set_pipeline(&render_pipeline);
        for (index, group) in render_groups.iter().enumerate() {
            pass.set_bind_group(index as u32, group, &[]);
        }
        pass.draw(0..6, 0..u32::try_from(instances.len())?);
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
    encoder.copy_buffer_to_buffer(
        &resolved_bounds_buffer,
        0,
        &bounds_readback,
        0,
        u64::try_from(scratch.glyph_count * 16)?,
    );
    encoder.copy_buffer_to_buffer(
        &resolved_advance_buffer,
        0,
        &advance_readback,
        0,
        u64::try_from(scratch.glyph_count * 4)?,
    );
    encoder.copy_texture_to_buffer(
        TexelCopyTextureInfo {
            texture: &target,
            mip_level: 0,
            origin: Origin3d::ZERO,
            aspect: TextureAspect::All,
        },
        TexelCopyBufferInfo {
            buffer: &pixel_readback,
            layout: TexelCopyBufferLayout {
                offset: 0,
                bytes_per_row: Some(padded_bytes_per_row),
                rows_per_image: Some(viewport_height),
            },
        },
        Extent3d {
            width: viewport_width,
            height: viewport_height,
            depth_or_array_layers: 1,
        },
    );

    let gpu_started = Instant::now();
    queue.submit([encoder.finish()]);
    let curve_bytes = read_buffer(&device, &curve_readback)?;
    let band_bytes = read_buffer(&device, &band_readback)?;
    let index_bytes = read_buffer(&device, &index_readback)?;
    let bounds_bytes = read_buffer(&device, &bounds_readback)?;
    let advance_bytes = read_buffer(&device, &advance_readback)?;
    let pixel_bytes = read_buffer(&device, &pixel_readback)?;
    let gpu_elapsed = gpu_started.elapsed();
    let maximum_error = validate_curves(&atlas, &instances, arguments.weight, &curve_bytes)?;
    let maximum_advance_error =
        validate_advances(&atlas, &instances, arguments.weight, &advance_bytes)?;
    validate_bands(
        &atlas,
        &instances,
        arguments.weight,
        arguments.band_count,
        &curve_bytes,
        &band_bytes,
        &index_bytes,
        &bounds_bytes,
    )?;

    let pixels = unpack_rows(
        &pixel_bytes,
        viewport_width,
        viewport_height,
        padded_bytes_per_row,
    );
    let alpha = pixels
        .chunks_exact(4)
        .map(|pixel| pixel[3])
        .collect::<Vec<_>>();
    println!(
        "gpu_submit_to_readback_ms={:.3} max_curve_error={} max_advance_error={} curve_validation=pass advance_validation=pass band_validation=pass pixel_checksum={:016x} nonzero_alpha={}",
        gpu_elapsed.as_secs_f64() * 1_000.0,
        maximum_error,
        maximum_advance_error,
        fnv1a(&alpha),
        alpha.iter().filter(|value| **value != 0).count(),
    );

    let mut frame_milliseconds = Vec::with_capacity(arguments.iterations as usize);
    for iteration in 0..arguments.iterations {
        let weight = ((iteration * 37) % 101) as f32 / 100.0;
        let frame_weights = source_weights(weight)?;
        let frame_started = Instant::now();
        queue.write_buffer(&weight_buffer, 0, &frame_weights);
        let mut frame_encoder = device.create_command_encoder(&CommandEncoderDescriptor {
            label: Some("shift-slug variable frame encoder"),
        });
        encode_variable_frame(
            &mut frame_encoder,
            &resolve_pipeline,
            &resolve_groups,
            &band_pipeline,
            &band_groups,
            &render_pipeline,
            &render_groups,
            &target_view,
            instances.len(),
            arguments.band_count,
        )?;
        queue.submit([frame_encoder.finish()]);
        device.poll(PollType::wait_indefinitely())?;
        frame_milliseconds.push(frame_started.elapsed().as_secs_f64() * 1_000.0);
    }
    frame_milliseconds.sort_by(f64::total_cmp);
    println!(
        "serialized_frame_ms_p50={:.3} p95={:.3} p99={:.3} max={:.3} iterations={} geometry_uploads=0 geometry_upload_bytes=0 weight_upload_bytes={}",
        percentile(&frame_milliseconds, 0.50),
        percentile(&frame_milliseconds, 0.95),
        percentile(&frame_milliseconds, 0.99),
        frame_milliseconds.last().copied().unwrap_or(0.0),
        arguments.iterations,
        arguments.iterations * 8,
    );

    Ok(())
}

fn build_atlas(arguments: &Arguments) -> Result<(usize, usize, VariableAtlas)> {
    let bytes = fs::read(&arguments.font)?;
    let font = FontRef::new(&bytes)?;
    let metrics = font.metrics(Size::unscaled(), LocationRef::default());
    let glyph_count = u32::from(metrics.glyph_count);
    let base_location = font.axes().location([(arguments.axis, arguments.base)]);
    let source_location = font.axes().location([(arguments.axis, arguments.source)]);
    let base_metrics = font.glyph_metrics(Size::unscaled(), &base_location);
    let source_metrics = font.glyph_metrics(Size::unscaled(), &source_location);
    let outlines = font.outline_glyphs();
    let mut builder = VariableAtlasBuilder::new(arguments.band_count)?;
    let mut exact_variants = Vec::new();

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
        let base_advance = base_metrics
            .advance_width(glyph_id)
            .ok_or("base glyph advance is unavailable")?;
        let source_advance = source_metrics
            .advance_width(glyph_id)
            .ok_or("source glyph advance is unavailable")?;
        match builder.add_glyph(base.0.clone(), source.0.clone()) {
            Ok(glyph_index) => {
                builder.set_glyph_source_advances(glyph_index, [base_advance, source_advance])?
            }
            Err(SlugError::VariableTopologyMismatch { .. }) => {
                let glyph_index = builder.add_glyph(base.0.clone(), base.0)?;
                builder.set_glyph_source_advances(glyph_index, [base_advance, base_advance])?;
                exact_variants.push((source.0, source_advance));
            }
            Err(error) => return Err(error.into()),
        }
    }

    let exact_variant_count = exact_variants.len();
    for (source, advance) in exact_variants {
        let glyph_index = builder.add_glyph(source.clone(), source)?;
        builder.set_glyph_source_advances(glyph_index, [advance, advance])?;
    }

    Ok((bytes.len(), exact_variant_count, builder.finish()))
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

    for (instance_index, glyph_index) in glyph_indices.iter().copied().enumerate() {
        let glyph = atlas
            .glyphs()
            .get(glyph_index as usize)
            .ok_or("sampled glyph index is out of range")?;
        let column = instance_index % GRID_COLUMNS;
        let row = instance_index / GRID_COLUMNS;
        let cell_rect = [
            (column as u32 * CELL_SIZE) as f32,
            (row as u32 * CELL_SIZE) as f32,
            ((column as u32 + 1) * CELL_SIZE) as f32,
            ((row as u32 + 1) * CELL_SIZE) as f32,
        ];
        let fitted_bounds = aspect_fitted_bounds(glyph.bounds, CELL_SIZE as f32, CELL_SIZE as f32);
        instances.push(RenderInstance {
            pixel_rect: cell_rect,
            em_transform: pixel_to_em_transform(cell_rect, fitted_bounds),
            glyph_index,
            scratch_curve_start: u32::try_from(curve_count)?,
            scratch_band_start: u32::try_from(band_count)?,
            scratch_index_start: u32::try_from(index_count)?,
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
            glyph_count: glyph_indices.len(),
        },
    ))
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

fn variable_params(instances: usize, band_count: u32) -> Result<[u8; 16]> {
    let mut bytes = [0; 16];
    bytes[0..4].copy_from_slice(&u32::try_from(instances)?.to_le_bytes());
    bytes[4..8].copy_from_slice(&band_count.to_le_bytes());
    Ok(bytes)
}

fn source_weights(source_weight: f32) -> Result<[u8; 8]> {
    if !source_weight.is_finite() {
        return Err("weight must be finite".into());
    }
    let mut bytes = [0; 8];
    bytes[0..4].copy_from_slice(&(1.0 - source_weight).to_le_bytes());
    bytes[4..8].copy_from_slice(&source_weight.to_le_bytes());
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
fn encode_variable_frame(
    encoder: &mut wgpu::CommandEncoder,
    resolve_pipeline: &wgpu::ComputePipeline,
    resolve_groups: &[wgpu::BindGroup; 3],
    band_pipeline: &wgpu::ComputePipeline,
    band_groups: &[wgpu::BindGroup; 3],
    render_pipeline: &wgpu::RenderPipeline,
    render_groups: &[wgpu::BindGroup; 3],
    target_view: &wgpu::TextureView,
    instance_count: usize,
    band_count: u32,
) -> Result<()> {
    {
        let mut pass = encoder.begin_compute_pass(&ComputePassDescriptor {
            label: Some("shift-slug variable frame resolve"),
            timestamp_writes: None,
        });
        pass.set_pipeline(resolve_pipeline);
        for (index, group) in resolve_groups.iter().enumerate() {
            pass.set_bind_group(index as u32, group, &[]);
        }
        pass.dispatch_workgroups(u32::try_from(instance_count)?, 1, 1);
    }
    {
        let mut pass = encoder.begin_compute_pass(&ComputePassDescriptor {
            label: Some("shift-slug variable frame bands"),
            timestamp_writes: None,
        });
        pass.set_pipeline(band_pipeline);
        for (index, group) in band_groups.iter().enumerate() {
            pass.set_bind_group(index as u32, group, &[]);
        }
        pass.dispatch_workgroups(
            u32::try_from(instance_count)?
                .checked_mul(band_count * 2)
                .ok_or("band dispatch overflow")?,
            1,
            1,
        );
    }
    {
        let mut pass = encoder.begin_render_pass(&RenderPassDescriptor {
            label: Some("shift-slug variable frame render"),
            color_attachments: &[Some(RenderPassColorAttachment {
                view: target_view,
                depth_slice: None,
                resolve_target: None,
                ops: Operations {
                    load: LoadOp::Clear(Color::TRANSPARENT),
                    store: StoreOp::Store,
                },
            })],
            depth_stencil_attachment: None,
            timestamp_writes: None,
            occlusion_query_set: None,
            multiview_mask: None,
        });
        pass.set_pipeline(render_pipeline);
        for (index, group) in render_groups.iter().enumerate() {
            pass.set_bind_group(index as u32, group, &[]);
        }
        pass.draw(0..6, 0..u32::try_from(instance_count)?);
    }
    Ok(())
}

#[allow(clippy::too_many_arguments)]
fn create_resolve_groups(
    device: &Device,
    pipeline: &wgpu::ComputePipeline,
    instance_buffer: &wgpu::Buffer,
    atlas_buffer: &wgpu::Buffer,
    layout: shift_slug::VariableLayout,
    weight_buffer: &wgpu::Buffer,
    variable_buffer: &wgpu::Buffer,
    resolved_curve_buffer: &wgpu::Buffer,
    resolved_bounds_buffer: &wgpu::Buffer,
    resolved_advance_buffer: &wgpu::Buffer,
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
        ],
    });
    let group2 = device.create_bind_group(&wgpu::BindGroupDescriptor {
        label: Some("shift-slug resolve scratch"),
        layout: &pipeline.get_bind_group_layout(2),
        entries: &[
            BindGroupEntry {
                binding: 0,
                resource: resolved_curve_buffer.as_entire_binding(),
            },
            BindGroupEntry {
                binding: 3,
                resource: resolved_bounds_buffer.as_entire_binding(),
            },
            BindGroupEntry {
                binding: 4,
                resource: resolved_advance_buffer.as_entire_binding(),
            },
        ],
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
    resolved_bounds_buffer: &wgpu::Buffer,
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
                binding: 5,
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
            BindGroupEntry {
                binding: 3,
                resource: resolved_bounds_buffer.as_entire_binding(),
            },
        ],
    });
    [group0, group1, group2]
}

#[allow(clippy::too_many_arguments)]
fn create_render_groups(
    device: &Device,
    pipeline: &wgpu::RenderPipeline,
    global_buffer: &wgpu::Buffer,
    instance_buffer: &wgpu::Buffer,
    variable_buffer: &wgpu::Buffer,
    resolved_curve_buffer: &wgpu::Buffer,
    resolved_band_buffer: &wgpu::Buffer,
    resolved_index_buffer: &wgpu::Buffer,
    resolved_bounds_buffer: &wgpu::Buffer,
) -> [wgpu::BindGroup; 3] {
    let group0 = device.create_bind_group(&wgpu::BindGroupDescriptor {
        label: Some("shift-slug variable render globals"),
        layout: &pipeline.get_bind_group_layout(0),
        entries: &[
            BindGroupEntry {
                binding: 0,
                resource: global_buffer.as_entire_binding(),
            },
            BindGroupEntry {
                binding: 1,
                resource: instance_buffer.as_entire_binding(),
            },
        ],
    });
    let group1 = device.create_bind_group(&wgpu::BindGroupDescriptor {
        label: Some("shift-slug variable render model"),
        layout: &pipeline.get_bind_group_layout(1),
        entries: &[BindGroupEntry {
            binding: 5,
            resource: variable_buffer.as_entire_binding(),
        }],
    });
    let group2 = device.create_bind_group(&wgpu::BindGroupDescriptor {
        label: Some("shift-slug variable render scratch"),
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
            BindGroupEntry {
                binding: 3,
                resource: resolved_bounds_buffer.as_entire_binding(),
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
        .and_then(|bytes| bytes.checked_add(layout.glyph_count * 16))
        .and_then(|bytes| bytes.checked_add(layout.glyph_count * 4))
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

fn validate_advances(
    atlas: &VariableAtlas,
    instances: &[RenderInstance],
    weight: f32,
    bytes: &[u8],
) -> Result<f32> {
    let weights = [1.0 - weight, weight];
    let mut maximum_error = 0.0_f32;
    for (instance_index, instance) in instances.iter().enumerate() {
        let expected = atlas.resolve_advance_with_weights(instance.glyph_index, &weights)?;
        let actual = read_f32(bytes, instance_index)?;
        maximum_error = maximum_error.max((actual - expected).abs());
    }
    if maximum_error > 0.001 {
        return Err(format!("GPU advance error {maximum_error} exceeds 0.001").into());
    }
    Ok(maximum_error)
}

#[allow(clippy::too_many_arguments)]
fn validate_bands(
    atlas: &VariableAtlas,
    instances: &[RenderInstance],
    weight: f32,
    band_count: u32,
    curve_bytes: &[u8],
    band_bytes: &[u8],
    index_bytes: &[u8],
    bounds_bytes: &[u8],
) -> Result<()> {
    for (instance_index, instance) in instances.iter().enumerate() {
        let glyph = atlas.glyphs()[instance.glyph_index as usize];
        let expected_curves = atlas.resolve_glyph(instance.glyph_index, weight)?;
        let expected_bounds = curve_set_bounds(&expected_curves).unwrap_or(glyph.bounds);
        let bounds = read_bounds(bounds_bytes, instance_index)?;
        let bounds_error = [
            (bounds.min_x - expected_bounds.min_x).abs(),
            (bounds.min_y - expected_bounds.min_y).abs(),
            (bounds.max_x - expected_bounds.max_x).abs(),
            (bounds.max_y - expected_bounds.max_y).abs(),
        ]
        .into_iter()
        .fold(0.0, f32::max);
        if bounds_error > 0.001 {
            return Err(format!(
                "glyph {} resolved bounds error {bounds_error} exceeds 0.001",
                instance.glyph_index
            )
            .into());
        }
        let width = bounds.width().max(0.0001);
        let height = bounds.height().max(0.0001);
        for local_band in 0..band_count * 2 {
            let horizontal = local_band < band_count;
            let direction_band = if horizontal {
                local_band
            } else {
                local_band - band_count
            };
            let (axis_min, axis_size) = if horizontal {
                (bounds.min_y, height)
            } else {
                (bounds.min_x, width)
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

fn curve_set_bounds(curves: &[Curve]) -> Option<Bounds> {
    let mut curves = curves.iter();
    let mut bounds = curves.next()?.bounds();
    for curve in curves {
        let curve_bounds = curve.bounds();
        bounds.min_x = bounds.min_x.min(curve_bounds.min_x);
        bounds.min_y = bounds.min_y.min(curve_bounds.min_y);
        bounds.max_x = bounds.max_x.max(curve_bounds.max_x);
        bounds.max_y = bounds.max_y.max(curve_bounds.max_y);
    }
    Some(bounds)
}

fn read_bounds(bytes: &[u8], index: usize) -> Result<Bounds> {
    Ok(Bounds {
        min_x: read_f32(bytes, index * 4)?,
        min_y: read_f32(bytes, index * 4 + 1)?,
        max_x: read_f32(bytes, index * 4 + 2)?,
        max_y: read_f32(bytes, index * 4 + 3)?,
    })
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

fn unpack_rows(bytes: &[u8], width: u32, height: u32, padded_bytes_per_row: u32) -> Vec<u8> {
    let row_bytes = width as usize * 4;
    let padded = padded_bytes_per_row as usize;
    let mut output = Vec::with_capacity(row_bytes * height as usize);
    for row in bytes.chunks_exact(padded).take(height as usize) {
        output.extend_from_slice(&row[..row_bytes]);
    }
    output
}

fn fnv1a(bytes: &[u8]) -> u64 {
    bytes.iter().fold(0xcbf2_9ce4_8422_2325, |hash, byte| {
        (hash ^ u64::from(*byte)).wrapping_mul(0x0000_0100_0000_01b3)
    })
}

fn percentile(values: &[f64], quantile: f64) -> f64 {
    if values.is_empty() {
        return 0.0;
    }
    values[((values.len() - 1) as f64 * quantile).round() as usize]
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
        .ok_or("usage: benchmark_variable_wgpu FONT TAG=BASE,SOURCE [--weight VALUE] [--visible COUNT] [--bands COUNT] [--iterations COUNT] [--build-only]")?;
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
        iterations: DEFAULT_ITERATIONS,
        build_only: false,
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
            "--iterations" => {
                arguments.iterations = values
                    .next()
                    .ok_or("--iterations requires a count")?
                    .parse()?
            }
            "--build-only" => arguments.build_only = true,
            _ => return Err(format!("unknown option {option}").into()),
        }
    }

    if !(0.0..=1.0).contains(&arguments.weight) {
        return Err("--weight must be in 0..=1".into());
    }
    if arguments.visible_glyphs == 0 {
        return Err("--visible must be greater than zero".into());
    }
    if arguments.iterations == 0 {
        return Err("--iterations must be greater than zero".into());
    }
    Ok(arguments)
}
