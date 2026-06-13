use crate::axis::{Axis, Location};
use crate::entity::{AxisId, GlyphId, LayerId, SourceId};
use crate::error::{CoreError, CoreResult};
use crate::features::FeatureData;
use crate::glyph::{Glyph, GlyphLayer};
use crate::guideline::Guideline;
use crate::kerning::KerningData;
use crate::lib_data::LibData;
use crate::metrics::FontMetrics;
use crate::source::Source;
use crate::GlyphName;
use indexmap::IndexMap;
use serde::{Deserialize, Deserializer, Serialize, Serializer};
use std::collections::{HashMap, HashSet};
use std::sync::Arc;

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FontMetadata {
    pub family_name: Option<String>,
    pub style_name: Option<String>,
    pub version_major: Option<i32>,
    pub version_minor: Option<i32>,
    pub copyright: Option<String>,
    pub trademark: Option<String>,
    pub designer: Option<String>,
    pub designer_url: Option<String>,
    pub manufacturer: Option<String>,
    pub manufacturer_url: Option<String>,
    pub license: Option<String>,
    pub license_url: Option<String>,
    pub description: Option<String>,
    pub note: Option<String>,
}

impl Default for FontMetadata {
    fn default() -> Self {
        Self {
            family_name: Some("Untitled Font".to_string()),
            style_name: Some("Regular".to_string()),
            version_major: Some(1),
            version_minor: Some(0),
            copyright: None,
            trademark: None,
            designer: None,
            designer_url: None,
            manufacturer: None,
            manufacturer_url: None,
            license: None,
            license_url: None,
            description: None,
            note: None,
        }
    }
}

impl FontMetadata {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn with_names(family_name: String, style_name: String) -> Self {
        Self {
            family_name: Some(family_name),
            style_name: Some(style_name),
            ..Self::default()
        }
    }

    pub fn display_name(&self) -> String {
        match (&self.family_name, &self.style_name) {
            (Some(family), Some(style)) => format!("{family} {style}"),
            (Some(family), None) => family.clone(),
            (None, Some(style)) => style.clone(),
            (None, None) => "Untitled".to_string(),
        }
    }
}

#[derive(Clone, Debug)]
pub struct Font {
    state: Arc<FontState>,
}

#[derive(Clone, Debug)]
struct FontState {
    data: FontData,
    index: FontIndex,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
struct FontData {
    metadata: FontMetadata,
    metrics: FontMetrics,
    axes: Vec<Axis>,
    sources: Vec<Source>,
    #[serde(default)]
    default_source_id: Option<SourceId>,
    glyphs: IndexMap<GlyphId, Arc<Glyph>>,
    kerning: KerningData,
    features: FeatureData,
    guidelines: Vec<Guideline>,
    lib: LibData,
}

#[derive(Clone, Debug, Default)]
struct FontIndex {
    glyph_by_name: HashMap<GlyphName, GlyphId>,
    layer_owner: HashMap<LayerId, GlyphId>,
    layer_by_glyph_source: HashMap<(GlyphId, SourceId), LayerId>,
    glyphs_by_unicode: HashMap<u32, Vec<GlyphId>>,
}

impl FontIndex {
    fn from_glyphs(glyphs: &IndexMap<GlyphId, Arc<Glyph>>) -> CoreResult<Self> {
        let mut index = Self::default();

        for (glyph_id, glyph) in glyphs {
            if *glyph_id != glyph.id() {
                return Err(CoreError::MismatchedGlyphId {
                    key: glyph_id.clone(),
                    glyph_id: glyph.id(),
                });
            }

            if index
                .glyph_by_name
                .insert(glyph.glyph_name().clone(), glyph_id.clone())
                .is_some()
            {
                return Err(CoreError::DuplicateGlyphName(glyph.glyph_name().clone()));
            }

            for unicode in glyph.unicodes() {
                index
                    .glyphs_by_unicode
                    .entry(*unicode)
                    .or_default()
                    .push(glyph_id.clone());
            }

            for layer in glyph.layers().values().map(Arc::as_ref) {
                if index
                    .layer_owner
                    .insert(layer.id(), glyph_id.clone())
                    .is_some()
                {
                    return Err(CoreError::DuplicateLayerId(layer.id()));
                }

                if index
                    .layer_by_glyph_source
                    .insert((glyph_id.clone(), layer.source_id()), layer.id())
                    .is_some()
                {
                    return Err(CoreError::DuplicateGlyphLayer {
                        glyph_id: glyph_id.clone(),
                        source_id: layer.source_id(),
                    });
                }
            }
        }

        Ok(index)
    }

