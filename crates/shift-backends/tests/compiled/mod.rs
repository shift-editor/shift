//! Reading a glyph back from a compiled font, for the tests that check what
//! export writes.

use skrifa::outline::{DrawSettings, OutlinePen};
use skrifa::prelude::{LocationRef, Size};
use skrifa::{FontRef, MetadataProvider};

/// A fixture step that fails with a reason instead of panicking.
pub(crate) type Fixture<T> = Result<T, Box<dyn std::error::Error>>;

/// Collects the on-curve points an outline draws.
#[derive(Default)]
struct OnCurvePoints(Vec<(f32, f32)>);

impl OutlinePen for OnCurvePoints {
    fn move_to(&mut self, x: f32, y: f32) {
        self.0.push((x, y));
    }
    fn line_to(&mut self, x: f32, y: f32) {
        self.0.push((x, y));
    }
    fn quad_to(&mut self, _: f32, _: f32, x: f32, y: f32) {
        self.0.push((x, y));
    }
    fn curve_to(&mut self, _: f32, _: f32, _: f32, _: f32, x: f32, y: f32) {
        self.0.push((x, y));
    }
    fn close(&mut self) {}
}

/// The on-curve points the glyph mapped to `character` draws at the
/// compiled font's default location, through skrifa (which reads `VARC`).
pub(crate) fn on_curve_points(binary: &[u8], character: char) -> Fixture<Vec<(f32, f32)>> {
    let compiled = FontRef::new(binary)?;
    let glyph_id = compiled
        .charmap()
        .map(character)
        .ok_or("the glyph is not mapped")?;
    let outline = compiled
        .outline_glyphs()
        .get(glyph_id)
        .ok_or("the glyph has no outline")?;
    let mut pen = OnCurvePoints::default();
    outline.draw(
        DrawSettings::unhinted(Size::unscaled(), LocationRef::default()),
        &mut pen,
    )?;
    Ok(pen.0)
}
