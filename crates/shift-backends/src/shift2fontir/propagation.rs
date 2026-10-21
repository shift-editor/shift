use fontdrasil::orchestration::Access;
use fontir::error::Error;
use fontir::orchestration::{Context, Flags, WorkId};
use fontir::propagate_anchors::propagate_all_anchors;
use fontir::source::Source;
use shift_font::SourceId;

use super::source::ShiftIrSource;

/// One glyph's anchors as export compiles them, at each master source it has a layer for.
#[derive(Clone, Debug, PartialEq)]
pub struct PropagatedGlyphAnchors {
    pub glyph_name: String,
    pub sources: Vec<PropagatedSourceAnchors>,
}

/// A glyph's anchors at one master source, in the compiler's order.
#[derive(Clone, Debug, PartialEq)]
pub struct PropagatedSourceAnchors {
    pub source_id: SourceId,
    pub anchors: Vec<PropagatedAnchor>,
}

#[derive(Clone, Debug, PartialEq)]
pub struct PropagatedAnchor {
    pub name: String,
    pub x: f64,
    pub y: f64,
}

impl ShiftIrSource {
    /// Runs fontc's glyph work and anchor propagation, and reads back every glyph's anchors.
    ///
    /// # Errors
    ///
    /// Returns the compiler's error when a glyph or its anchors cannot be built.
    pub(crate) fn propagated_anchors(&self) -> Result<Vec<PropagatedGlyphAnchors>, Error> {
        let context =
            Context::new_root(self.compilation_flags()).copy_for_work(Access::All, Access::All);
        self.create_static_metadata_work()?.exec(&context)?;
        for work in self.create_glyph_ir_work()? {
            work.exec(&context)?;
        }
        if context.flags.contains(Flags::PROPAGATE_ANCHORS) {
            propagate_all_anchors(&context)?;
        }

        let snapshot = self.snapshot();
        let metadata = context.static_metadata.get();
        let masters = snapshot.glyph_masters(&metadata)?;

        Ok(snapshot
            .glyphs
            .iter()
            .map(|glyph| {
                let anchors = context
                    .anchors
                    .try_get(&WorkId::Anchor(glyph.name().into()));
                let sources = masters
                    .iter()
                    .filter(|(source, _)| glyph.layer_for_source(&source.id()).is_some())
                    .map(|(source, location)| PropagatedSourceAnchors {
                        source_id: source.id(),
                        anchors: anchors
                            .iter()
                            .flat_map(|anchors| anchors.anchors.iter())
                            .filter_map(|anchor| {
                                let position = anchor.positions.get(location)?;
                                Some(PropagatedAnchor {
                                    name: anchor.original_name.to_string(),
                                    x: position.x,
                                    y: position.y,
                                })
                            })
                            .collect(),
                    })
                    .collect();
                PropagatedGlyphAnchors {
                    glyph_name: glyph.name().to_string(),
                    sources,
                }
            })
            .collect())
    }
}
