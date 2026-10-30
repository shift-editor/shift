//! Imports an OTF through the workspace (as the app does) and saves it as a `.shift` document.
use std::time::Instant;

fn main() {
    let args: Vec<String> = std::env::args().collect();
    let (otf, out) = (&args[1], &args[2]);
    let dir = std::env::temp_dir().join(format!("boundary-bench-{}", std::process::id()));
    std::fs::create_dir_all(&dir).unwrap();
    let t = Instant::now();
    let mut ws = shift_workspace::FontWorkspace::open(otf, dir.join("store.sqlite")).unwrap();
    eprintln!("import: {:?}", t.elapsed());
    let t = Instant::now();
    ws.save_as_document(out, dir.join("recovery.sqlite")).unwrap();
    eprintln!("save as document: {:?}", t.elapsed());
    eprintln!("glyphs: {}", ws.font().glyphs().count());
}
