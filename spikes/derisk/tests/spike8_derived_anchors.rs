//! Spike 8: derived anchored composition.
//!
//! An anchored component's placement as a query over live anchors, instead
//! of a stored offset every anchor edit must rewrite. Checks that the query
//! reproduces what Shift stores today, that an anchor edit then needs one
//! write instead of one per composite, how deriving at an interpolated
//! location compares with blending stored offsets, and what a read costs.
//!
//! `cargo test --release --test spike8_derived_anchors -- --nocapture --test-threads=1`

use std::collections::HashMap;
use std::time::{Duration, Instant};

use shift_font::anchor_attachment::{follow_anchors, FollowingComponent};
use shift_font::{
    Anchor, ComponentAlignment, DecomposedTransform, DesignLocation, Font, FontIntent,
    FontIntentSet, GlyphId, GlyphLayer, LayerId,
};
use shift_workspace::{AcquireScope, FontWorkspace};

const FONTS: [&str; 4] = [
    "AnchorDragBench.glyphs",
    "AnchorPropagation.glyphs",
    "Homenaje.glyphs",
    "MutatorSansVariable.glyphs",
];

/// A fixture opened as a workspace with every glyph loaded.
fn loaded(name: &str) -> (tempfile::TempDir, Font) {
    let path = format!("{}/../../fixtures/fonts/{name}", env!("CARGO_MANIFEST_DIR"));
    let dir = tempfile::tempdir().unwrap();
    let mut workspace = FontWorkspace::open(&path, dir.path().join("w.sqlite")).unwrap();
    let glyphs: Vec<_> = workspace.font().glyphs().map(|glyph| glyph.id()).collect();
    workspace.acquire_glyphs(&glyphs, AcquireScope::ComponentClosure).unwrap();
    let font = workspace.font().clone();
    (dir, font)
}

/// Each component's base glyph anchors in `anchors_of`, which answers for one
/// glyph at the composite's source or location.
fn derive<'a>(
    layer: &GlyphLayer,
    anchors_of: &'a dyn Fn(&GlyphId) -> Vec<Anchor>,
) -> Vec<(DecomposedTransform, ComponentAlignment)> {
    derive_classified(layer, anchors_of, &HashMap::new())
}

/// Classifies every component once, as an import or migration would: an unset
/// component is attached exactly when it sits on its anchors in the font as it
/// arrived. Derivation then reads the stored classification, never "does it
/// happen to sit on its anchors now".
fn classify(font: &Font) -> HashMap<shift_font::ComponentId, ComponentAlignment> {
    let mut classes = HashMap::new();
    for (_, layer_id) in composite_layers(font) {
        let layer = font.layer(&layer_id).unwrap();
        let anchors_of = anchors_at_source(font, layer);
        for (component, (_, alignment)) in layer.components_iter().zip(derive(layer, &anchors_of)) {
            let class = match alignment {
                ComponentAlignment::Anchored => ComponentAlignment::Anchored,
                _ => ComponentAlignment::Free,
            };
            classes.insert(component.id(), class);
        }
    }
    classes
}

fn derive_classified<'a>(
    layer: &GlyphLayer,
    anchors_of: &'a dyn Fn(&GlyphId) -> Vec<Anchor>,
    classes: &HashMap<shift_font::ComponentId, ComponentAlignment>,
) -> Vec<(DecomposedTransform, ComponentAlignment)> {
    let anchors: Vec<Vec<Anchor>> = layer
        .components_iter()
        .map(|component| anchors_of(&component.base_glyph_id()))
        .collect();
    // The placement query: nothing was accepted before, so the rule places
    // every anchored component on the current anchors.
    let inputs: Vec<FollowingComponent<'_, Anchor>> = layer
        .components_iter()
        .zip(&anchors)
        .map(|(component, anchors)| FollowingComponent {
            alignment: classes.get(&component.id()).copied().unwrap_or(component.alignment()),
            transform: *component.transform(),
            accepted_transform: Some(*component.transform()),
            anchors,
            accepted_anchors: anchors,
        })
        .collect();
    follow_anchors(&inputs)
        .into_iter()
        .map(|following| (following.transform, following.alignment))
        .collect()
}

fn anchors_at_source<'f>(font: &'f Font, layer: &GlyphLayer) -> impl Fn(&GlyphId) -> Vec<Anchor> + 'f {
    let source = layer.source_id();
    move |glyph_id: &GlyphId| {
        font.glyph(glyph_id)
            .and_then(|glyph| glyph.layer_for_source(source.clone()))
            .map(|layer| layer.anchors().to_vec())
            .unwrap_or_default()
    }
}

