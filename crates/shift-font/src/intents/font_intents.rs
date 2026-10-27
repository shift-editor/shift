//! Intents that act on the font: glyphs, sources, axes, kerning, and layer creation.

use super::*;

/// Creates glyph identity and metadata only. Authored editable data is
/// created by explicit `CreateGlyphLayer` intents.
#[derive(Clone, Debug)]
pub struct CreateGlyph {
    /// Caller-minted id so the verb returns identity synchronously;
    /// `None` mints Rust-side.
    pub glyph_id: Option<GlyphId>,
    pub name: String,
    pub unicodes: Vec<u32>,
}

impl FontLevelIntent for CreateGlyph {
    fn apply(&self, font: &mut Font) -> CoreResult<(Vec<LayerId>, Option<GlyphId>)> {
        let Self {
            glyph_id,
            name,
            unicodes,
        } = self;
        let glyph_id = font.apply_create_glyph(*glyph_id, name, unicodes.clone())?;
        Ok((Vec::new(), Some(glyph_id)))
    }
}

#[derive(Clone, Debug)]
pub struct UpdateGlyph {
    /// Stable id of the existing glyph to rename.
    pub glyph_id: GlyphId,
    pub new_name: GlyphName,
    pub new_unicodes: Vec<u32>,
}

impl FontLevelIntent for UpdateGlyph {
    fn apply(&self, font: &mut Font) -> CoreResult<(Vec<LayerId>, Option<GlyphId>)> {
        let Self {
            glyph_id,
            new_name,
            new_unicodes,
        } = self;
        font.apply_update_glyph(*glyph_id, new_name.clone(), new_unicodes.clone())?;
        Ok((Vec::new(), Some(*glyph_id)))
    }
}

/// Replaces authored font metadata without changing font metrics.
#[derive(Clone, Debug)]
pub struct UpdateFontMetadata {
    pub metadata: FontMetadata,
}

impl FontLevelIntent for UpdateFontMetadata {
    fn apply(&self, font: &mut Font) -> CoreResult<(Vec<LayerId>, Option<GlyphId>)> {
        let Self { metadata } = self;
        font.replace_metadata(metadata.clone());
        Ok((Vec::new(), None))
    }
}

/// Replaces the tracked language list stored under
/// [`LANGUAGES_LIB_KEY`].
///
/// Ids are Hyperglot language ids. Blank ids are dropped and duplicates
/// keep their first position; an empty list is stored as an empty array,
/// which is distinct from the key being absent.
#[derive(Clone, Debug)]
pub struct SetLanguages {
    pub language_ids: Vec<String>,
}

impl FontLevelIntent for SetLanguages {
    fn apply(&self, font: &mut Font) -> CoreResult<(Vec<LayerId>, Option<GlyphId>)> {
        let Self { language_ids } = self;
        font.apply_set_languages(language_ids);
        Ok((Vec::new(), None))
    }
}

#[derive(Clone, Debug)]
pub struct CreateAxis {
    pub axis: Axis,
}

impl FontLevelIntent for CreateAxis {
    fn apply(&self, font: &mut Font) -> CoreResult<(Vec<LayerId>, Option<GlyphId>)> {
        let Self { axis } = self;
        font.apply_create_axis(axis)?;
        Ok((Vec::new(), None))
    }
}

#[derive(Clone, Debug)]
pub struct UpdateAxis {
    pub axis: Axis,
}

impl FontLevelIntent for UpdateAxis {
    fn apply(&self, font: &mut Font) -> CoreResult<(Vec<LayerId>, Option<GlyphId>)> {
        let Self { axis } = self;
        font.apply_update_axis(axis)?;
        Ok((Vec::new(), None))
    }
}

#[derive(Clone, Debug)]
pub struct DeleteAxis {
    pub axis_id: AxisId,
}

impl FontLevelIntent for DeleteAxis {
    fn apply(&self, font: &mut Font) -> CoreResult<(Vec<LayerId>, Option<GlyphId>)> {
        let Self { axis_id } = self;
        font.apply_delete_axis(*axis_id)?;
        Ok((Vec::new(), None))
    }
}

#[derive(Clone, Debug)]
pub struct SetAxisMappings {
    pub mappings: Vec<AxisMapping>,
}

impl FontLevelIntent for SetAxisMappings {
    fn apply(&self, font: &mut Font) -> CoreResult<(Vec<LayerId>, Option<GlyphId>)> {
        let Self { mappings } = self;
        font.set_axis_mappings(mappings.clone())?;
        Ok((Vec::new(), None))
    }
}

#[derive(Clone, Debug)]
pub struct SetMetricDefinitions {
    pub definitions: Vec<MetricDefinition>,
}

impl FontLevelIntent for SetMetricDefinitions {
    fn apply(&self, font: &mut Font) -> CoreResult<(Vec<LayerId>, Option<GlyphId>)> {
        let Self { definitions } = self;
        font.set_metric_definitions(definitions.clone())?;
        Ok((Vec::new(), None))
    }
}