    fn validate_glyph_insert(&self, glyph_id: GlyphId, glyph: &Glyph) -> CoreResult<()> {
        if glyph_id != glyph.id() {
            return Err(CoreError::MismatchedGlyphId {
                key: glyph_id,
                glyph_id: glyph.id(),
            });
        }

        if self.glyph_by_name.contains_key(glyph.glyph_name()) {
            return Err(CoreError::DuplicateGlyphName(glyph.glyph_name().clone()));
        }

        let mut local_sources = HashSet::new();
        for layer in glyph.layers().values().map(Arc::as_ref) {
            if self.layer_owner.contains_key(&layer.id()) {
                return Err(CoreError::DuplicateLayerId(layer.id()));
            }

            if self
                .layer_by_glyph_source
                .contains_key(&(glyph_id.clone(), layer.source_id()))
                || !local_sources.insert(layer.source_id())
            {
                return Err(CoreError::DuplicateGlyphLayer {
                    glyph_id: glyph_id.clone(),
                    source_id: layer.source_id(),
                });
            }
        }

        Ok(())
    }

    fn insert_glyph(&mut self, glyph_id: GlyphId, glyph: &Glyph) {
        self.glyph_by_name
            .insert(glyph.glyph_name().clone(), glyph_id.clone());

        for unicode in glyph.unicodes() {
            self.glyphs_by_unicode
                .entry(*unicode)
                .or_default()
                .push(glyph_id.clone());
        }

        for layer in glyph.layers().values().map(Arc::as_ref) {
            self.layer_owner.insert(layer.id(), glyph_id.clone());
            self.layer_by_glyph_source
                .insert((glyph_id.clone(), layer.source_id()), layer.id());
        }
    }

    fn remove_glyph(&mut self, glyph_id: GlyphId, glyph: &Glyph) {
        self.glyph_by_name.remove(glyph.glyph_name());

        for unicode in glyph.unicodes() {
            if let Some(glyph_ids) = self.glyphs_by_unicode.get_mut(unicode) {
                glyph_ids.retain(|id| *id != glyph_id);
                if glyph_ids.is_empty() {
                    self.glyphs_by_unicode.remove(unicode);
                }
            }
        }

        for layer in glyph.layers().values().map(Arc::as_ref) {
            self.layer_owner.remove(&layer.id());
            self.layer_by_glyph_source
                .remove(&(glyph_id.clone(), layer.source_id()));
        }
    }
}

impl FontState {
    fn from_data(data: FontData) -> CoreResult<Self> {
        let index = FontIndex::from_glyphs(&data.glyphs)?;
        Ok(Self { data, index })
    }

    fn rebuild_index(&mut self) -> CoreResult<()> {
        self.index = FontIndex::from_glyphs(&self.data.glyphs)?;
        Ok(())
    }
}

impl Serialize for Font {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        self.data().serialize(serializer)
    }
}

impl<'de> Deserialize<'de> for Font {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        let data = FontData::deserialize(deserializer)?;
        let state = FontState::from_data(data).map_err(serde::de::Error::custom)?;
        Ok(Self {
            state: Arc::new(state),
        })
    }
}

impl Default for Font {
    fn default() -> Self {
        let default_source = Source::new("Regular".to_string(), Location::new());
        let default_source_id = default_source.id();

        Self {
            state: Arc::new(FontState {
                data: FontData {
                    metadata: FontMetadata::default(),
                    metrics: FontMetrics::default(),
                    axes: Vec::new(),
                    sources: vec![default_source],
                    default_source_id: Some(default_source_id),
                    glyphs: IndexMap::new(),
                    kerning: KerningData::new(),
                    features: FeatureData::new(),
                    guidelines: Vec::new(),
                    lib: LibData::new(),
                },
                index: FontIndex::default(),
            }),
        }
    }
}

impl Font {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn empty() -> Self {
        Self {
            state: Arc::new(FontState {
                data: FontData {
                    metadata: FontMetadata::default(),
                    metrics: FontMetrics::default(),
                    axes: Vec::new(),
                    sources: Vec::new(),
                    default_source_id: None,
                    glyphs: IndexMap::new(),
                    kerning: KerningData::new(),
                    features: FeatureData::new(),
                    guidelines: Vec::new(),
                    lib: LibData::new(),
                },
                index: FontIndex::default(),
            }),
        }
    }

    fn data(&self) -> &FontData {
        &self.state.data
    }