fn composite_layers(font: &Font) -> Vec<(GlyphId, LayerId)> {
    font.glyphs()
        .flat_map(|glyph| {
            glyph
                .layers()
                .values()
                .filter(|layer| layer.components_iter().next().is_some())
                .map(|layer| (glyph.id(), layer.id()))
                .collect::<Vec<_>>()
        })
        .collect()
}

fn same(a: &DecomposedTransform, b: &DecomposedTransform) -> bool {
    (a.translate_x - b.translate_x).abs() < 1e-9 && (a.translate_y - b.translate_y).abs() < 1e-9
}

#[test]
fn a_derived_placement_reproduces_stored_offsets() {
    for name in FONTS {
        let (_dir, font) = loaded(name);
        let mut counts: HashMap<&str, usize> = HashMap::new();
        let mut examples = Vec::new();
        for (glyph_id, layer_id) in composite_layers(&font) {
            let layer = font.layer(&layer_id).unwrap();
            let anchors_of = anchors_at_source(&font, layer);
            let derived = derive(layer, &anchors_of);
            for (component, (transform, alignment)) in layer.components_iter().zip(derived) {
                let kind = match (component.alignment(), alignment) {
                    (ComponentAlignment::Free, _) => "free",
                    (ComponentAlignment::Anchored, _) => "anchored",
                    (ComponentAlignment::Unset, ComponentAlignment::Anchored) => "unset, on its anchors",
                    (ComponentAlignment::Unset, _) => "unset, off its anchors (stays put)",
                };
                *counts.entry(kind).or_default() += 1;
                if same(&transform, component.transform()) {
                    *counts.entry("derived == stored").or_default() += 1;
                } else {
                    *counts.entry("DERIVED != STORED").or_default() += 1;
                    if examples.len() < 3 {
                        let glyph = font.glyph(&glyph_id).unwrap().name().to_string();
                        examples.push(format!(
                            "{glyph}/{}: stored ({}, {}) derived ({}, {})",
                            component.base_glyph_name(),
                            component.transform().translate_x,
                            component.transform().translate_y,
                            transform.translate_x,
                            transform.translate_y,
                        ));
                    }
                }
            }
        }
        let mut counts: Vec<_> = counts.into_iter().collect();
        counts.sort();
        println!("A {name}: {counts:?}");
        for example in examples {
            println!("    {example}");
        }
    }
}

#[test]
fn b_an_anchor_edit_needs_one_write() {
    for name in ["AnchorDragBench.glyphs", "AnchorPropagation.glyphs", "Homenaje.glyphs"] {
        let (_dir, font) = loaded(name);
        // The base glyph with the most composites built on a named anchor.
        let mut uses: HashMap<GlyphId, usize> = HashMap::new();
        for (_, layer_id) in composite_layers(&font) {
            for component in font.layer(&layer_id).unwrap().components_iter() {
                *uses.entry(component.base_glyph_id()).or_default() += 1;
            }
        }
        let Some((base_layer, anchor)) = uses
            .iter()
            .filter_map(|(glyph_id, count)| {
                let glyph = font.glyph(glyph_id)?;
                let layer = glyph.layer_for_source(font.default_source_id()?)?;
                let anchor = layer.anchors().iter().find(|a| a.name().is_some_and(|n| !n.starts_with('_')))?;
                Some((*count, layer.id(), anchor.clone()))
            })
            .max_by_key(|(count, ..)| *count)
            .map(|(_, layer, anchor)| (layer, anchor))
        else {
            continue;
        };

        // Today: the edit rewrites every composite that follows the anchor.
        let mut eager = font.clone();
        let applied = eager
            .apply_intents(FontIntentSet {
                intents: vec![FontIntent::MoveAnchors {
                    layer_id: base_layer.clone(),
                    anchor_ids: vec![anchor.id()],
                    coords: vec![anchor.x() + 37.0, anchor.y() + 23.0],
                }],
            })
            .unwrap();

        // Derived: classify once (import), write only the base layer, then read placements.
        let classes = classify(&font);
        let mut derived_font = font.clone();
        let mut moved = derived_font.layer(&base_layer).unwrap().clone();
        moved.set_anchor_position(anchor.id(), anchor.x() + 37.0, anchor.y() + 23.0);
        derived_font.replace_glyph_layers(vec![moved]).unwrap();

        let mut followed = 0;
        let mut mismatched = 0;
        for (_, layer_id) in composite_layers(&eager) {
            let stored = eager.layer(&layer_id).unwrap();
            let layer = derived_font.layer(&layer_id).unwrap();
            let anchors_of = anchors_at_source(&derived_font, layer);
            for ((stored, original), (transform, _)) in stored
                .components_iter()
                .zip(font.layer(&layer_id).unwrap().components_iter())
                .zip(derive_classified(layer, &anchors_of, &classes))
            {
                if !same(stored.transform(), original.transform()) {
                    followed += 1;
                }
                if !same(&transform, stored.transform()) {
                    mismatched += 1;
                }
            }
        }
        println!(
            "B {name}: moving one anchor rewrote {} layers eagerly ({followed} components moved); \
             derived wrote 1 layer and matches eager on every component: {} ({mismatched} mismatches)",
            applied.layers.len(),
            mismatched == 0,
        );
        assert_eq!(mismatched, 0);
    }
}

