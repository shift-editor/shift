use crate::axis::{Axis, Location};
use crate::entity::SourceId;
use crate::features::FeatureData;
use crate::glyph::Glyph;
use crate::guideline::Guideline;
use crate::kerning::KerningData;
use crate::lib_data::LibData;
use crate::metrics::FontMetrics;
use crate::source::Source;
use crate::GlyphName;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
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

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Font {
    inner: Arc<FontData>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
struct FontData {
    metadata: FontMetadata,
    metrics: FontMetrics,
    axes: Vec<Axis>,
    sources: Vec<Source>,
    #[serde(default)]
    default_source_id: Option<SourceId>,
    glyphs: HashMap<GlyphName, Arc<Glyph>>,
    kerning: KerningData,
    features: FeatureData,
    guidelines: Vec<Guideline>,
    lib: LibData,
}

impl Default for Font {
    fn default() -> Self {
        let default_source = Source::new("Regular".to_string(), Location::new());
        let default_source_id = default_source.id();

        Self {
            inner: Arc::new(FontData {
                metadata: FontMetadata::default(),
                metrics: FontMetrics::default(),
                axes: Vec::new(),
                sources: vec![default_source],
                default_source_id: Some(default_source_id),
                glyphs: HashMap::new(),
                kerning: KerningData::new(),
                features: FeatureData::new(),
                guidelines: Vec::new(),
                lib: LibData::new(),
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
            inner: Arc::new(FontData {
                metadata: FontMetadata::default(),
                metrics: FontMetrics::default(),
                axes: Vec::new(),
                sources: Vec::new(),
                default_source_id: None,
                glyphs: HashMap::new(),
                kerning: KerningData::new(),
                features: FeatureData::new(),
                guidelines: Vec::new(),
                lib: LibData::new(),
            }),
        }
    }

    fn data(&self) -> &FontData {
        &self.inner
    }

    fn data_mut(&mut self) -> &mut FontData {
        Arc::make_mut(&mut self.inner)
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

    pub fn sources(&self) -> &[Source] {
        &self.data().sources
    }

    pub fn add_source(&mut self, source: Source) -> SourceId {
        let source_id = source.id();
        let data = self.data_mut();
        if data.default_source_id.is_none() {
            data.default_source_id = Some(source_id);
        }
        data.sources.push(source);
        source_id
    }

    pub fn clear_sources(&mut self) {
        let data = self.data_mut();
        data.sources.clear();
        data.default_source_id = None;
    }

    pub fn default_source_id(&self) -> Option<SourceId> {
        self.data().default_source_id
    }

    pub fn set_default_source_id(&mut self, source_id: SourceId) {
        self.data_mut().default_source_id = Some(source_id);
    }

    pub fn default_source(&self) -> Option<&Source> {
        let default_source_id = self.data().default_source_id?;
        self.data()
            .sources
            .iter()
            .find(|source| source.id() == default_source_id)
    }

    pub fn is_variable(&self) -> bool {
        !self.data().axes.is_empty()
    }

    pub fn glyphs(&self) -> &HashMap<GlyphName, Arc<Glyph>> {
        &self.data().glyphs
    }

    pub fn glyph(&self, name: &str) -> Option<&Glyph> {
        self.data().glyphs.get(name).map(Arc::as_ref)
    }

    pub fn glyph_mut(&mut self, name: &str) -> Option<&mut Glyph> {
        self.data_mut().glyphs.get_mut(name).map(Arc::make_mut)
    }

    pub fn glyph_by_unicode(&self, unicode: u32) -> Option<&Glyph> {
        self.data()
            .glyphs
            .values()
            .find(|g| g.unicodes().contains(&unicode))
            .map(Arc::as_ref)
    }

    pub fn glyph_by_unicode_mut(&mut self, unicode: u32) -> Option<&mut Glyph> {
        self.data_mut()
            .glyphs
            .values_mut()
            .find(|g| g.unicodes().contains(&unicode))
            .map(Arc::make_mut)
    }

    pub fn insert_glyph(&mut self, glyph: Glyph) {
        self.data_mut()
            .glyphs
            .insert(glyph.glyph_name().clone(), Arc::new(glyph));
    }

    pub fn remove_glyph(&mut self, name: &str) -> Option<Glyph> {
        self.data_mut()
            .glyphs
            .remove(name)
            .map(Arc::unwrap_or_clone)
    }

    pub fn glyph_count(&self) -> usize {
        self.data().glyphs.len()
    }

    pub fn take_glyph(&mut self, name: &str) -> Option<Glyph> {
        self.data_mut()
            .glyphs
            .remove(name)
            .map(Arc::unwrap_or_clone)
    }

    pub fn put_glyph(&mut self, glyph: Glyph) {
        self.data_mut()
            .glyphs
            .insert(glyph.glyph_name().clone(), Arc::new(glyph));
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
            let mut layer =
                GlyphLayer::with_width(LayerId::new(), source_id, 500.0 + glyph_index as f64);

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
            font.insert_glyph(glyph);
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
        glyph.set_layer(layer);

        font.insert_glyph(glyph);

        assert_eq!(font.glyph_count(), 1);
        assert!(font.glyph("A").is_some());
        assert!(font.glyph_by_unicode(65).is_some());
    }

    #[test]
    fn font_take_put_glyph() {
        let mut font = Font::new();
        font.insert_glyph(Glyph::with_unicode("A".to_string(), 65));

        let taken = font.take_glyph("A");
        assert!(taken.is_some());
        assert_eq!(font.glyph_count(), 0);

        font.put_glyph(taken.unwrap());
        assert_eq!(font.glyph_count(), 1);
    }

    #[test]
    fn cloned_font_shares_storage_until_mutated() {
        let mut font = Font::new();
        let snapshot = font.clone();

        assert!(Arc::ptr_eq(&font.inner, &snapshot.inner));

        font.metadata_mut().family_name = Some("Edited".to_string());

        assert!(!Arc::ptr_eq(&font.inner, &snapshot.inner));
        assert_eq!(font.metadata().family_name.as_deref(), Some("Edited"));
        assert_eq!(
            snapshot.metadata().family_name.as_deref(),
            Some("Untitled Font")
        );
    }

    #[test]
    fn mutating_one_glyph_after_snapshot_keeps_other_glyphs_shared() {
        let mut font = Font::new();
        font.insert_glyph(Glyph::with_unicode("A".to_string(), 65));
        font.insert_glyph(Glyph::with_unicode("B".to_string(), 66));
        let snapshot = font.clone();

        font.glyph_mut("A")
            .unwrap()
            .set_unicodes(vec![0x41, 0x00C1]);

        assert_eq!(font.glyph("A").unwrap().unicodes(), &[0x41, 0x00C1]);
        assert_eq!(snapshot.glyph("A").unwrap().unicodes(), &[0x41]);
        assert!(!Arc::ptr_eq(
            font.inner.glyphs.get("A").unwrap(),
            snapshot.inner.glyphs.get("A").unwrap()
        ));
        assert!(Arc::ptr_eq(
            font.inner.glyphs.get("B").unwrap(),
            snapshot.inner.glyphs.get("B").unwrap()
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
                assert!(Arc::ptr_eq(&font.inner, &snapshot.inner));
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
        let start = Instant::now();

        font.glyph_mut("g00000")
            .expect("target glyph should exist")
            .layer_for_source_mut(default_source_id)
            .expect("target source layer should exist")
            .set_width(777.0);

        let elapsed = start.elapsed();

        assert_eq!(
            font.glyph("g00000")
                .unwrap()
                .layer_for_source(default_source_id)
                .unwrap()
                .width(),
            777.0
        );
        assert_ne!(
            snapshot
                .glyph("g00000")
                .unwrap()
                .layer_for_source(snapshot.default_source_id().unwrap())
                .unwrap()
                .width(),
            777.0
        );
        assert!(!Arc::ptr_eq(
            font.inner.glyphs.get("g00000").unwrap(),
            snapshot.inner.glyphs.get("g00000").unwrap()
        ));
        assert!(Arc::ptr_eq(
            font.inner.glyphs.get("g00001").unwrap(),
            snapshot.inner.glyphs.get("g00001").unwrap()
        ));

        print_perf_mark("single glyph mutation after snapshot", mark, elapsed);
        assert!(
            elapsed < Duration::from_secs(1),
            "single-glyph COW mutation should stay comfortably sub-second; got {elapsed:?}"
        );
    }
}