    fn data_mut(&mut self) -> &mut FontData {
        &mut Arc::make_mut(&mut self.state).data
    }

    fn index(&self) -> &FontIndex {
        &self.state.index
    }

    fn state_mut(&mut self) -> &mut FontState {
        Arc::make_mut(&mut self.state)
    }

    pub fn metadata(&self) -> &FontMetadata {
        &self.data().metadata
    }

    pub fn metadata_mut(&mut self) -> &mut FontMetadata {
        &mut self.data_mut().metadata
    }

    pub fn metrics(&self) -> &FontMetrics {
        &self.data().metrics
    }

    pub fn metrics_mut(&mut self) -> &mut FontMetrics {
        &mut self.data_mut().metrics
    }

    pub fn axes(&self) -> &[Axis] {
        &self.data().axes
    }

    pub fn add_axis(&mut self, axis: Axis) {
        self.data_mut().axes.push(axis);
    }

    pub fn remove_axis(&mut self, axis_id: AxisId) -> Option<Axis> {
        let data = self.data_mut();
        let index = data.axes.iter().position(|axis| axis.id() == axis_id)?;
        Some(data.axes.remove(index))
    }

    pub fn axis(&self, axis_id: AxisId) -> Option<&Axis> {
        self.data().axes.iter().find(|axis| axis.id() == axis_id)
    }

    pub fn axis_id_by_tag(&self, tag: &str) -> Option<AxisId> {
        self.data()
            .axes
            .iter()
            .find(|axis| axis.tag() == tag)
            .map(Axis::id)
    }

    pub fn sources(&self) -> &[Source] {
        &self.data().sources
    }

    pub fn add_source(&mut self, source: Source) -> SourceId {
        let source_id = source.id();
        let data = self.data_mut();
        if data.default_source_id.is_none() {
            data.default_source_id = Some(source_id.clone());
        }
        data.sources.push(source);
        source_id
    }

    /// Removes a source record only; the caller removes the source's glyph
    /// layers first so the layer index never points at a missing source.
    pub fn remove_source(&mut self, source_id: SourceId) -> Option<Source> {
        let data = self.data_mut();
        let index = data
            .sources
            .iter()
            .position(|source| source.id() == source_id)?;
        let source = data.sources.remove(index);

        if data.default_source_id == Some(source_id) {
            data.default_source_id = data.sources.first().map(Source::id);
        }

        Some(source)
    }

    pub fn clear_sources(&mut self) {
        let data = self.data_mut();
        data.sources.clear();
        data.default_source_id = None;
    }

    pub fn default_source_id(&self) -> Option<SourceId> {
        self.data().default_source_id.clone()
    }

    pub fn set_default_source_id(&mut self, source_id: SourceId) {
        self.data_mut().default_source_id = Some(source_id);
    }

    pub fn default_source(&self) -> Option<&Source> {
        let default_source_id = self.data().default_source_id.clone()?;
        self.data()
            .sources
            .iter()
            .find(|source| source.id() == default_source_id)
    }

    pub fn is_variable(&self) -> bool {
        !self.data().axes.is_empty()
    }

    pub fn glyphs(&self) -> impl Iterator<Item = &Glyph> {
        self.data().glyphs.values().map(Arc::as_ref)
    }

    pub fn glyph(&self, glyph_id: GlyphId) -> Option<&Glyph> {
        self.data().glyphs.get(&glyph_id).map(Arc::as_ref)
    }

    pub fn glyph_id_by_name(&self, name: &str) -> Option<GlyphId> {
        self.index().glyph_by_name.get(name).cloned()
    }

    pub fn glyph_by_name(&self, name: &str) -> Option<&Glyph> {
        self.glyph(self.glyph_id_by_name(name)?)
    }

    pub fn glyphs_by_unicode(&self, unicode: u32) -> impl Iterator<Item = &Glyph> {
        self.index()
            .glyphs_by_unicode
            .get(&unicode)
            .into_iter()
            .flatten()
            .filter_map(|glyph_id| self.glyph(glyph_id.clone()))
    }

    pub fn glyph_id_by_layer(&self, layer_id: LayerId) -> Option<GlyphId> {
        self.index().layer_owner.get(&layer_id).cloned()
    }

    pub fn layer_id_for_glyph_source(
        &self,
        glyph_id: GlyphId,
        source_id: SourceId,
    ) -> Option<LayerId> {
        self.index()
            .layer_by_glyph_source
            .get(&(glyph_id, source_id))
            .cloned()
    }

