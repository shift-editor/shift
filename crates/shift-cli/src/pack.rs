//! A font packed as the SDK's memory sessions open it.

use miette::{IntoDiagnostic, WrapErr, miette};
use shift_backends::font_loader::FontLoader;
use shift_font::GlyphId;

use crate::cli::PackFontArgs;

/// Reads the font at `args.path`, keeps the glyphs `args.glyphs` names and
/// the glyphs their components use (every glyph when it names none), and
/// writes it to `args.output` as named MessagePack, every layer included:
/// what `createMemoryFontSession` takes as its source's `font`.
///
/// # Errors
///
/// Fails when the font cannot be read, names no glyph called one of
/// `args.glyphs`, or the packed font cannot be written.
pub(crate) fn pack_font(args: &PackFontArgs) -> miette::Result<()> {
    let path = args.path.to_string_lossy();
    let mut font = FontLoader::new()
        .read_font(&path)
        .into_diagnostic()
        .wrap_err_with(|| format!("cannot read {path}"))?;
    if !args.glyphs.is_empty() {
        let kept = args
            .glyphs
            .iter()
            .map(|name| {
                font.glyph_id_by_name(name)
                    .ok_or_else(|| miette!("the font has no glyph named {name}"))
            })
            .collect::<miette::Result<Vec<GlyphId>>>()?;
        font = font.subset(kept).into_diagnostic()?;
    }
    let bytes = rmp_serde::to_vec_named(&font).into_diagnostic()?;
    std::fs::write(&args.output, bytes)
        .into_diagnostic()
        .wrap_err_with(|| format!("cannot write {}", args.output.display()))
}

#[cfg(test)]
mod tests {
    use std::path::PathBuf;

    use shift_font::Glyph;
    use shift_font::test_support::fixtures;

    use shift_font::Font;

    use super::*;

    fn pack(path: PathBuf, glyphs: &[&str]) -> Font {
        let output = tempfile::NamedTempFile::new().unwrap();
        pack_font(&PackFontArgs {
            path,
            glyphs: glyphs.iter().map(ToString::to_string).collect(),
            output: output.path().to_path_buf(),
        })
        .unwrap();
        rmp_serde::from_slice(&std::fs::read(output.path()).unwrap()).unwrap()
    }

    #[test]
    fn packs_the_glyphs_asked_for_with_every_master_layer() {
        let path = fixtures::mutatorsans_designspace();
        let source = FontLoader::new().read_font(path.to_str().unwrap()).unwrap();

        let packed = pack(path, &["A"]);

        let names: Vec<&str> = packed.glyphs().map(Glyph::name).collect();
        assert_eq!(names, ["A"]);
        let glyph_id = packed.glyph_id_by_name("A").unwrap();
        assert_eq!(packed.glyph(glyph_id), source.glyph(glyph_id));
        assert_eq!(packed.sources(), source.sources());
        assert_eq!(packed.axes(), source.axes());
    }

    #[test]
    fn refuses_a_glyph_the_font_lacks() {
        let output = tempfile::NamedTempFile::new().unwrap();
        let error = pack_font(&PackFontArgs {
            path: fixtures::mutatorsans_designspace(),
            glyphs: vec!["nothing".into()],
            output: output.path().to_path_buf(),
        })
        .unwrap_err();

        assert!(error.to_string().contains("no glyph named nothing"));
    }
}
