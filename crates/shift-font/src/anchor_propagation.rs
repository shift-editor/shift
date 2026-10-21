//! Copies component anchors into composites, as Glyphs.app does and fontc compiles.
//!
//! A plain-data port of fontir 1.0's `anchors_traversing_components`, which
//! fontc keeps private. It works on one glyph at one location and leaves the
//! recursion through component glyphs to the caller, so the editor can run it
//! on live geometry. Kept line for line with fontir; `shift-backends` tests it
//! against fontc's propagation on real fonts.

use indexmap::IndexMap;
use kurbo::{Affine, Point, Vec2};

use crate::ir::Transform;

/// A named anchor position in a glyph's own coordinates.
#[derive(Clone, Debug, PartialEq)]
pub struct PropagationAnchor {
    pub name: String,
    pub x: f64,
    pub y: f64,
}

/// One component of a composite, as propagation reads it.
#[derive(Clone, Copy, Debug)]
pub struct PropagationComponent<'a> {
    /// The component glyph's anchors after its own propagation; `None` when the glyph is missing.
    pub anchors: Option<&'a [PropagationAnchor]>,
    /// How many base glyphs the component glyph counts, for numbering ligature anchors.
    pub base_glyph_count: usize,
    /// Where the component sits in the composite.
    pub transform: Transform,
}

/// A glyph's own anchors and components, and the category facts propagation reads.
#[derive(Clone, Copy, Debug)]
pub struct PropagationGlyph<'a> {
    pub anchors: &'a [PropagationAnchor],
    pub components: &'a [PropagationComponent<'a>],
    /// A mark that has anchors keeps exactly its own.
    pub is_mark: bool,
    /// A ligature numbers its components' anchors: `top` becomes `top_1`, `top_2`.
    pub is_ligature: bool,
}

/// A glyph's anchors with its components' anchors copied in.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct PropagatedAnchors {
    pub anchors: Vec<PropagationAnchor>,
    /// How many base glyphs this glyph counts, for composites built on it.
    pub base_glyph_count: usize,
}

/// Returns a glyph's anchors as export compiles them.
///
/// fontc rewrites only composites' anchors: a glyph without components keeps
/// its own anchors as authored (an `*origin` anchor included), while its base
/// count still comes from propagation.
pub fn compiled_anchors(glyph: &PropagationGlyph) -> PropagatedAnchors {
    let propagated = propagate_anchors(glyph);
    if glyph.components.is_empty() {
        PropagatedAnchors {
            anchors: glyph.anchors.to_vec(),
            ..propagated
        }
    } else {
        propagated
    }
}

