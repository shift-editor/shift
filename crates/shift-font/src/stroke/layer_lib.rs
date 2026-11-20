//! Non-destructive stroke metadata on a [`GlyphLayer`](crate::GlyphLayer)'s lib.
//!
//! Skeleton paths live in contours; this dict records roles and style ids only.

use std::collections::{BTreeMap, BTreeSet};

use serde::{Deserialize, Serialize};

use crate::GlyphLayer;
use crate::ir::lib_data::{LibData, LibValue};

/// Layer lib key for stroke metadata (option C in the strokes spike).
pub const STROKE_LIB_KEY: &str = "com.shift.stroke";

/// Whether a contour is a skeleton centerline or a baked outline.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ContourStrokeRole {
    Skeleton,
    Outline,
}

/// Stroke metadata for one contour, keyed by contour id in [`LayerStrokeLib`].
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ContourStrokeEntry {
    pub role: ContourStrokeRole,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub style_id: Option<String>,
}

/// `com.shift.stroke` payload: contour id → role and optional style preset id.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LayerStrokeLib {
    pub contours: BTreeMap<String, ContourStrokeEntry>,
}

impl LayerStrokeLib {
    /// Reads stroke lib data from a layer or glyph lib value.
    ///
    /// Returns `None` when the value is not a dict of contour entries.
    pub fn from_lib(value: &LibValue) -> Option<Self> {
        let LibValue::Dict(fields) = value else {
            return None;
        };
        let contours_value = fields.get("contours")?;
        let LibValue::Dict(contours) = contours_value else {
            return None;
        };
        let mut parsed = BTreeMap::new();
        for (contour_id, entry_value) in contours {
            let LibValue::Dict(entry_fields) = entry_value else {
                return None;
            };
            let role = match entry_fields.get("role")? {
                LibValue::String(text) => match text.as_str() {
                    "skeleton" => ContourStrokeRole::Skeleton,
                    "outline" => ContourStrokeRole::Outline,
                    _ => return None,
                },
                _ => return None,
            };
            let style_id = match entry_fields.get("styleId") {
                Some(LibValue::String(id)) => Some(id.clone()),
                None => None,
                _ => return None,
            };
            parsed.insert(contour_id.clone(), ContourStrokeEntry { role, style_id });
        }
        Some(Self { contours: parsed })
    }

    /// The lib value [`Self::from_lib`] reads back.
    pub fn to_lib(&self) -> LibValue {
        let contours = self
            .contours
            .iter()
            .map(|(contour_id, entry)| {
                let mut fields = BTreeMap::from([(
                    "role".to_string(),
                    LibValue::String(match entry.role {
                        ContourStrokeRole::Skeleton => "skeleton".to_string(),
                        ContourStrokeRole::Outline => "outline".to_string(),
                    }),
                )]);
                if let Some(style_id) = &entry.style_id {
                    fields.insert("styleId".to_string(), LibValue::String(style_id.clone()));
                }
                (contour_id.clone(), LibValue::Dict(fields))
            })
            .collect();
        LibValue::Dict(BTreeMap::from([(
            "contours".to_string(),
            LibValue::Dict(contours),
        )]))
    }

    /// Contour ids listed in stroke lib but absent from `live_contour_ids`.
    pub fn orphan_contour_ids(
        &self,
        live_contour_ids: impl IntoIterator<Item = String>,
    ) -> Vec<String> {
        let live: BTreeSet<_> = live_contour_ids.into_iter().collect();
        self.contours
            .keys()
            .filter(|contour_id| !live.contains(*contour_id))
            .cloned()
            .collect()
    }

    /// Drops entries for contours that are not in `live_contour_ids`.
    ///
    /// Returns the contour ids that were removed.
    pub fn retain_contours(
        &mut self,
        live_contour_ids: impl IntoIterator<Item = String>,
    ) -> Vec<String> {
        let live: BTreeSet<_> = live_contour_ids.into_iter().collect();
        let mut removed = Vec::new();
        self.contours.retain(|contour_id, _| {
            if live.contains(contour_id) {
                true
            } else {
                removed.push(contour_id.clone());
                false
            }
        });
        removed
    }
}

impl GlyphLayer {
    /// Stroke metadata stored under [`STROKE_LIB_KEY`], when present and well formed.
    pub fn stroke_lib(&self) -> Option<LayerStrokeLib> {
        self.lib()
            .get(STROKE_LIB_KEY)
            .and_then(LayerStrokeLib::from_lib)
    }

