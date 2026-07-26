use std::{hint::black_box, time::Instant};

use shift_glyph_codec::{pack_outline, OutlineCommand};

fn representative_outline() -> Vec<OutlineCommand<f64>> {
    let mut commands = vec![OutlineCommand::Move { x: 0.0, y: 0.0 }];
    for index in 0..80 {
        let x = f64::from(index) * 7.25;
        match index % 3 {
            0 => commands.push(OutlineCommand::Line { x, y: x * 0.5 }),
            1 => commands.push(OutlineCommand::Quad {
                cx: x - 2.0,
                cy: x * 0.25,
                x,
                y: x * 0.5,
            }),
            _ => commands.push(OutlineCommand::Cubic {
                c1x: x - 4.0,
                c1y: x * 0.2,
                c2x: x - 2.0,
                c2y: x * 0.4,
                x,
                y: x * 0.5,
            }),
        }
    }
    commands.push(OutlineCommand::Close);
    commands
}

fn main() {
    const ITERATIONS: usize = 20_000;
    const WARMUP_GLYPHS: usize = 400;
    let commands = representative_outline();
    let packed = pack_outline(&commands).expect("representative outline should encode");

    for _ in 0..1_000 {
        black_box(pack_outline(black_box(&commands)).unwrap());
    }

    let start = Instant::now();
    for _ in 0..ITERATIONS {
        black_box(pack_outline(black_box(&commands)).unwrap());
    }
    let elapsed = start.elapsed();
    let per_glyph_micros = elapsed.as_secs_f64() * 1_000_000.0 / ITERATIONS as f64;

    let warmup_start = Instant::now();
    for _ in 0..WARMUP_GLYPHS {
        black_box(pack_outline(black_box(&commands)).unwrap());
    }

    println!(
        "payload_bytes={} commands={} encode_us_per_glyph={:.3} encode_400_ms={:.3}",
        packed.as_bytes().len(),
        commands.len(),
        per_glyph_micros,
        warmup_start.elapsed().as_secs_f64() * 1_000.0,
    );
}
