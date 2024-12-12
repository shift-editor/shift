use kurbo::BezPath;
use lyon::math::point;
use lyon::tessellation::{BuffersBuilder, VertexBuffers};

use lyon::tessellation::{StrokeOptions, StrokeTessellator, StrokeVertex};

#[derive(Debug, Clone, Copy)]
struct Vertex {
    position: [f32; 2],   // x,y coordinates
    normal: [f32; 2],     // direction perpendicular to curve
    tex_coords: [f32; 2], // used for texturing and effects
}

fn subdivide_curve(points: &[(f32, f32)], max_distance: f32) -> Vec<(f32, f32)> {
    let mut result = Vec::new();
    for window in points.windows(2) {
        let start = window[0];
        let end = window[1];
        // Calculate distance between points
        let distance = ((end.0 - start.0).powi(2) + (end.1 - start.1).powi(2)).sqrt();
        // Determine how many segments we need
        let segments = (distance / max_distance).ceil() as usize;

        // Create intermediate points
        for i in 0..segments {
            let t = i as f32 / segments as f32;
            let x = start.0 + (end.0 - start.0) * t; // Linear interpolation
            let y = start.1 + (end.1 - start.1) * t;
            result.push((x, y));
        }
    }
    result.push(*points.last().unwrap());
    result
}

impl Vertex {
    fn from_stroke_vertex(vertex: StrokeVertex) -> Self {
        Self {
            position: vertex.position().to_array(),
            normal: vertex.normal().to_array(),
            tex_coords: [vertex.advancement(), 0.0],
        }
    }
}

#[tauri::command]
fn generate_curve() -> Vec<f32> {
    // 1. Define curve with Kurbo (great for bezier math)
    let mut path = BezPath::new();
    path.move_to((-0.5, 0.0));
    path.curve_to(
        (0.2, 0.4), // First control point - adjusted for smoother curve
        (0.8, 0.4), // Second control point
        (1.0, 0.0), // End point
    );
    path.close_path();

    // 2. Convert to Lyon path for tessellation
    let mut lyon_path = lyon::path::Path::builder();
    lyon_path.begin(point(-0.5, 0.0)); // Start the path

    for segment in path.segments() {
        match segment {
            kurbo::PathSeg::Line(line) => {
                lyon_path.line_to(point(line.p1.x as f32, line.p1.y as f32));
            }
            kurbo::PathSeg::Quad(quad) => {
                lyon_path.quadratic_bezier_to(
                    point(quad.p1.x as f32, quad.p1.y as f32),
                    point(quad.p2.x as f32, quad.p2.y as f32),
                );
            }
            kurbo::PathSeg::Cubic(cubic) => {
                lyon_path.cubic_bezier_to(
                    point(cubic.p1.x as f32, cubic.p1.y as f32),
                    point(cubic.p2.x as f32, cubic.p2.y as f32),
                    point(cubic.p3.x as f32, cubic.p3.y as f32),
                );
            }
        }
    }
    lyon_path.end(false);

    // 3. Tessellate with Lyon using stroke
    let mut tessellator = StrokeTessellator::new();
    let mut geometry: VertexBuffers<Vertex, u16> = VertexBuffers::new();

    tessellator
        .tessellate_path(
            &lyon_path.build(),
            &StrokeOptions::default()
                .with_line_width(0.005) // Thinner line
                .with_tolerance(0.0001) // Higher quality tessellation
                .with_line_join(lyon::path::LineJoin::Round) // Round joins between segments
                .with_line_cap(lyon::path::LineCap::Round),
            &mut BuffersBuilder::new(&mut geometry, |vertex: StrokeVertex| {
                Vertex::from_stroke_vertex(vertex)
            }),
        )
        .unwrap();

    // Flatten the vertex data for WebGL
    let vertices = geometry
        .vertices
        .iter()
        .flat_map(|v| {
            let mut data = Vec::with_capacity(6);
            data.extend_from_slice(&v.position);
            data.extend_from_slice(&v.normal);
            data.extend_from_slice(&v.tex_coords);
            data
        })
        .collect();

    println!("vertices: {:?}", geometry);

    vertices
}

#[tauri::command]
fn test(name: &str) -> Result<String, String> {
    Ok("HEY FROM THE BACK".into())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_log::Builder::new().build())
        .plugin(tauri_plugin_shell::init())
        .invoke_handler(tauri::generate_handler![generate_curve])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
