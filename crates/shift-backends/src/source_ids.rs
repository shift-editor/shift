use std::path::Path;

use shift_font::{
    AxisId, AxisLabelId, AxisMappingId, CoreResult, Font, GlyphId, KerningGroupId, KerningPosition,
    LayerId, NamedInstanceId, SourceId,
};

/// Mints the ids of everything one font source names (glyphs, layers,
/// sources, axes and their labels, axis mappings, named instances and
/// kerning groups) identically for every reader of that source and on every
/// run.
///
/// A preview and the import that converts it into a document both derive
/// ids here, so the document holds every item under the id the preview gave
/// it. Entities inside a layer derive theirs from
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

    /// The id of the kerning group named `name` at `position`.
    pub fn kerning_group_id(&self, position: KerningPosition, name: &str) -> KerningGroupId {
        KerningGroupId::derived(&self.source_key, &format!("{position:?}\0{name}"))
    }

    /// Gives `font`'s axis mappings, named instances and axis labels the ids
    /// their places derive: a mapping or instance by its position in the
    /// font's list, a label by its axis's tag and its position on the axis.
    /// Nothing in a font refers to these ids, so they can be given after the
    /// header is built.
    ///
    /// # Errors
    ///
    /// Returns the font's error when it refuses the re-identified items.
    pub(crate) fn identify(&self, font: &mut Font) -> CoreResult<()> {
        let mappings = font.axis_mappings().iter().enumerate();
        let mappings = mappings
            .map(|(index, mapping)| {
                let id = AxisMappingId::derived(&self.source_key, &index.to_string());
                mapping.clone().identified_as(id)
            })
            .collect();
        font.set_axis_mappings(mappings)?;
        let instances = font.named_instances().iter().enumerate();
        let instances = instances
            .map(|(index, instance)| {
                let id = NamedInstanceId::derived(&self.source_key, &index.to_string());
                instance.clone().identified_as(id)
            })
            .collect();
        font.set_named_instances(instances)?;
        for mut axis in font.axes().to_vec() {
            let labels = axis.labels().iter().enumerate();
            let labels = labels
                .map(|(index, label)| {
                    let key = format!("{}\0{index}", axis.tag());
                    label
                        .clone()
                        .identified_as(AxisLabelId::derived(&self.source_key, &key))
                })
                .collect();
            axis.set_labels(labels);
            font.replace_axis(axis)?;
        }
        Ok(())
    }
}
