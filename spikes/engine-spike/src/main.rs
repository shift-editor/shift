use engine_spike::*;

fn main() {
    let only = std::env::args().nth(1);
    match only.as_deref() {
        Some("transform-hash") => return println!("{:016x}", fnv(&transform_bits())),
        Some("transform-hash-libm") => return println!("{:016x}", fnv(&transform_bits_libm())),
        Some("transform-bits") => {
            let bits: Vec<String> = transform_bits().iter().map(|b| format!("{b:016x}")).collect();
            return println!("{}", serde_json::to_string(&bits).unwrap());
        }
        Some("sweep") => {
            for row in sweep() { println!("{row}"); }
            return;
        }
        _ => {}
    }
    for (name, shape) in shapes() {
        if only.as_deref().is_some_and(|o| o != name) { continue; }
        let timings = run(shape, 30);
        println!("{}", serde_json::json!({ "shape": name, "timings": timings }));
    }
}
