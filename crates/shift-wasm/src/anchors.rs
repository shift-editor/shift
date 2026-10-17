//! Anchor rules: kinds, propagation into composites, and anchored placement.
//!
//! Propagation and placement take and return numbers in the layouts
//! documented on each function; anchor names are interned ids ([`crate::names`]).

use fontir::ir::AnchorKind as IrAnchorKind;
use serde::Serialize;
use shift_font::anchor_attachment::{follow_anchors, AnchorLike, FollowingComponent};
use shift_font::anchor_propagation::{
    compiled_anchors, PropagationAnchor, PropagationComponent, PropagationGlyph,
};
use shift_font::{ComponentAlignment, DecomposedTransform, Transform};
use tsify::{Ts, Tsify};
use wasm_bindgen::prelude::*;

use crate::names::{with_names, NameTable};
use crate::reader::Reader;

/// An anchor's role in mark positioning, as export reads its name.
#[derive(Serialize, Tsify)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum AnchorKind {
    /// `top`: marks attach here.
    Base { group: String },
    /// `_top`: attaches the mark to a base's `top`.
    Mark { group: String },
    /// `top_2`: marks attach to the second component of a ligature.
    Ligature { group: String, index: u32 },
    /// `_3`: a ligature component with no anchors of its own.
    ComponentMarker { index: u32 },
    /// `caret_1`: a caret position inside a ligature.
    Caret { index: u32 },
    /// `vcaret_1`: a vertical caret position inside a ligature.
    Vcaret { index: u32 },
    /// Where the previous glyph's exit joins, in cursive attachment.
    Entry,
    /// Where the next glyph's entry joins.
    Exit,
    /// A name export rejects, such as `_`, `top_0`, or `_top_1`.
    Invalid,
}

/// Returns the kind fontc reads from an anchor name.
#[wasm_bindgen(js_name = anchorKind)]
pub fn anchor_kind(name: &str) -> Result<Ts<AnchorKind>, JsError> {
    let index = |index: usize| u32::try_from(index).unwrap_or(u32::MAX);
    let kind = match IrAnchorKind::new(name) {
        Ok(IrAnchorKind::Base(group)) => AnchorKind::Base {
            group: group.to_string(),
        },
        Ok(IrAnchorKind::Mark(group)) => AnchorKind::Mark {
            group: group.to_string(),
        },
        Ok(IrAnchorKind::Ligature {
            group_name,
            index: number,
        }) => AnchorKind::Ligature {
            group: group_name.to_string(),
            index: index(number),
        },
        Ok(IrAnchorKind::ComponentMarker(number)) => AnchorKind::ComponentMarker {
            index: index(number),
        },
        Ok(IrAnchorKind::Caret(number)) => AnchorKind::Caret {
            index: index(number),
        },
        Ok(IrAnchorKind::VCaret(number)) => AnchorKind::Vcaret {
            index: index(number),
        },
        Ok(IrAnchorKind::CursiveEntry) => AnchorKind::Entry,
        Ok(IrAnchorKind::CursiveExit) => AnchorKind::Exit,
        Err(_) => AnchorKind::Invalid,
    };
    Ok(kind.into_ts()?)
}

/// Propagates one glyph's anchors at one location, as export compiles them.
///
/// Input: `isMark, isLigature, ownCount, (name, x, y)×ownCount, componentCount`,
/// then per component `hasAnchors, baseGlyphCount, xx, xy, yx, yy, dx, dy,
/// anchorCount, (name, x, y)×anchorCount`. Output: `baseGlyphCount, count,
/// (name, x, y)×count`. Names are interned ids.
#[wasm_bindgen(js_name = propagateAnchors)]
pub fn propagate_anchors(input: &[f64]) -> Vec<f64> {
    let mut output = Vec::new();
    with_names(|names| {
        let mut read = Reader::new(input);
        let is_mark = read.flag();
        let is_ligature = read.flag();
        let own = read_named(&mut read, &*names);
        let component_count = read.count();
        let mut bases = Vec::with_capacity(component_count);
        for _ in 0..component_count {
            let has_anchors = read.flag();
            let base_glyph_count = read.count();
            let transform = Transform {
                xx: read.number(),
                xy: read.number(),
                yx: read.number(),
                yy: read.number(),
                dx: read.number(),
                dy: read.number(),
            };
            let anchors = read_named(&mut read, &*names);
            bases.push((has_anchors.then_some(anchors), base_glyph_count, transform));
        }
        let components: Vec<_> = bases
            .iter()
            .map(
                |(anchors, base_glyph_count, transform)| PropagationComponent {
                    anchors: anchors.as_deref(),
                    base_glyph_count: *base_glyph_count,
                    transform: *transform,
                },
            )
            .collect();

        let propagated = compiled_anchors(&PropagationGlyph {
            anchors: &own,
            components: &components,
            is_mark,
            is_ligature,
        });
        output.push(propagated.base_glyph_count as f64);
        output.push(propagated.anchors.len() as f64);
        for anchor in propagated.anchors {
            output.extend([f64::from(names.id(&anchor.name)), anchor.x, anchor.y]);
        }
    });
    output
}