#[derive(Clone, Debug)]
pub struct CreateNamedInstance {
    pub instance: NamedInstance,
}

impl FontLevelIntent for CreateNamedInstance {
    fn apply(&self, font: &mut Font) -> CoreResult<(Vec<LayerId>, Option<GlyphId>)> {
        let Self { instance } = self;
        font.add_named_instance(instance.clone())?;
        Ok((Vec::new(), None))
    }
}

#[derive(Clone, Debug)]
pub struct UpdateNamedInstance {
    pub instance: NamedInstance,
}

impl FontLevelIntent for UpdateNamedInstance {
    fn apply(&self, font: &mut Font) -> CoreResult<(Vec<LayerId>, Option<GlyphId>)> {
        let Self { instance } = self;
        font.replace_named_instance(instance.clone())?;
        Ok((Vec::new(), None))
    }
}

#[derive(Clone, Debug)]
pub struct DeleteNamedInstance {
    pub instance_id: NamedInstanceId,
}

impl FontLevelIntent for DeleteNamedInstance {
    fn apply(&self, font: &mut Font) -> CoreResult<(Vec<LayerId>, Option<GlyphId>)> {
        let Self { instance_id } = self;
        font.remove_named_instance(*instance_id)?;
        Ok((Vec::new(), None))
    }
}

#[derive(Clone, Debug)]
pub struct DeleteSource {
    pub source_id: SourceId,
}

impl FontLevelIntent for DeleteSource {
    fn required_layer_ids(&self, font: &Font) -> Vec<LayerId> {
        font.glyphs()
            .filter_map(|glyph| glyph.layer_for_source(self.source_id).map(GlyphLayer::id))
            .collect()
    }

    fn apply(&self, font: &mut Font) -> CoreResult<(Vec<LayerId>, Option<GlyphId>)> {
        let Self { source_id } = self;
        let layer_ids = font.apply_delete_source(*source_id)?;
        Ok((layer_ids, None))
    }
}

/// Creates a global source record only. Glyph layers are authored by
/// explicit `CreateGlyphLayer` intents.
#[derive(Clone, Debug)]
pub struct CreateSource {
    pub source_id: SourceId,
    pub name: String,
    pub location: DesignLocation,
}

impl FontLevelIntent for CreateSource {
    fn apply(&self, font: &mut Font) -> CoreResult<(Vec<LayerId>, Option<GlyphId>)> {
        let Self {
            source_id,
            name,
            location,
        } = self;
        font.apply_create_source(*source_id, name, location)?;
        Ok((Vec::new(), None))
    }
}

/// Replaces the editable authoring values of an existing master source.
#[derive(Clone, Debug)]
pub struct UpdateSource {
    pub source_id: SourceId,
    pub name: String,
    pub location: DesignLocation,
    pub metric_values: BTreeMap<MetricId, MetricValue>,
    pub italic_angle: Option<f64>,
    pub line_gap: Option<f64>,
    pub underline_position: Option<f64>,
    pub underline_thickness: Option<f64>,
}

impl FontLevelIntent for UpdateSource {
    fn apply(&self, font: &mut Font) -> CoreResult<(Vec<LayerId>, Option<GlyphId>)> {
        let mut source = font.require_source(self.source_id)?.clone();
        source.set_name(self.name.trim().to_string());
        source.set_location(self.location.clone());
        source.set_metric_values(self.metric_values.clone());
        source.set_italic_angle(self.italic_angle);
        source.set_line_gap(self.line_gap);
        source.set_underline_position(self.underline_position);
        source.set_underline_thickness(self.underline_thickness);
        font.replace_source(source)?;
        Ok((Vec::new(), None))
    }
}

/// Creates one sparse editable glyph layer at one source.
#[derive(Clone, Debug)]
pub struct CreateGlyphLayer {
    pub layer_id: LayerId,
    pub glyph_id: GlyphId,
    pub source_id: SourceId,
}

impl FontLevelIntent for CreateGlyphLayer {
    fn apply(&self, font: &mut Font) -> CoreResult<(Vec<LayerId>, Option<GlyphId>)> {
        let Self {
            layer_id,
            glyph_id,
            source_id,
        } = self;
        let layer_ids = font.apply_create_glyph_layer(*layer_id, *glyph_id, *source_id)?;
        Ok((layer_ids, None))
    }
}

/// Creates one editable glyph layer by copying another layer's shape with fresh internal ids.
#[derive(Clone, Debug)]
pub struct CloneGlyphLayer {
    pub layer_id: LayerId,
    pub glyph_id: GlyphId,
    pub source_id: SourceId,
    pub from_layer_id: LayerId,
}

impl FontLevelIntent for CloneGlyphLayer {
    fn required_layer_ids(&self, _font: &Font) -> Vec<LayerId> {
        vec![self.from_layer_id]
    }

    fn apply(&self, font: &mut Font) -> CoreResult<(Vec<LayerId>, Option<GlyphId>)> {
        let Self {
            layer_id,
            glyph_id,
            source_id,
            from_layer_id,
        } = self;
        let layer_ids =
            font.apply_clone_glyph_layer(*layer_id, *glyph_id, *source_id, *from_layer_id)?;
        Ok((layer_ids, None))
    }
}

