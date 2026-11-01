use std::path::Path;

use shift_font::{AxisId, GlyphId, LayerId, SourceId};

/// Mints the ids of one font source's glyphs, layers, sources and axes,
/// identically for every reader of that source and on every run.
///
/// A preview and the import that converts it into a document both derive
/// ids here, so the document holds every glyph, layer, source and axis under
/// the id the preview gave it. Entities inside a layer derive theirs from
/// the layer's id ([`shift_font::GlyphLayer::with_derived_entity_ids`]).
/// Ids minted while editing are random as usual.
#[derive(Clone, Debug)]
pub struct SourceIds {
    source_key: String,
}

impl SourceIds {
    /// Keys ids by the source's canonical path, or by `path` itself when it cannot be resolved.
    pub fn for_path(path: &Path) -> Self {
        let canonical = std::fs::canonicalize(path).unwrap_or_else(|_| path.to_path_buf());
        Self {
            source_key: canonical.to_string_lossy().into_owned(),
        }
    }

    /// Returns the ID of the source glyph named `name`.
    pub fn glyph_id(&self, name: &str) -> GlyphId {
        GlyphId::from_source(&self.source_key, name)
    }

    /// The id of the glyph named `glyph`'s layer at `place`, where the
    /// format keeps it: unique among that glyph's layers, such as a UFO
    /// layer's position or a Glyphs layer's own id.
    pub fn layer_id(&self, glyph: &str, place: &str) -> LayerId {
        LayerId::derived(&self.source_key, &format!("{glyph}\0{place}"))
    }

    /// The id of the source at `place`, unique among the font's sources,
    /// such as a designspace source's position or a Glyphs master's id.
    pub fn source_id(&self, place: &str) -> SourceId {
        SourceId::derived(&self.source_key, place)
    }

    /// The id of the axis tagged `tag`, unique in a font.
    pub fn axis_id(&self, tag: &str) -> AxisId {
        AxisId::derived(&self.source_key, tag)
    }
}
