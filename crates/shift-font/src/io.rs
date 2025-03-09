use skrifa::{
    FontRef, MetadataProvider,
    instance::{LocationRef, Size},
    outline::{DrawSettings, OutlinePen},
};

pub fn load_font(font_bytes: &[u8]) -> Result<FontRef, String> {
    let font = FontRef::new(font_bytes).expect("Failed to load font");
    Ok(font)
}

#[cfg(test)]
mod tests {
    use skrifa::raw::TableProvider;

    use super::*;
    use crate::path::ShiftPen;

    #[test]
    fn can_load_font_from_file() {
        // let font_bytes = std::fs::read("./src/fonts/Liverpool.ttf").unwrap();
        // let font = FontRef::new(&font_bytes).unwrap();
        //
        // let glyphs = font.outline_glyphs();
        // let charmap = font.charmap();
        // let id = charmap.map('S').unwrap();
        //
        // let size = Size::new(1000.0);
        // let location = LocationRef::default();
        // let settings = DrawSettings::unhinted(size, location);
        // let glyph = glyphs.get(id).unwrap();
        // let mut pen = ShiftPen::new();
        // glyph.draw(settings, &mut pen).unwrap();
        //
        // println!("{:?}", pen.commands());
    }
}