    /// Writes `stroke` under [`STROKE_LIB_KEY`], replacing any previous stroke lib.
    pub fn set_stroke_lib(&mut self, stroke: &LayerStrokeLib) {
        self.lib_mut()
            .set(STROKE_LIB_KEY.to_string(), stroke.to_lib());
    }

    /// Contour ids with stroke lib entries but no matching contour on this layer.
    pub fn orphan_stroke_lib_contour_ids(&self) -> Vec<String> {
        let Some(stroke_lib) = self.stroke_lib() else {
            return Vec::new();
        };
        stroke_lib.orphan_contour_ids(self.contours_iter().map(|contour| contour.id().to_string()))
    }

    /// Removes stroke lib entries that do not match a contour on this layer.
    ///
    /// When every entry is removed, the `com.shift.stroke` lib key is dropped.
    ///
    /// Returns the contour ids that were removed from the stroke lib.
    pub fn prune_orphan_stroke_lib_entries(&mut self) -> Vec<String> {
        let Some(mut stroke_lib) = self.stroke_lib() else {
            return Vec::new();
        };
        let removed = stroke_lib
            .retain_contours(self.contours_iter().map(|contour| contour.id().to_string()));
        sync_stroke_lib_on_layer(self, &stroke_lib);
        removed
    }
}

/// Installs `stroke` on `layer`, or removes [`STROKE_LIB_KEY`] when empty.
fn sync_stroke_lib_on_layer(layer: &mut GlyphLayer, stroke: &LayerStrokeLib) {
    let lib: &mut LibData = layer.lib_mut();
    if stroke.contours.is_empty() {
        lib.remove(STROKE_LIB_KEY);
    } else {
        lib.set(STROKE_LIB_KEY.to_string(), stroke.to_lib());
    }
}

#[cfg(test)]
mod tests {
    use std::collections::BTreeMap;

    use crate::test_support::sample_variable_font;
    use crate::{Contour, DesignLocation, GlyphLayer, LayerId, PointType, SourceId};

    use super::*;

    #[test]
    fn round_trips_through_the_lib() {
        let mut contours = BTreeMap::new();
        contours.insert(
            "c1".to_string(),
            ContourStrokeEntry {
                role: ContourStrokeRole::Skeleton,
                style_id: Some("icon".to_string()),
            },
        );
        let stored = LayerStrokeLib { contours };

        let lib_value = stored.to_lib();
        assert_eq!(LayerStrokeLib::from_lib(&lib_value), Some(stored));
    }

    #[test]
    fn reads_a_malformed_or_missing_value_as_no_stroke_lib() {
        assert_eq!(
            LayerStrokeLib::from_lib(&LibValue::String("stroke".to_string())),
            None
        );

        let missing_contours = LibValue::Dict(BTreeMap::from([(
            "roles".to_string(),
            LibValue::Dict(BTreeMap::new()),
        )]));
        assert_eq!(LayerStrokeLib::from_lib(&missing_contours), None);

        let bad_role = LibValue::Dict(BTreeMap::from([(
            "contours".to_string(),
            LibValue::Dict(BTreeMap::from([(
                "c1".to_string(),
                LibValue::Dict(BTreeMap::from([(
                    "role".to_string(),
                    LibValue::String("centerline".to_string()),
                )])),
            )])),
        )]));
        assert_eq!(LayerStrokeLib::from_lib(&bad_role), None);

        let bad_style_id = LibValue::Dict(BTreeMap::from([(
            "contours".to_string(),
            LibValue::Dict(BTreeMap::from([(
                "c1".to_string(),
                LibValue::Dict(BTreeMap::from([
                    ("role".to_string(), LibValue::String("skeleton".to_string())),
                    ("styleId".to_string(), LibValue::Integer(1)),
                ])),
            )])),
        )]));
        assert_eq!(LayerStrokeLib::from_lib(&bad_style_id), None);
    }

