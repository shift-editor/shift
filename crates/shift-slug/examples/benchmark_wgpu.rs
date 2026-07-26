use std::error::Error;

use wgpu::{Features, PowerPreference, RequestAdapterOptions};

type Result<T> = std::result::Result<T, Box<dyn Error>>;

fn main() -> Result<()> {
    let instance = wgpu::Instance::default();
    let adapter = pollster::block_on(instance.request_adapter(&RequestAdapterOptions {
        power_preference: PowerPreference::HighPerformance,
        force_fallback_adapter: false,
        compatible_surface: None,
        apply_limit_buckets: false,
    }))?;
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

    Ok(())
}