    pub fn layer(&self, layer_id: LayerId) -> Option<&GlyphLayer> {
        let glyph_id = self.glyph_id_by_layer(layer_id.clone())?;
        self.glyph(glyph_id)?.layer(layer_id)
    }

    pub fn layer_mut(&mut self, layer_id: LayerId) -> Option<&mut GlyphLayer> {
        let glyph_id = self.glyph_id_by_layer(layer_id.clone())?;
        self.data_mut()
            .glyphs
            .get_mut(&glyph_id)
            .and_then(|glyph| Arc::make_mut(glyph).layer_mut(layer_id))
    }

    pub fn insert_glyph(&mut self, glyph: Glyph) -> CoreResult<GlyphId> {
        let glyph_id = glyph.id();
        if self.data().glyphs.contains_key(&glyph_id) {
            return Err(CoreError::DuplicateGlyphId(glyph_id));
        }
        self.index()
            .validate_glyph_insert(glyph_id.clone(), &glyph)?;

        let state = self.state_mut();
        state.index.insert_glyph(glyph_id.clone(), &glyph);
        state.data.glyphs.insert(glyph_id.clone(), Arc::new(glyph));
        Ok(glyph_id)
    }

    pub fn remove_glyph(&mut self, glyph_id: GlyphId) -> Option<Glyph> {
        let state = self.state_mut();
        let glyph = state
            .data
            .glyphs
            .shift_remove(&glyph_id)
            .map(Arc::unwrap_or_clone)?;
        state.index.remove_glyph(glyph_id, &glyph);
        Some(glyph)
    }

    pub fn glyph_count(&self) -> usize {
        self.data().glyphs.len()
    }

    pub fn rename_glyph(&mut self, glyph_id: GlyphId, name: GlyphName) -> CoreResult<()> {
        let mut state = (*self.state).clone();
        let glyph = state
            .data
            .glyphs
            .get_mut(&glyph_id)
            .ok_or(CoreError::GlyphNotFound(glyph_id))?;
        Arc::make_mut(glyph).set_name(name);
        state.rebuild_index()?;
        self.state = Arc::new(state);
        Ok(())
    }

    pub fn set_glyph_unicodes(&mut self, glyph_id: GlyphId, unicodes: Vec<u32>) -> CoreResult<()> {
        let mut state = (*self.state).clone();
        let glyph = state
            .data
            .glyphs
            .get_mut(&glyph_id)
            .ok_or(CoreError::GlyphNotFound(glyph_id))?;
        Arc::make_mut(glyph).set_unicodes(unicodes);
        state.rebuild_index()?;
        self.state = Arc::new(state);
        Ok(())
    }

    pub fn create_glyph_layer(
        &mut self,
        glyph_id: GlyphId,
        source_id: SourceId,
    ) -> CoreResult<LayerId> {
        if !self.sources().iter().any(|source| source.id() == source_id) {
            return Err(CoreError::SourceNotFound(source_id));
        }
        if self
            .layer_id_for_glyph_source(glyph_id.clone(), source_id.clone())
            .is_some()
        {
            return Err(CoreError::DuplicateGlyphLayer {
                glyph_id,
                source_id,
            });
        }

        let layer = GlyphLayer::new(LayerId::new(), source_id.clone());
        let layer_id = layer.id();
        self.insert_glyph_layer(glyph_id.clone(), layer)?;
        Ok(layer_id)
    }

    pub fn insert_glyph_layer(&mut self, glyph_id: GlyphId, layer: GlyphLayer) -> CoreResult<()> {
        if !self
            .sources()
            .iter()
            .any(|source| source.id() == layer.source_id())
        {
            return Err(CoreError::SourceNotFound(layer.source_id()));
        }

        let mut state = (*self.state).clone();
        let glyph = state
            .data
            .glyphs
            .get_mut(&glyph_id)
            .ok_or(CoreError::GlyphNotFound(glyph_id))?;
        Arc::make_mut(glyph).set_layer(layer);
        state.rebuild_index()?;
        self.state = Arc::new(state);
        Ok(())
    }

    pub fn remove_glyph_layer(&mut self, layer_id: LayerId) -> CoreResult<GlyphLayer> {
        let glyph_id = self
            .glyph_id_by_layer(layer_id.clone())
            .ok_or(CoreError::LayerNotFound(layer_id.clone()))?;
        let mut state = (*self.state).clone();
        let glyph = state
            .data
            .glyphs
            .get_mut(&glyph_id)
            .ok_or(CoreError::GlyphNotFound(glyph_id))?;
        let layer = Arc::make_mut(glyph)
            .remove_layer(layer_id.clone())
            .ok_or(CoreError::LayerNotFound(layer_id))?;
        state.rebuild_index()?;
        self.state = Arc::new(state);
        Ok(layer)
    }