/// Sets or removes kerning pair values at sources, in order.
///
/// Every source, glyph side, and group side must exist; groups are
/// created separately. Editing a value never changes group membership.
#[derive(Clone, Debug)]
pub struct SetKerningValues {
    pub edits: Vec<KerningValueEdit>,
}

impl FontLevelIntent for SetKerningValues {
    fn apply(&self, font: &mut Font) -> CoreResult<(Vec<LayerId>, Option<GlyphId>)> {
        let Self { edits } = self;
        font.apply_set_kerning_values(edits)?;
        Ok((Vec::new(), None))
    }
}

/// Creates an empty kerning group at a pair position, under an id the
/// caller mints. The name is trimmed, and must be non-blank, free of
/// control characters, and unique at its position.
#[derive(Clone, Debug)]
pub struct CreateKerningGroup {
    pub group_id: KerningGroupId,
    pub position: KerningPosition,
    pub name: String,
}

impl FontLevelIntent for CreateKerningGroup {
    fn edits_kerning_groups(&self) -> bool {
        true
    }

    fn apply(&self, font: &mut Font) -> CoreResult<(Vec<LayerId>, Option<GlyphId>)> {
        let Self {
            group_id,
            position,
            name,
        } = self;
        if font.kerning().group(*group_id).is_some() {
            return Err(CoreError::DuplicateKerningGroup(*group_id));
        }
        let name = kerning_group_name(name)?;
        font.kerning_mut()
            .set_group(*group_id, KerningGroup::new(*position, name, Vec::new()))?;
        Ok((Vec::new(), None))
    }
}

/// Moves a glyph into a group at the group's pair position, out of any
/// other group there, or out of its group at `position` with `None`.
#[derive(Clone, Debug)]
pub struct SetKerningGroupMember {
    pub position: KerningPosition,
    pub glyph_id: GlyphId,
    pub group_id: Option<KerningGroupId>,
}

impl FontLevelIntent for SetKerningGroupMember {
    fn edits_kerning_groups(&self) -> bool {
        true
    }

    fn apply(&self, font: &mut Font) -> CoreResult<(Vec<LayerId>, Option<GlyphId>)> {
        let Self {
            position,
            glyph_id,
            group_id,
        } = self;
        font.apply_set_kerning_group_member(*position, *glyph_id, group_id.as_ref())?;
        Ok((Vec::new(), None))
    }
}

/// Renames a group. Pairs reference it by id, so its kerning is unchanged.
#[derive(Clone, Debug)]
pub struct RenameKerningGroup {
    pub group_id: KerningGroupId,
    pub name: String,
}

impl FontLevelIntent for RenameKerningGroup {
    fn edits_kerning_groups(&self) -> bool {
        true
    }

    fn apply(&self, font: &mut Font) -> CoreResult<(Vec<LayerId>, Option<GlyphId>)> {
        let Self { group_id, name } = self;
        let name = kerning_group_name(name)?;
        font.kerning_mut().rename_group(*group_id, name)?;
        Ok((Vec::new(), None))
    }
}

/// Deletes a group. Pairs that reference it are kept and never resolve,
/// so undoing the delete restores its kerning.
#[derive(Clone, Debug)]
pub struct DeleteKerningGroup {
    pub group_id: KerningGroupId,
}

impl FontLevelIntent for DeleteKerningGroup {
    fn edits_kerning_groups(&self) -> bool {
        true
    }

    fn apply(&self, font: &mut Font) -> CoreResult<(Vec<LayerId>, Option<GlyphId>)> {
        let Self { group_id } = self;
        font.kerning().group(*group_id).require(group_id)?;
        font.kerning_mut().remove_group(*group_id);
        Ok((Vec::new(), None))
    }
}

/// Creates one editable layer from compatible resolved numeric values.
///
/// The source layer supplies authored structure and non-varying data. The
/// resolved values replace its advance, coordinates, and component
/// transforms after fresh internal identities are minted.
#[derive(Clone, Debug)]
pub struct MaterializeGlyphLayer {
    pub layer_id: LayerId,
    pub glyph_id: GlyphId,
    pub source_id: SourceId,
    pub from_layer_id: LayerId,
    pub values: GlyphInterpolationValues,
}

impl FontLevelIntent for MaterializeGlyphLayer {
    fn required_layer_ids(&self, _font: &Font) -> Vec<LayerId> {
        vec![self.from_layer_id]
    }

    fn apply(&self, font: &mut Font) -> CoreResult<(Vec<LayerId>, Option<GlyphId>)> {
        let Self {
            layer_id,
            glyph_id,
            source_id,
            from_layer_id,
            values,
        } = self;
        let layer_ids = font.apply_materialize_glyph_layer(
            *layer_id,
            *glyph_id,
            *source_id,
            *from_layer_id,
            values,
        )?;
        Ok((layer_ids, None))
    }
}
