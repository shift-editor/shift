//! A font described by names instead of ids, so a font and its exported and
//! re-read copy compare equal exactly when everything export must keep
//! survived.

use std::collections::BTreeMap;

use shift_font::{
    AxisKind, Font, GlyphLayer, KerningPosition, KerningSide, PointType, StandardMetrics,
};

#[derive(Debug, PartialEq)]
pub(super) struct FontSummary {
    pub(super) family_name: Option<String>,
    pub(super) units_per_em: f64,
    pub(super) axes: Vec<AxisSummary>,
    pub(super) default_source: Option<String>,
    /// Master names in the font's source order.
    pub(super) source_order: Vec<String>,
    pub(super) glyph_order: Vec<String>,
    pub(super) features: Option<String>,
    pub(super) sources: BTreeMap<String, SourceSummary>,
    pub(super) glyphs: BTreeMap<String, GlyphSummary>,
    pub(super) groups: BTreeMap<GroupKey, Vec<String>>,
    /// Pair values by source name, then by `(first, second)` side names.
    pub(super) kerning: BTreeMap<String, BTreeMap<PairKey, f64>>,
    pub(super) instances: Vec<InstanceSummary>,
}

#[derive(Debug, PartialEq)]
pub(super) struct AxisSummary {
    pub(super) tag: String,
    pub(super) name: String,
    pub(super) minimum: f64,
    pub(super) default: f64,
    pub(super) maximum: f64,
    pub(super) hidden: bool,
    /// The axis's own user-to-design map, as `(user, design)` pairs.
    pub(super) map: Vec<MapPoint>,
}

#[derive(Debug, PartialEq)]
pub(super) struct MapPoint {
    pub(super) user: f64,
    pub(super) design: f64,
}

#[derive(Debug, PartialEq)]
pub(super) struct SourceSummary {
    /// Design coordinates by axis tag.
    pub(super) location: BTreeMap<String, f64>,
    pub(super) metrics: StandardMetrics,
    pub(super) italic_angle: Option<f64>,
    pub(super) line_gap: Option<f64>,
}

#[derive(Debug, PartialEq)]
pub(super) struct GlyphSummary {
    pub(super) unicodes: Vec<u32>,
    /// Layers by source name.
    pub(super) layers: BTreeMap<String, LayerSummary>,
}

#[derive(Debug, PartialEq)]
pub(super) struct LayerSummary {
    pub(super) width: f64,
    pub(super) contours: Vec<ContourSummary>,
    pub(super) components: Vec<ComponentSummary>,
    pub(super) anchors: Vec<AnchorSummary>,
}

#[derive(Debug, PartialEq)]
pub(super) struct ContourSummary {
    pub(super) closed: bool,
    pub(super) points: Vec<PointSummary>,
}

#[derive(Debug, PartialEq)]
pub(super) struct PointSummary {
    pub(super) x: f64,
    pub(super) y: f64,
    pub(super) point_type: PointType,
    pub(super) smooth: bool,
}

#[derive(Debug, PartialEq)]
pub(super) struct ComponentSummary {
    pub(super) base: String,
    /// The affine matrix in `xx, xy, yx, yy, dx, dy` order.
    pub(super) matrix: [f64; 6],
}

#[derive(Debug, PartialEq)]
pub(super) struct AnchorSummary {
    pub(super) name: Option<String>,
    pub(super) x: f64,
    pub(super) y: f64,
}

#[derive(Debug, PartialEq, Eq, PartialOrd, Ord)]
pub(super) struct GroupKey {
    pub(super) first: bool,
    pub(super) name: String,
}

#[derive(Debug, PartialEq, Eq, PartialOrd, Ord)]
pub(super) struct PairKey {
    pub(super) first: String,
    pub(super) second: String,
}

#[derive(Debug, PartialEq)]
pub(super) struct InstanceSummary {
    pub(super) name: String,
    /// User coordinates by axis tag.
    pub(super) location: BTreeMap<String, f64>,
    pub(super) postscript_name: Option<String>,
}