/// Returns a glyph's anchors with its components' anchors copied in.
///
/// Each component's anchors move with it; a mark component's `_name` anchor
/// is dropped and its own `name` anchor replaces the base's, so marks stack; a
/// flipped component swaps `top`/`bottom`, `left`/`right`, and `entry`/`exit`;
/// ligature components number their anchors; a glyph's own anchors win over
/// copied ones; and an `*origin` anchor shifts the glyph's own anchors.
/// Components must already be propagated. Shift components carry no explicit
/// attachment anchor, so fontir's renaming for one never applies.
pub fn propagate_anchors(glyph: &PropagationGlyph) -> PropagatedAnchors {
    let existing_anchors = glyph.anchors;
    if existing_anchors.is_empty() && glyph.components.is_empty() {
        return PropagatedAnchors::default();
    }

    // If this is a mark and it has anchors, just return them
    // (as in, don't even look at the components)
    if !existing_anchors.is_empty() && glyph.is_mark {
        return PropagatedAnchors {
            anchors: origin_adjusted_anchors(existing_anchors).collect(),
            base_glyph_count: 0,
        };
    }

    let mut has_underscore = existing_anchors
        .iter()
        .any(|anchor| anchor.name.starts_with('_'));

    let mut number_of_base_glyphs = 0usize;
    // An index map keeps Python's ordering: replacing a name keeps its place.
    let mut all_anchors: IndexMap<String, PropagationAnchor> = IndexMap::new();

    for (component_idx, component) in glyph.components.iter().enumerate() {
        let Some(anchors) = component.anchors else {
            continue;
        };
        let component_number_of_base_glyphs = component.base_glyph_count;

        let comb_has_underscore = anchors
            .iter()
            .any(|a| a.name.len() >= 2 && a.name.starts_with('_'));
        let comb_has_exit = anchors.iter().any(|a| a.name.starts_with("exit"));

        if !(comb_has_underscore | comb_has_exit) {
            // delete exit anchors we may have taken from earlier components
            // (since a glyph should only have one exit anchor, and logically its at the end)
            all_anchors.retain(|name, _| !name.starts_with("exit"));
        }

        let transform = Affine::from(component.transform);
        let scale = get_xy_rotation(transform);
        for anchor in anchors {
            let new_has_underscore = anchor.name.starts_with('_');
            if (component_idx > 0 || has_underscore) && new_has_underscore {
                continue;
            }
            // skip entry anchors on non-first glyphs
            if component_idx > 0 && anchor.name.starts_with("entry") {
                continue;
            }

            let mut new_anchor_name = rename_anchor_for_scale(&anchor.name, scale);
            if glyph.is_ligature
                && component_number_of_base_glyphs > 0
                && !new_has_underscore
                && !(new_anchor_name.starts_with("exit") || new_anchor_name.starts_with("entry"))
            {
                // dealing with marks like top_1 on a ligature
                new_anchor_name = make_liga_anchor_name(&new_anchor_name, number_of_base_glyphs);
            }

            let mut anchor = anchor.clone();
            apply_transform_to_anchor(&mut anchor, transform);
            anchor.name = new_anchor_name;
            all_anchors.insert(anchor.name.clone(), anchor);
            has_underscore |= new_has_underscore;
        }
        number_of_base_glyphs += component_number_of_base_glyphs;
    }

    // now we've handled all the anchors from components, so copy over anchors
    // that were explicitly defined
    all_anchors.extend(origin_adjusted_anchors(existing_anchors).map(|a| (a.name.clone(), a)));

    // Calculate this glyph's base count from its anchors (for ligature numbering)
    let mut component_count_from_anchors = 0;
    let mut has_underscore_anchor = false;
    let mut has_mark_anchor = false;

    for name in all_anchors.keys() {
        has_underscore_anchor |= name.starts_with('_');
        has_mark_anchor |= name.chars().next().unwrap_or('\0').is_ascii_alphabetic();

        // Count components based on numbered anchors like top_3
        if let Some((_, suffix)) = name.split_once('_').filter(|_| {
            !glyph.is_ligature
                && number_of_base_glyphs == 0
                && !name.starts_with('_')
                && !name.starts_with("entry")
                && !name.starts_with("exit")
        }) {
            // Carets count space between components, so the last caret is n_components - 1
            let maybe_add_one = if name.starts_with("caret") { 1 } else { 0 };
            let anchor_index = suffix.parse::<usize>().unwrap_or(0) + maybe_add_one;
            component_count_from_anchors = component_count_from_anchors.max(anchor_index);
        }
    }

    // If no underscore anchors and no base glyphs yet, but has mark anchors, set to 1
    if !has_underscore_anchor && number_of_base_glyphs == 0 && has_mark_anchor {
        number_of_base_glyphs += 1;
    }
    number_of_base_glyphs = number_of_base_glyphs.max(component_count_from_anchors);

    // Remove anchors from the opposite side of where this mark attaches
    if existing_anchors.iter().any(|a| a.name == "_bottom") {
        all_anchors.shift_remove("top");
        all_anchors.shift_remove("_top");
    }
    if existing_anchors.iter().any(|a| a.name == "_top") {
        all_anchors.shift_remove("bottom");
        all_anchors.shift_remove("_bottom");
    }

    PropagatedAnchors {
        anchors: all_anchors.into_values().collect(),
        base_glyph_count: number_of_base_glyphs,
    }
}

/// Returns an iterator over anchors, accounting for a possible "*origin" anchor
///
/// If that anchor is present it will be used to adjust the positions of other
/// anchors, and will not be included in the output.
fn origin_adjusted_anchors(
    anchors: &[PropagationAnchor],
) -> impl Iterator<Item = PropagationAnchor> + '_ {
    let origin = anchors
        .iter()
        .find(|a| a.name == "*origin")
        .map(|a| (a.x, a.y))
        .unwrap_or_default();
    anchors
        .iter()
        .filter(|a| a.name != "*origin")
        .cloned()
        .map(move |mut a| {
            a.x -= origin.0;
            a.y -= origin.1;
            a
        })
}

