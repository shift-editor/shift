use crate::{Axis, AxisMapping, NamedInstance, Source, SourceId};

/// An owned snapshot of coupled variation authoring, without glyph geometry.
///
/// Collections retain stable identities and authored order. Sources contain
/// design-space locations and complete source values; instances contain
/// external/user-space locations. This is authoring, not a compiled variation
/// model or an interpolation cache.
///
/// Obtain a snapshot with [`crate::Font::variation_authoring`] and restore a
/// complete target with [`crate::Font::restore_variation_authoring`].
#[derive(Clone, Debug, PartialEq)]
pub struct VariationAuthoring {
    pub axes: Vec<Axis>,
    pub axis_mappings: Vec<AxisMapping>,
    pub sources: Vec<Source>,
    pub default_source_id: Option<SourceId>,
    pub named_instances: Vec<NamedInstance>,
}