impl FontSummary {
    pub(super) fn of(font: &Font) -> Self {
        let masters: Vec<_> = font
            .sources()
            .iter()
            .filter(|source| source.is_master())
            .collect();
        let source_name = |id| {
            font.source(id)
                .map_or_else(|| format!("{id:?}"), |source| source.name().to_string())
        };

        Self {
            family_name: font.metadata().family_name.clone(),
            units_per_em: font.metrics().units_per_em,
            axes: font
                .axes()
                .iter()
                .map(|axis| AxisSummary::of(font, axis))
                .collect(),
            default_source: font
                .default_source()
                .map(|source| source.name().to_string()),
            source_order: masters
                .iter()
                .map(|source| source.name().to_string())
                .collect(),
            glyph_order: font
                .glyphs()
                .map(|glyph| glyph.name().to_string())
                .collect(),
            features: font.features().fea_source().map(str::to_string),
            sources: masters
                .iter()
                .map(|source| {
                    let summary = SourceSummary {
                        location: font
                            .axes()
                            .iter()
                            .map(|axis| (axis.tag().to_string(), source.location().value_on(axis)))
                            .collect(),
                        metrics: StandardMetrics::of(source, font.metric_definitions()),
                        italic_angle: source.italic_angle(),
                        line_gap: source.line_gap(),
                    };
                    (source.name().to_string(), summary)
                })
                .collect(),
            glyphs: font
                .glyphs()
                .map(|glyph| {
                    let layers = masters
                        .iter()
                        .filter_map(|source| {
                            let layer = glyph.layer_for_source(source.id())?;
                            Some((source.name().to_string(), LayerSummary::of(layer)))
                        })
                        .collect();
                    let summary = GlyphSummary {
                        unicodes: glyph.unicodes().to_vec(),
                        layers,
                    };
                    (glyph.name().to_string(), summary)
                })
                .collect(),
            groups: font
                .kerning()
                .all_groups()
                .map(|(_, group)| {
                    let key = GroupKey {
                        first: group.position == KerningPosition::First,
                        name: group.name.clone(),
                    };
                    let members = group
                        .members
                        .iter()
                        .map(|id| glyph_name(font, *id))
                        .collect();
                    (key, members)
                })
                .collect(),
            kerning: font
                .kerning()
                .sources()
                .map(|(source_id, values)| {
                    let pairs = values
                        .pairs()
                        .map(|(pair, value)| {
                            let key = PairKey {
                                first: side_name(font, &pair.first),
                                second: side_name(font, &pair.second),
                            };
                            (key, value)
                        })
                        .collect();
                    (source_name(*source_id), pairs)
                })
                .filter(|(_, pairs): &(String, BTreeMap<PairKey, f64>)| !pairs.is_empty())
                .collect(),
            instances: font
                .named_instances()
                .iter()
                .map(|instance| InstanceSummary {
                    name: instance.name().to_string(),
                    location: font
                        .axes()
                        .iter()
                        .map(|axis| (axis.tag().to_string(), instance.location().value_on(axis)))
                        .collect(),
                    postscript_name: instance.postscript_name().map(str::to_string),
                })
                .collect(),
        }
    }
}

impl AxisSummary {
    fn of(font: &Font, axis: &shift_font::Axis) -> Self {
        let (minimum, maximum) = match axis.kind() {
            AxisKind::Continuous {
                minimum, maximum, ..
            } => (*minimum, *maximum),
            AxisKind::Discrete { values, .. } => (
                values.iter().copied().fold(f64::INFINITY, f64::min),
                values.iter().copied().fold(f64::NEG_INFINITY, f64::max),
            ),
        };
        let map = font
            .axis_mappings()
            .iter()
            .find(|mapping| {
                mapping.is_independent() && mapping.inputs().first() == Some(&axis.id())
            })
            .map(|mapping| {
                mapping
                    .points()
                    .iter()
                    .filter_map(|point| {
                        Some(MapPoint {
                            user: point.input.get(axis.id())?,
                            design: point.output.get(axis.id())?,
                        })
                    })
                    .collect()
            })
            .unwrap_or_default();

        Self {
            tag: axis.tag().to_string(),
            name: axis.name().to_string(),
            minimum,
            default: axis.default(),
            maximum,
            hidden: axis.is_hidden(),
            map,
        }
    }
}