/// Returns a vec2 where for each axis a negative value indicates that axis is flipped
fn get_xy_rotation(xform: Affine) -> Vec2 {
    // this is based on examining the behaviour of glyphs via the macro panel
    // and careful testing.
    let [xx, xy, ..] = xform.as_coeffs();
    // first take the rotation
    let angle = libm::atan2(xy, xx);
    // then remove the rotation, and take the scale
    let rotated = xform.pre_rotate(-angle).as_coeffs();
    let mut scale = Vec2::new(rotated[0], rotated[3]);
    // then invert the scale if the rotation was >= 180°
    if (angle.to_degrees() - 180.0).abs() < 0.001 {
        scale *= -1.0;
    }

    scale
}

/// Apply the transform and round to avoid floating point errors
fn apply_transform_to_anchor(anchor: &mut PropagationAnchor, transform: Affine) {
    const ROUND_TO: f64 = 1e6;
    let mut pos = (transform * Point::new(anchor.x, anchor.y)).to_vec2();
    pos *= ROUND_TO;
    pos = pos.round();
    pos /= ROUND_TO;
    anchor.x = pos.x;
    anchor.y = pos.y;
}

/// Rename anchor for ligatures: top -> top_1, top_2 -> top_3, etc
fn make_liga_anchor_name(name: &str, base_number: usize) -> String {
    match name.split_once('_') {
        // if this anchor already has a number (like 'top_2') we want to consider that
        Some((name, suffix)) => {
            let suffix = base_number + suffix.parse::<usize>().unwrap_or(1);
            format!("{name}_{suffix}")
        }
        // otherwise we're turning 'top' into 'top_N'
        None => format!("{name}_{}", base_number + 1),
    }
}

/// If a component is rotated, flip bottom/top, left/right, entry/exit
fn rename_anchor_for_scale(name: &str, scale: Vec2) -> String {
    // swap the two words in the target, if they're present
    fn swap_pair(s: &mut String, one: &str, two: &str) {
        fn replace(s: &mut String, target: &str, by: &str) -> bool {
            if let Some(idx) = s.find(target) {
                s.replace_range(idx..idx + target.len(), by);
                return true;
            }
            false
        }
        // once we swap 'left' for 'right' we don't want to then check for 'right'!
        if !replace(s, one, two) {
            replace(s, two, one);
        }
    }

    let mut name = name.to_string();
    if scale.x >= 0. && scale.y >= 0. {
        return name;
    }
    if scale.y < 0. {
        swap_pair(&mut name, "bottom", "top");
    }
    if scale.x < 0. {
        swap_pair(&mut name, "left", "right");
        swap_pair(&mut name, "exit", "entry");
    }
    name
}

#[cfg(test)]
mod tests {
    use super::*;

    fn anchor(name: &str, x: f64, y: f64) -> PropagationAnchor {
        PropagationAnchor {
            name: name.to_string(),
            x,
            y,
        }
    }

    #[test]
    fn a_mark_stacks_and_the_composite_keeps_the_base_s_other_anchors() {
        let base = [anchor("top", 250.0, 500.0), anchor("bottom", 250.0, 0.0)];
        let acute = [anchor("_top", 100.0, 500.0), anchor("top", 100.0, 700.0)];
        let components = [
            PropagationComponent {
                anchors: Some(&base),
                base_glyph_count: 1,
                transform: Transform::identity(),
            },
            PropagationComponent {
                anchors: Some(&acute),
                base_glyph_count: 0,
                transform: Transform::translate(150.0, 0.0),
            },
        ];

        let propagated = compiled_anchors(&PropagationGlyph {
            anchors: &[],
            components: &components,
            is_mark: false,
            is_ligature: false,
        });

        assert_eq!(
            propagated.anchors,
            vec![anchor("top", 250.0, 700.0), anchor("bottom", 250.0, 0.0)]
        );
        assert_eq!(propagated.base_glyph_count, 1);
    }
}
