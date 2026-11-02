//! What every file-format fuzz target does with an input: write it where the
//! loader expects a font file, open it the ways the editor does, and read
//! every glyph. Errors are fine; a panic, hang or out-of-memory is a finding.

use std::path::{Path, PathBuf};
use std::sync::OnceLock;

use shift_backends::font_loader::FontLoader;
use shift_backends::{FontSource, GlyphIndex};

/// The most glyphs one input projects, so a font claiming millions of glyphs
/// costs one input, not the whole time box.
const GLYPH_LIMIT: u32 = 256;

/// A directory for this fuzzing process, made once.
pub fn scratch() -> &'static Path {
    static DIR: OnceLock<PathBuf> = OnceLock::new();
    DIR.get_or_init(|| {
        let dir = std::env::temp_dir().join(format!("shift-fuzz-{}", std::process::id()));
        std::fs::create_dir_all(&dir).expect("a scratch directory");
        dir
    })
}

/// Writes `bytes` to `path`, replacing what an earlier input wrote.
pub fn write(path: &Path, bytes: &[u8]) {
    std::fs::write(path, bytes).expect("the input is written");
}

/// Opens `path` as a retained source and projects its glyphs, then reads it
/// as a whole authored font.
pub fn exercise(path: &Path) {
    let loader = FontLoader::new();
    if let Ok(source) = loader.open_source(path) {
        let count = source.directory().glyph_count().min(GLYPH_LIMIT);
        for index in 0..count {
            let _ = source.glyph(GlyphIndex::new(index));
        }
    }
    if let Some(path) = path.to_str() {
        let _ = loader.read_font(path);
    }
}
