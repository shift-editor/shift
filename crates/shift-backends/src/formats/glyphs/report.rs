use glyphs_reader::{Font as GlyphsFont, Shape};

use crate::{ImportLoss, ImportLossKind, ImportReport};

pub(super) fn import_report(source: &GlyphsFont) -> ImportReport {
    let mut report = ImportReport::default();

    let bracket_layers = source
        .glyphs
        .values()
        .map(|glyph| glyph.bracket_layers.len())
        .sum::<usize>();
    if bracket_layers > 0 {
        report.losses.push(ImportLoss {
            kind: ImportLossKind::Omitted,
            message: format!(
                "Shift does not represent Glyphs bracket layers; {bracket_layers} conditional layers were omitted."
            ),
        });
    }

    let intermediate_layers = source
        .glyphs
        .values()
        .flat_map(|glyph| &glyph.layers)
        .filter(|layer| layer.is_intermediate())
        .count();
    if intermediate_layers > 0 {
        report.losses.push(ImportLoss {
            kind: ImportLossKind::Approximated,
            message: format!(
                "Shift does not represent Glyphs intermediate-layer locations; {intermediate_layers} layers were retained as ordinary layers without their intermediate locations."
            ),
        });
    }

    let smart_component_glyphs = source
        .glyphs
        .values()
        .filter(|glyph| {
            !glyph.smart_component_axes.is_empty()
                || glyph
                    .layers
                    .iter()
                    .chain(&glyph.bracket_layers)
                    .any(|layer| {
                        !layer.smart_component_positions.is_empty()
                            || layer.shapes.iter().any(|shape| {
                                matches!(shape, Shape::Component(component) if !component.smart_component_values.is_empty())
                            })
                    })
        })
        .count();
    if smart_component_glyphs > 0 {
        report.losses.push(ImportLoss {
            kind: ImportLossKind::Approximated,
            message: format!(
                "Shift does not represent Glyphs smart-component axes and locations; smart geometry in {smart_component_glyphs} glyphs was retained as ordinary layers and components."
            ),
        });
    }

    let default_master_id = source
        .masters
        .get(source.default_master_idx)
        .map(|master| master.id.as_str());
    let non_default_kerning_pairs = source
        .kerning_ltr
        .iter()
        .filter(|(master_id, _)| Some(master_id.as_str()) != default_master_id)
        .map(|(_, pairs)| pairs.len())
        .sum::<usize>();
    if non_default_kerning_pairs > 0 {
        report.losses.push(ImportLoss {
            kind: ImportLossKind::Omitted,
            message: format!(
                "Shift stores one kerning table; {non_default_kerning_pairs} non-default-master Glyphs kerning pairs were omitted."
            ),
        });
    }

    let rtl_kerning_pairs = source
        .kerning_rtl
        .iter()
        .map(|(_, pairs)| pairs.len())
        .sum::<usize>();
    if rtl_kerning_pairs > 0 {
        report.losses.push(ImportLoss {
            kind: ImportLossKind::Omitted,
            message: format!(
                "Shift does not represent Glyphs RTL kerning separately; {rtl_kerning_pairs} RTL kerning pairs were omitted."
            ),
        });
    }

    report
}

#[cfg(test)]
mod tests {
    use glyphs_reader::{AxisRule, Font as GlyphsFont, Glyph, Layer, LayerAttributes};
    use ordered_float::OrderedFloat;

    use super::*;

    #[test]
    fn reports_source_concepts_shift_cannot_represent() {
        let mut source = GlyphsFont::default();
        let mut glyph = Glyph {
            name: "A".into(),
            ..Glyph::default()
        };
        glyph.bracket_layers.push(Layer {
            attributes: LayerAttributes {
                axis_rules: vec![AxisRule {
                    min: Some(400),
                    max: None,
                }],
                ..LayerAttributes::default()
            },
            ..Layer::default()
        });
        glyph.layers.push(Layer {
            associated_master_id: Some("master01".to_string()),
            attributes: LayerAttributes {
                coordinates: vec![OrderedFloat(500.0)],
                ..LayerAttributes::default()
            },
            ..Layer::default()
        });
        glyph.smart_component_axes.insert("Width".into(), 0..=100);
        source.glyphs.insert("A".into(), glyph);

        let report = import_report(&source);

        assert_eq!(report.losses.len(), 3);
        assert_eq!(report.losses[0].kind, ImportLossKind::Omitted);
        assert!(report.losses[0].message.contains("bracket layers"));
        assert_eq!(report.losses[1].kind, ImportLossKind::Approximated);
        assert!(report.losses[1].message.contains("intermediate-layer"));
        assert_eq!(report.losses[2].kind, ImportLossKind::Approximated);
        assert!(report.losses[2].message.contains("smart-component"));
    }
}
