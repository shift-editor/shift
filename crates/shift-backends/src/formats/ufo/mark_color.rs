//! A glyph's mark colour in GLIF libs, under the UFO name `public.markColor`.
//!
//! A UFO keeps the colour per layer; Shift keeps one per glyph. Every layer's
//! entry stays in that layer's lib as it was read, and the glyph's colour is
//! the one its first GLIF holds: the default layer's, when the glyph is in
//! it. Until the glyph's colour is changed in Shift, saving writes the layer
//! libs back as they are, so layers that disagree still do. Once it differs
//! from what that first layer holds, it is the colour of the whole glyph,
//! and every layer's GLIF gets it, or loses its entry when the glyph has
//! none.

use shift_font::{Glyph, GlyphLayer, LibValue, MarkColor, Rgba, Source, SourceId};

const ENTRY: &str = "public.markColor";

/// The colour `text` names, as the named colour with that value when there
/// is one. `None` for text that is not four channels from 0 to 1: such an
/// entry stays in its lib as ordinary data.
fn parse(text: &str) -> Option<MarkColor> {
    text.parse::<Rgba>().ok().map(MarkColor::from)
}

/// Removes the mark colour entry from `lib`, a glyph's copy of its first
/// GLIF's lib, and returns the colour it held. An entry that is not a colour
/// is left in place.
pub(crate) fn take_mark_color(lib: &mut plist::Dictionary) -> Option<MarkColor> {
    let color = parse(lib.get(ENTRY)?.as_string()?)?;
    lib.remove(ENTRY);
    Some(color)
}

/// The colour `layer`'s lib holds, as its GLIF gave it.
fn layer_mark_color(layer: &GlyphLayer) -> Option<MarkColor> {
    match layer.lib().get(ENTRY)? {
        LibValue::String(text) => parse(text),
        _ => None,
    }
}

/// What saving writes for a glyph's mark colour in each of its GLIFs.
#[derive(Clone, Copy, Debug, PartialEq)]
pub(crate) enum MarkColorWrite {
    /// The glyph's colour is still the one it was read with: each layer
    /// keeps the entry its own lib has, or has none.
    AsRead,
    /// The glyph's colour was set since: every layer gets it, and `None`
    /// removes the entry from every layer.
    Glyph(Option<MarkColor>),
}

impl MarkColorWrite {
    /// What to write for `glyph`: its layer libs as read while its colour
    /// matches its first layer's, the default source's or else the first of
    /// `sources` it has a layer on; otherwise its own colour everywhere.
    pub(crate) fn of(
        glyph: &Glyph,
        default_source_id: Option<SourceId>,
        sources: &[Source],
    ) -> Self {
        let first_layer = default_source_id
            .into_iter()
            .chain(sources.iter().map(Source::id))
            .find_map(|source_id| glyph.layer_for_source(source_id));
        let as_read = first_layer.and_then(layer_mark_color);
        let color = glyph.mark_color();
        if color.map(MarkColor::rgba) == as_read.map(MarkColor::rgba) {
            return Self::AsRead;
        }
        Self::Glyph(color)
    }

    /// Applies this to `lib`, a GLIF lib already holding its layer's entries.
    pub(crate) fn write(self, lib: &mut plist::Dictionary) {
        match self {
            Self::AsRead => {}
            Self::Glyph(None) => {
                lib.remove(ENTRY);
            }
            Self::Glyph(Some(color)) => {
                lib.insert(
                    ENTRY.to_owned(),
                    plist::Value::String(color.rgba().to_string()),
                );
            }
        }
    }
}