    pub fn kerning(&self) -> &KerningData {
        &self.data().kerning
    }

    pub fn kerning_mut(&mut self) -> &mut KerningData {
        &mut self.data_mut().kerning
    }

    pub fn features(&self) -> &FeatureData {
        &self.data().features
    }

    pub fn features_mut(&mut self) -> &mut FeatureData {
        &mut self.data_mut().features
    }

    pub fn guidelines(&self) -> &[Guideline] {
        &self.data().guidelines
    }

    pub fn add_guideline(&mut self, guideline: Guideline) {
        self.data_mut().guidelines.push(guideline);
    }

    pub fn lib(&self) -> &LibData {
        &self.data().lib
    }

    pub fn lib_mut(&mut self) -> &mut LibData {
        &mut self.data_mut().lib
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{Contour, GlyphLayer, LayerId, PointType};
    use std::sync::Arc;
    use std::time::{Duration, Instant};

    #[derive(Clone, Copy)]
    struct PerfFontMark {
        label: &'static str,
        glyphs: usize,
        contours_per_glyph: usize,
        points_per_contour: usize,
    }

    impl PerfFontMark {
        fn total_points(self) -> usize {
            self.glyphs * self.contours_per_glyph * self.points_per_contour
        }
    }

    fn synthetic_point_heavy_font(mark: PerfFontMark) -> Font {
        let mut font = Font::new();
        let source_id = font.default_source_id().unwrap();

        for glyph_index in 0..mark.glyphs {
            let mut glyph = Glyph::with_unicode(format!("g{glyph_index:05}"), glyph_index as u32);
            let mut layer = GlyphLayer::with_width(
                LayerId::new(),
                source_id.clone(),
                500.0 + glyph_index as f64,
            );

            for contour_index in 0..mark.contours_per_glyph {
                let mut contour = Contour::new();
                for point_index in 0..mark.points_per_contour {
                    contour.add_point(
                        point_index as f64,
                        (glyph_index + contour_index + point_index) as f64,
                        PointType::OnCurve,
                        false,
                    );
                }
                layer.add_contour(contour);
            }

            glyph.set_layer(layer);
            font.insert_glyph(glyph).unwrap();
        }

        font
    }

    fn print_perf_mark(operation: &str, mark: PerfFontMark, elapsed: Duration) {
        eprintln!(
            "perf_mark {operation} [{}]: {} glyphs / {} points in {:?}",
            mark.label,
            mark.glyphs,
            mark.total_points(),
            elapsed
        );
    }

    #[test]
    fn font_creation() {
        let font = Font::new();
        assert_eq!(font.glyph_count(), 0);
        assert_eq!(font.sources().len(), 1);
        assert_eq!(font.default_source().map(Source::name), Some("Regular"));
    }

    #[test]
    fn font_glyph_operations() {
        let mut font = Font::new();
        let mut glyph = Glyph::with_unicode("A".to_string(), 65);
        let layer =
            GlyphLayer::with_width(LayerId::new(), font.default_source_id().unwrap(), 600.0);
        let layer_id = layer.id();
        glyph.set_layer(layer);

        let glyph_id = font.insert_glyph(glyph).unwrap();

        assert_eq!(font.glyph_count(), 1);
        assert!(font.glyph(glyph_id.clone()).is_some());
        assert_eq!(font.glyph_id_by_name("A"), Some(glyph_id.clone()));
        assert!(font.glyph_by_name("A").is_some());
        assert_eq!(
            font.glyph_id_by_layer(layer_id.clone()),
            Some(glyph_id.clone())
        );
        assert_eq!(
            font.layer_id_for_glyph_source(glyph_id.clone(), font.default_source_id().unwrap()),
            Some(layer_id.clone())
        );
        assert_eq!(
            font.glyphs_by_unicode(65)
                .map(Glyph::id)
                .collect::<Vec<_>>(),
            vec![glyph_id.clone()]
        );
    }

    #[test]
    fn font_remove_insert_glyph() {
        let mut font = Font::new();
        let glyph = Glyph::with_unicode("A".to_string(), 65);
        let glyph_id = font.insert_glyph(glyph).unwrap();

        let taken = font.remove_glyph(glyph_id.clone());
        assert!(taken.is_some());
        assert_eq!(font.glyph_count(), 0);
        assert_eq!(font.glyph_id_by_name("A"), None);

        font.insert_glyph(taken.unwrap()).unwrap();
        assert_eq!(font.glyph_count(), 1);
        assert_eq!(font.glyph_id_by_name("A"), Some(glyph_id.clone()));
    }

    #[test]
    fn glyph_names_are_unique() {
        let mut font = Font::new();
        font.insert_glyph(Glyph::new("A")).unwrap();

        let error = font.insert_glyph(Glyph::new("A")).unwrap_err();

        assert!(matches!(error, CoreError::DuplicateGlyphName(name) if name.as_str() == "A"));
    }

    #[test]
    fn glyph_iteration_preserves_insertion_order() {
        let mut font = Font::new();
        font.insert_glyph(Glyph::new("B")).unwrap();
        font.insert_glyph(Glyph::new("A")).unwrap();

        let names: Vec<_> = font
            .glyphs()
            .map(|glyph| glyph.name().to_string())
            .collect();

        assert_eq!(names, vec!["B", "A"]);
    }

    #[test]
    fn rename_glyph_keeps_id_stable_and_updates_name_index() {
        let mut font = Font::new();
        let glyph_id = font.insert_glyph(Glyph::new("A")).unwrap();

        font.rename_glyph(glyph_id.clone(), GlyphName::from("A.alt"))
            .unwrap();

        assert_eq!(font.glyph_id_by_name("A"), None);
        assert_eq!(font.glyph_id_by_name("A.alt"), Some(glyph_id.clone()));
        assert_eq!(font.glyph(glyph_id.clone()).unwrap().name(), "A.alt");
    }

    #[test]
    fn unicode_lookup_returns_all_matching_glyphs() {
        let mut font = Font::new();
        let a = font.insert_glyph(Glyph::with_unicode("A", 0x41)).unwrap();
        let a_alt = font
            .insert_glyph(Glyph::with_unicode("A.alt", 0x41))
            .unwrap();

        let glyph_ids: Vec<_> = font.glyphs_by_unicode(0x41).map(Glyph::id).collect();

        assert_eq!(glyph_ids, vec![a, a_alt]);
    }

    #[test]
    fn deserialization_rebuilds_private_indexes() {
        let mut font = Font::new();
        let source_id = font.default_source_id().unwrap();
        let mut glyph = Glyph::with_unicode("A", 0x41);
        let layer = GlyphLayer::new(LayerId::new(), source_id.clone());
        let layer_id = layer.id();
        glyph.set_layer(layer);
        let glyph_id = font.insert_glyph(glyph).unwrap();

        let json = serde_json::to_string(&font).unwrap();
        let decoded: Font = serde_json::from_str(&json).unwrap();

        assert_eq!(decoded.glyph_id_by_name("A"), Some(glyph_id.clone()));
        assert_eq!(
            decoded.glyph_id_by_layer(layer_id.clone()),
            Some(glyph_id.clone())
        );
        assert_eq!(
            decoded.layer_id_for_glyph_source(glyph_id.clone(), source_id.clone()),
            Some(layer_id.clone())
        );
        assert_eq!(
            decoded
                .glyphs_by_unicode(0x41)
                .map(Glyph::id)
                .collect::<Vec<_>>(),
            vec![glyph_id.clone()]
        );
    }

    #[test]
    fn duplicate_glyph_source_layer_is_an_error() {
        let mut font = Font::new();
        let source_id = font.default_source_id().unwrap();
        let glyph_id = font.insert_glyph(Glyph::new("A")).unwrap();

        font.create_glyph_layer(glyph_id.clone(), source_id.clone())
            .unwrap();
        let error = font
            .create_glyph_layer(glyph_id.clone(), source_id.clone())
            .unwrap_err();

        assert!(matches!(
            error,
            CoreError::DuplicateGlyphLayer {
                glyph_id: id,
                source_id: source
            } if id == glyph_id && source == source_id
        ));
    }

    #[test]
    fn layer_indexes_update_after_layer_removal() {
        let mut font = Font::new();
        let source_id = font.default_source_id().unwrap();
        let glyph_id = font.insert_glyph(Glyph::new("A")).unwrap();
        let layer_id = font
            .create_glyph_layer(glyph_id.clone(), source_id.clone())
            .unwrap();

        assert_eq!(
            font.glyph_id_by_layer(layer_id.clone()),
            Some(glyph_id.clone())
        );
        assert_eq!(
            font.layer_id_for_glyph_source(glyph_id.clone(), source_id.clone()),
            Some(layer_id.clone())
        );

        font.remove_glyph_layer(layer_id.clone()).unwrap();

        assert_eq!(font.glyph_id_by_layer(layer_id.clone()), None);
        assert_eq!(
            font.layer_id_for_glyph_source(glyph_id.clone(), source_id.clone()),
            None
        );
    }

    #[test]
    fn index_validation_rejects_duplicate_layers_for_one_glyph_source() {
        let source_id = SourceId::new();
        let mut glyph = Glyph::new("A");
        glyph.set_layer(GlyphLayer::new(LayerId::new(), source_id.clone()));
        glyph.set_layer(GlyphLayer::new(LayerId::new(), source_id.clone()));
        let mut glyphs = IndexMap::new();
        glyphs.insert(glyph.id(), Arc::new(glyph));

        let error = FontIndex::from_glyphs(&glyphs).unwrap_err();

        assert!(matches!(
            error,
            CoreError::DuplicateGlyphLayer {
                glyph_id: _,
                source_id: source
            } if source == source_id
        ));
    }

    #[test]
    fn cloned_font_shares_storage_until_mutated() {
        let mut font = Font::new();
        let snapshot = font.clone();

        assert!(Arc::ptr_eq(&font.state, &snapshot.state));

        font.metadata_mut().family_name = Some("Edited".to_string());

        assert!(!Arc::ptr_eq(&font.state, &snapshot.state));
        assert_eq!(font.metadata().family_name.as_deref(), Some("Edited"));
        assert_eq!(
            snapshot.metadata().family_name.as_deref(),
            Some("Untitled Font")
        );
    }

    #[test]
    fn mutating_one_glyph_after_snapshot_keeps_other_glyphs_shared() {
        let mut font = Font::new();
        let a = font
            .insert_glyph(Glyph::with_unicode("A".to_string(), 65))
            .unwrap();
        let b = font
            .insert_glyph(Glyph::with_unicode("B".to_string(), 66))
            .unwrap();
        let snapshot = font.clone();

        font.set_glyph_unicodes(a.clone(), vec![0x41, 0x00C1])
            .unwrap();

        assert_eq!(font.glyph(a.clone()).unwrap().unicodes(), &[0x41, 0x00C1]);
        assert_eq!(snapshot.glyph(a.clone()).unwrap().unicodes(), &[0x41]);
        assert!(!Arc::ptr_eq(
            font.state.data.glyphs.get(&a).unwrap(),
            snapshot.state.data.glyphs.get(&a).unwrap()
        ));
        assert!(Arc::ptr_eq(
            font.state.data.glyphs.get(&b).unwrap(),
            snapshot.state.data.glyphs.get(&b).unwrap()
        ));
    }

    #[test]
    fn perf_mark_large_font_clone_is_cow_snapshot() {
        let marks = [
            PerfFontMark {
                label: "small-latin",
                glyphs: 250,
                contours_per_glyph: 2,
                points_per_contour: 12,
            },
            PerfFontMark {
                label: "large-latin",
                glyphs: 2_000,
                contours_per_glyph: 4,
                points_per_contour: 16,
            },
            PerfFontMark {
                label: "cjk-scale",
                glyphs: 10_000,
                contours_per_glyph: 2,
                points_per_contour: 8,
            },
        ];

        for mark in marks {
            let font = synthetic_point_heavy_font(mark);
            let start = Instant::now();
            let snapshots: Vec<_> = (0..128).map(|_| font.clone()).collect();
            let elapsed = start.elapsed();

            assert_eq!(font.glyph_count(), mark.glyphs);
            for snapshot in &snapshots {
                assert!(Arc::ptr_eq(&font.state, &snapshot.state));
                assert_eq!(snapshot.glyph_count(), font.glyph_count());
            }

            print_perf_mark("font.clone snapshots x128", mark, elapsed);
            assert!(
                elapsed < Duration::from_secs(1),
                "COW snapshot creation should stay comfortably sub-second for {}; got {elapsed:?}",
                mark.label
            );
        }
    }

    #[test]
    fn perf_mark_large_font_mutating_one_glyph_preserves_unedited_glyph_sharing() {
        let mark = PerfFontMark {
            label: "cjk-scale",
            glyphs: 10_000,
            contours_per_glyph: 2,
            points_per_contour: 8,
        };
        let mut font = synthetic_point_heavy_font(mark);
        let snapshot = font.clone();
        let default_source_id = font.default_source_id().unwrap();
        let glyph_id = font.glyph_id_by_name("g00000").unwrap();
        let layer_id = font
            .layer_id_for_glyph_source(glyph_id.clone(), default_source_id.clone())
            .unwrap();
        let other_glyph_id = font.glyph_id_by_name("g00001").unwrap();
        let start = Instant::now();

        font.layer_mut(layer_id.clone())
            .expect("target glyph should exist")
            .set_width(777.0);

        let elapsed = start.elapsed();

        assert_eq!(
            font.layer(layer_id.clone())
                .expect("target source layer should exist")
                .width(),
            777.0
        );
        assert_ne!(
            snapshot
                .layer(layer_id.clone())
                .expect("target source layer should exist")
                .width(),
            777.0
        );
        assert!(!Arc::ptr_eq(
            font.state.data.glyphs.get(&glyph_id).unwrap(),
            snapshot.state.data.glyphs.get(&glyph_id).unwrap()
        ));
        assert!(Arc::ptr_eq(
            font.state.data.glyphs.get(&other_glyph_id).unwrap(),
            snapshot.state.data.glyphs.get(&other_glyph_id).unwrap()
        ));

        print_perf_mark("single glyph mutation after snapshot", mark, elapsed);
        assert!(
            elapsed < Duration::from_secs(1),
            "single-glyph COW mutation should stay comfortably sub-second; got {elapsed:?}"
        );
    }

    #[test]
    fn perf_mark_large_font_rename_rebuilds_indexes_within_budget() {
        let mark = PerfFontMark {
            label: "cjk-scale",
            glyphs: 10_000,
            contours_per_glyph: 2,
            points_per_contour: 8,
        };
        let mut font = synthetic_point_heavy_font(mark);
        let glyph_id = font.glyph_id_by_name("g00000").unwrap();
        let start = Instant::now();

        font.rename_glyph(glyph_id.clone(), GlyphName::from("g00000.alt"))
            .unwrap();

        let elapsed = start.elapsed();

        assert_eq!(font.glyph_id_by_name("g00000"), None);
        assert_eq!(font.glyph_id_by_name("g00000.alt"), Some(glyph_id.clone()));
        print_perf_mark("rename glyph and rebuild indexes", mark, elapsed);
        assert!(
            elapsed < Duration::from_secs(1),
            "glyph rename index rebuild should stay comfortably sub-second; got {elapsed:?}"
        );
    }

    #[test]
    fn perf_mark_large_font_unicode_update_rebuilds_indexes_within_budget() {
        let mark = PerfFontMark {
            label: "cjk-scale",
            glyphs: 10_000,
            contours_per_glyph: 2,
            points_per_contour: 8,
        };
        let mut font = synthetic_point_heavy_font(mark);
        let glyph_id = font.glyph_id_by_name("g00000").unwrap();
        let unicode = 0xE000;
        let start = Instant::now();

        font.set_glyph_unicodes(glyph_id.clone(), vec![0x41, unicode])
            .unwrap();

        let elapsed = start.elapsed();

        assert_eq!(
            font.glyphs_by_unicode(unicode)
                .map(Glyph::id)
                .collect::<Vec<_>>(),
            vec![glyph_id.clone()]
        );
        print_perf_mark("set glyph unicodes and rebuild indexes", mark, elapsed);
        assert!(
            elapsed < Duration::from_secs(1),
            "glyph Unicode index rebuild should stay comfortably sub-second; got {elapsed:?}"
        );
    }

    #[test]
    fn perf_mark_large_font_layer_membership_rebuilds_indexes_within_budget() {
        let mark = PerfFontMark {
            label: "cjk-scale",
            glyphs: 10_000,
            contours_per_glyph: 2,
            points_per_contour: 8,
        };
        let mut font = synthetic_point_heavy_font(mark);
        let glyph_id = font.glyph_id_by_name("g00000").unwrap();
        let source_id = font.add_source(Source::new("Bold".to_string(), Location::new()));
        let start = Instant::now();

        let layer_id = font
            .create_glyph_layer(glyph_id.clone(), source_id.clone())
            .unwrap();
        let removed = font.remove_glyph_layer(layer_id.clone()).unwrap();

        let elapsed = start.elapsed();

        assert_eq!(removed.id(), layer_id);
        assert_eq!(font.glyph_id_by_layer(layer_id.clone()), None);
        assert_eq!(
            font.layer_id_for_glyph_source(glyph_id.clone(), source_id.clone()),
            None
        );
        print_perf_mark("create/remove layer and rebuild indexes", mark, elapsed);
        assert!(
            elapsed < Duration::from_secs(1),
            "glyph layer membership index rebuild should stay comfortably sub-second; got {elapsed:?}"
        );
    }
}