/// Places a composite's components after an edit, anchored ones on their anchors.
///
/// Input: `count`, then per component `alignment (0 unset, 1 anchored, 2 free),
/// hasAccepted, transform×9, acceptedTransform×9, anchorCount, (name, x, y)×,
/// acceptedAnchorCount, (name, x, y)×`, transforms decomposed in interpolation
/// order and anchors the component glyph's own, a name of -1 for an unnamed
/// one. Output: per component `alignment, transform×9`.
#[wasm_bindgen(js_name = followAnchors)]
pub fn follow_anchors_in(input: &[f64]) -> Vec<f64> {
    let mut output = Vec::new();
    with_names(|names| {
        let mut read = Reader::new(input);
        let count = read.count();
        let mut parts = Vec::with_capacity(count);
        for _ in 0..count {
            let alignment = match read.count() {
                1 => ComponentAlignment::Anchored,
                2 => ComponentAlignment::Free,
                _ => ComponentAlignment::Unset,
            };
            let has_accepted = read.flag();
            let transform = read_transform(&mut read);
            let accepted = read_transform(&mut read);
            let anchors = read_points(&mut read);
            let accepted_anchors = read_points(&mut read);
            parts.push((
                alignment,
                transform,
                has_accepted.then_some(accepted),
                anchors,
                accepted_anchors,
            ));
        }

        let lookup: &dyn NameTable = &*names;
        let points = |anchors: &[(f64, f64, f64)]| -> Vec<Point<'_>> {
            anchors
                .iter()
                .map(|&(name, x, y)| Point {
                    name: (name >= 0.0).then(|| lookup.name(name as u32)).flatten(),
                    x,
                    y,
                })
                .collect()
        };
        let resolved: Vec<_> = parts
            .iter()
            .map(|(_, _, _, anchors, accepted)| (points(anchors), points(accepted)))
            .collect();
        let components: Vec<_> = parts
            .iter()
            .zip(&resolved)
            .map(
                |((alignment, transform, accepted, _, _), (anchors, accepted_anchors))| {
                    FollowingComponent {
                        alignment: *alignment,
                        transform: *transform,
                        accepted_transform: *accepted,
                        anchors,
                        accepted_anchors,
                    }
                },
            )
            .collect();

        for follow in follow_anchors(&components) {
            output.push(match follow.alignment {
                ComponentAlignment::Unset => 0.0,
                ComponentAlignment::Anchored => 1.0,
                ComponentAlignment::Free => 2.0,
            });
            write_transform(&mut output, &follow.transform);
        }
    });
    output
}

/// An anchor whose name was looked up from its id.
struct Point<'a> {
    name: Option<&'a str>,
    x: f64,
    y: f64,
}

impl AnchorLike for Point<'_> {
    fn anchor_name(&self) -> Option<&str> {
        self.name
    }

    fn position(&self) -> (f64, f64) {
        (self.x, self.y)
    }
}

fn read_named(read: &mut Reader, names: &dyn NameTable) -> Vec<PropagationAnchor> {
    let count = read.count();
    (0..count)
        .filter_map(|_| {
            let name = names.name(read.count() as u32).map(str::to_string);
            let (x, y) = (read.number(), read.number());
            Some(PropagationAnchor { name: name?, x, y })
        })
        .collect()
}

fn read_points(read: &mut Reader) -> Vec<(f64, f64, f64)> {
    let count = read.count();
    (0..count)
        .map(|_| (read.number(), read.number(), read.number()))
        .collect()
}

fn read_transform(read: &mut Reader) -> DecomposedTransform {
    DecomposedTransform {
        translate_x: read.number(),
        translate_y: read.number(),
        rotation: read.number(),
        scale_x: read.number(),
        scale_y: read.number(),
        skew_x: read.number(),
        skew_y: read.number(),
        t_center_x: read.number(),
        t_center_y: read.number(),
    }
}

fn write_transform(output: &mut Vec<f64>, transform: &DecomposedTransform) {
    output.extend([
        transform.translate_x,
        transform.translate_y,
        transform.rotation,
        transform.scale_x,
        transform.scale_y,
        transform.skew_x,
        transform.skew_y,
        transform.t_center_x,
        transform.t_center_y,
    ]);
}