    #[test]
    fn flags_orphan_stroke_lib_entries_before_prune() {
        let source_id = SourceId::from_raw("stroke_source");
        let mut layer = GlyphLayer::with_width(LayerId::from_raw("stroke_layer"), source_id, 500.0);
        let mut contour = Contour::new();
        contour.add_point(0.0, 0.0, PointType::OnCurve, false);
        contour.add_point(0.0, 100.0, PointType::OnCurve, false);
        layer.add_contour(contour);
        let live_id = layer.contours_iter().next().unwrap().id().to_string();
        let stroke_lib = LayerStrokeLib {
            contours: BTreeMap::from([
                (
                    live_id,
                    ContourStrokeEntry {
                        role: ContourStrokeRole::Skeleton,
                        style_id: None,
                    },
                ),
                (
                    "orphan".to_string(),
                    ContourStrokeEntry {
                        role: ContourStrokeRole::Skeleton,
                        style_id: Some("icon".to_string()),
                    },
                ),
            ]),
        };
        layer.set_stroke_lib(&stroke_lib);

        assert_eq!(
            layer.orphan_stroke_lib_contour_ids(),
            vec!["orphan".to_string()]
        );

        let removed = layer.prune_orphan_stroke_lib_entries();
        assert_eq!(removed, vec!["orphan".to_string()]);
        assert!(layer.orphan_stroke_lib_contour_ids().is_empty());
        assert_eq!(
            layer.stroke_lib().unwrap().contours.len(),
            1,
            "live contour entry should remain"
        );
    }

    #[test]
    fn removing_a_contour_prunes_its_stroke_lib_entry() {
        let source_id = SourceId::from_raw("stroke_source");
        let mut layer = GlyphLayer::with_width(LayerId::from_raw("stroke_layer"), source_id, 500.0);
        let mut contour = Contour::new();
        contour.add_point(0.0, 0.0, PointType::OnCurve, false);
        contour.add_point(0.0, 100.0, PointType::OnCurve, false);
        layer.add_contour(contour);
        let contour_id = layer.contours_iter().next().unwrap().id().clone();
        let stroke_lib = LayerStrokeLib {
            contours: BTreeMap::from([(
                contour_id.to_string(),
                ContourStrokeEntry {
                    role: ContourStrokeRole::Skeleton,
                    style_id: None,
                },
            )]),
        };
        layer.set_stroke_lib(&stroke_lib);

        layer.remove_contour(&contour_id);

        assert!(layer.stroke_lib().is_none());
        assert!(layer.contours_iter().next().is_none());
    }

    fn stroke_style_id_on_layer(layer: &mut GlyphLayer, style_id: &str) {
        let contour_id = layer.contours_iter().next().unwrap().id().to_string();
        let stroke_lib = LayerStrokeLib {
            contours: BTreeMap::from([(
                contour_id,
                ContourStrokeEntry {
                    role: ContourStrokeRole::Skeleton,
                    style_id: Some(style_id.to_string()),
                },
            )]),
        };
        layer.set_stroke_lib(&stroke_lib);
    }

    #[test]
    fn glyph_interpolation_does_not_blend_stroke_lib_metadata() {
        let mut font = sample_variable_font();
        let glyph_id = font.glyph_by_name("A").unwrap().id();
        let default_source = font.default_source_id().unwrap();
        let bold_source = font
            .sources()
            .iter()
            .find(|source| source.name() == "Bold")
            .unwrap()
            .id();

        let mut layers = Vec::new();
        for (source_id, style_id) in [(default_source, "light"), (bold_source, "bold")] {
            let layer_id = font
                .glyph(glyph_id)
                .unwrap()
                .layer_for_source(source_id)
                .unwrap()
                .id()
                .clone();
            let mut layer = font.layer(layer_id).unwrap().clone();
            stroke_style_id_on_layer(&mut layer, style_id);
            layers.push(layer);
        }
        font.replace_glyph_layers(layers).unwrap();

        let interpolation = font.glyph_interpolation(glyph_id).unwrap().unwrap();
        let axis_id = font.axes()[0].id();
        let location = DesignLocation::from([(axis_id, 600.0)]);
        let resolved = interpolation.resolve(&location, font.axes()).unwrap();

        let reference = font
            .glyph(glyph_id)
            .unwrap()
            .layer_for_source(default_source)
            .unwrap();
        let reference_style = reference.stroke_lib().and_then(|stroke| {
            stroke
                .contours
                .values()
                .next()
                .and_then(|entry| entry.style_id.clone())
        });
        let resolved_style = resolved.stroke_lib().and_then(|stroke| {
            stroke
                .contours
                .values()
                .next()
                .and_then(|entry| entry.style_id.clone())
        });

        assert_eq!(
            resolved_style, reference_style,
            "stroke lib should copy the reference master (B5: no lib blending yet)"
        );
        assert_eq!(reference_style.as_deref(), Some("light"));
    }
}
