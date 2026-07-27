use std::{collections::BTreeMap, hint::black_box, time::Instant};

use shift_glyph_codec::{
    decode_layer, pack_layer, GlyphLayer, LayerAnchor, LayerComponent, LayerContour, LayerPoint,
    LayerPointType, LayerTransform,
};

fn outline_layer(name: &str, contour_count: usize, points_per_contour: usize) -> GlyphLayer {
    let contours = (0..contour_count)
        .map(|contour_index| LayerContour {
            id: format!("contour_{name}_{contour_index}"),
            closed: true,
            points: (0..points_per_contour)
                .map(|point_index| {
                    let value = (contour_index * points_per_contour + point_index) as f64;
                    LayerPoint {
                        id: format!("point_{name}_{contour_index}_{point_index}"),
                        point_type: match point_index % 3 {
                            0 => LayerPointType::OnCurve,
                            1 => LayerPointType::OffCurve,
                            _ => LayerPointType::QCurve,
                        },
                        smooth: point_index % 5 == 0,
                        x: value * 0.75,
                        y: value * -0.375,
                    }
                })
                .collect(),
        })
        .collect();

    GlyphLayer {
        id: format!("layer_{name}"),
        source_id: "source_regular".to_string(),
        width: 1_000.0,
        height: Some(1_000.0),
        contours,
        components: Vec::new(),
        anchors: vec![LayerAnchor {
            id: format!("anchor_{name}"),
            name: Some("top".to_string()),
            x: 500.0,
            y: 800.0,
        }],
        guidelines: Vec::new(),
        lib: BTreeMap::new(),
    }
}

fn composite_layer() -> GlyphLayer {
    let mut layer = outline_layer("composite", 1, 4);
    layer.components = (0..8)
        .map(|index| LayerComponent {
            id: format!("component_{index}"),
            base_glyph_id: format!("glyph_base_{index}"),
            base_glyph_name: format!("base.{index}"),
            transform: LayerTransform {
                translate_x: index as f64 * 40.0,
                translate_y: index as f64 * 20.0,
                rotation: index as f64,
                ..LayerTransform::default()
            },
        })
        .collect();
    layer
}

fn run(name: &str, layer: &GlyphLayer, iterations: usize) {
    let packed = pack_layer(layer).expect("representative layer should encode");
    for _ in 0..100 {
        black_box(pack_layer(black_box(layer)).unwrap());
        black_box(decode_layer(black_box(packed.as_bytes())).unwrap());
    }

    let encode_start = Instant::now();
    for _ in 0..iterations {
        black_box(pack_layer(black_box(layer)).unwrap());
    }
    let encode_us = encode_start.elapsed().as_secs_f64() * 1_000_000.0 / iterations as f64;

    let decode_start = Instant::now();
    for _ in 0..iterations {
        let view = decode_layer(black_box(packed.as_bytes())).unwrap();
        black_box(view.contours().flat_map(|contour| contour.points()).count());
    }
    let decode_us = decode_start.elapsed().as_secs_f64() * 1_000_000.0 / iterations as f64;

    println!(
        "case={name} payload_bytes={} contours={} points={} components={} encode_us={encode_us:.3} validate_iterate_us={decode_us:.3}",
        packed.as_bytes().len(),
        packed.view().contour_count(),
        packed.view().point_count(),
        packed.view().component_count(),
    );
}

fn run_sparse_multi_source() {
    const SOURCE_SLOTS: usize = 13;
    const ITERATIONS: usize = 2_000;
    let layers = (0..SOURCE_SLOTS)
        .filter(|index| index % 4 == 0)
        .map(|index| {
            let mut layer = outline_layer(&format!("sparse_{index}"), 1, 3);
            layer.source_id = format!("source_{index}");
            layer
        })
        .collect::<Vec<_>>();
    let payload_bytes = layers
        .iter()
        .map(|layer| pack_layer(layer).unwrap().as_bytes().len())
        .sum::<usize>();

    let start = Instant::now();
    for _ in 0..ITERATIONS {
        for layer in &layers {
            black_box(pack_layer(black_box(layer)).unwrap());
        }
    }
    let per_set_us = start.elapsed().as_secs_f64() * 1_000_000.0 / ITERATIONS as f64;
    println!(
        "case=sparse-multi-source source_slots={SOURCE_SLOTS} present_layers={} payload_bytes={payload_bytes} encode_us_per_glyph_source_set={per_set_us:.3}",
        layers.len(),
    );
}

fn main() {
    run("simple", &outline_layer("simple", 1, 24), 5_000);
    run("composite", &composite_layer(), 5_000);
    run_sparse_multi_source();
    run("cjk", &outline_layer("cjk", 24, 48), 500);
    run(
        "pathological",
        &outline_layer("pathological", 1_000, 100),
        10,
    );
}