impl LayerSummary {
    fn of(layer: &GlyphLayer) -> Self {
        Self {
            width: layer.width(),
            contours: layer
                .contours_iter()
                .filter(|contour| !contour.is_empty())
                .map(|contour| ContourSummary {
                    closed: contour.is_closed(),
                    points: contour
                        .points()
                        .iter()
                        .map(|point| PointSummary {
                            x: point.x(),
                            y: point.y(),
                            point_type: point.point_type(),
                            smooth: point.is_smooth(),
                        })
                        .collect(),
                })
                .collect(),
            components: layer
                .components_iter()
                .map(|component| ComponentSummary {
                    base: component.base_glyph_name().to_string(),
                    matrix: component.matrix().to_values(),
                })
                .collect(),
            anchors: layer
                .anchors_iter()
                .map(|anchor| AnchorSummary {
                    name: anchor.name().map(str::to_string),
                    x: anchor.x(),
                    y: anchor.y(),
                })
                .collect(),
        }
    }
}

fn glyph_name(font: &Font, id: shift_font::GlyphId) -> String {
    font.glyph(id)
        .map_or_else(|| format!("{id:?}"), |glyph| glyph.name().to_string())
}

fn side_name(font: &Font, side: &KerningSide) -> String {
    match side {
        KerningSide::Glyph(id) => glyph_name(font, *id),
        KerningSide::Group(id) => font
            .kerning()
            .group(*id)
            .map_or_else(|| format!("{id:?}"), |group| format!("@{}", group.name)),
    }
}

impl FontSummary {
    /// Names each field that differs from `expected`, with both values.
    pub(super) fn differences(&self, expected: &Self) -> Vec<String> {
        let mut differences = Vec::new();
        let mut compare = |field: &str, actual: String, expected: String| {
            if actual != expected {
                differences.push(format!(
                    "{field}:\n  read:     {actual}\n  exported: {expected}"
                ));
            }
        };
        compare(
            "family_name",
            format!("{:?}", self.family_name),
            format!("{:?}", expected.family_name),
        );
        compare(
            "units_per_em",
            format!("{:?}", self.units_per_em),
            format!("{:?}", expected.units_per_em),
        );
        compare(
            "axes",
            format!("{:?}", self.axes),
            format!("{:?}", expected.axes),
        );
        compare(
            "default_source",
            format!("{:?}", self.default_source),
            format!("{:?}", expected.default_source),
        );
        compare(
            "source_order",
            format!("{:?}", self.source_order),
            format!("{:?}", expected.source_order),
        );
        compare(
            "glyph_order",
            format!("{:?}", self.glyph_order),
            format!("{:?}", expected.glyph_order),
        );
        compare(
            "features",
            format!("{:?}", self.features),
            format!("{:?}", expected.features),
        );
        for (name, source) in &expected.sources {
            compare(
                &format!("source {name}"),
                format!("{:?}", self.sources.get(name)),
                format!("{:?}", Some(source)),
            );
        }
        compare(
            "source names",
            format!("{:?}", self.sources.keys().collect::<Vec<_>>()),
            format!("{:?}", expected.sources.keys().collect::<Vec<_>>()),
        );
        for (name, glyph) in &expected.glyphs {
            compare(
                &format!("glyph {name}"),
                format!("{:?}", self.glyphs.get(name)),
                format!("{:?}", Some(glyph)),
            );
        }
        compare(
            "glyph names",
            format!("{:?}", self.glyphs.keys().collect::<Vec<_>>()),
            format!("{:?}", expected.glyphs.keys().collect::<Vec<_>>()),
        );
        compare(
            "groups",
            format!("{:?}", self.groups),
            format!("{:?}", expected.groups),
        );
        compare(
            "kerning",
            format!("{:?}", self.kerning),
            format!("{:?}", expected.kerning),
        );
        compare(
            "instances",
            format!("{:?}", self.instances),
            format!("{:?}", expected.instances),
        );
        differences
    }
}