#[test]
fn c_deriving_at_a_location_versus_blending_stored_offsets() {
    for name in ["MutatorSansVariable.glyphs", "AnchorDragBench.glyphs", "AnchorPropagation.glyphs"] {
        let (_dir, font) = loaded(name);
        if font.axes().is_empty() {
            println!("C {name}: not variable");
            continue;
        }
        let axes = font.axes().to_vec();
        let locations: Vec<DesignLocation> = (0..=4)
            .map(|step| {
                let mut location = DesignLocation::new();
                for axis in &axes {
                    let t = step as f64 / 4.0;
                    location.set(axis.id(), axis.minimum() + (axis.maximum() - axis.minimum()) * t);
                }
                location
            })
            .collect();
        let resolve = |glyph_id: &GlyphId, location: &DesignLocation| -> Option<GlyphLayer> {
            let projection = font.glyph_projection(glyph_id).ok()??;
            projection.interpolation()?.resolve(location, &axes).ok()
        };
        let mut compared = 0;
        let mut max_difference: f64 = 0.0;
        let mut worst = String::new();
        for glyph in font.glyphs() {
            for location in &locations {
                let Some(layer) = resolve(&glyph.id(), location) else { continue };
                if layer.components_iter().next().is_none() {
                    continue;
                }
                let anchors_of = |glyph_id: &GlyphId| {
                    resolve(glyph_id, location).map(|layer| layer.anchors().to_vec()).unwrap_or_default()
                };
                for (blended, (derived, alignment)) in layer.components_iter().zip(derive(&layer, &anchors_of)) {
                    if alignment != ComponentAlignment::Anchored {
                        continue;
                    }
                    compared += 1;
                    let difference = (blended.transform().translate_x - derived.translate_x)
                        .abs()
                        .max((blended.transform().translate_y - derived.translate_y).abs());
                    if difference > max_difference {
                        max_difference = difference;
                        worst = format!("{}/{} at {location:?}", glyph.name(), blended.base_glyph_name());
                    }
                }
            }
        }
        println!(
            "C {name}: {compared} anchored placements at {} locations; max |blended stored - derived at location| = {max_difference:.6} units{}",
            locations.len(),
            if max_difference > 1e-6 { format!(" (worst: {worst})") } else { String::new() },
        );
    }
}

#[test]
fn d_cost_of_a_derived_read() {
    for name in FONTS {
        let (_dir, font) = loaded(name);
        let layers = composite_layers(&font);
        let components: usize = layers
            .iter()
            .map(|(_, layer_id)| font.layer(layer_id).unwrap().components_iter().count())
            .sum();
        if components == 0 {
            continue;
        }
        let mut samples: Vec<Duration> = (0..9)
            .map(|_| {
                let started = Instant::now();
                for (_, layer_id) in &layers {
                    let layer = font.layer(layer_id).unwrap();
                    let anchors_of = anchors_at_source(&font, layer);
                    std::hint::black_box(derive(layer, &anchors_of));
                }
                started.elapsed()
            })
            .collect();
        samples.sort();
        let total = samples[samples.len() / 2];
        println!(
            "D {name}: {} composite layers, {components} components derived in {:.3} ms ({:.2} µs per component, anchors cloned)",
            layers.len(),
            total.as_secs_f64() * 1000.0,
            total.as_secs_f64() * 1e6 / components as f64,
        );
    }
}
