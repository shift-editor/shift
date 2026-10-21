//! Anchor rules: kinds, propagation into composites, and anchored placement.
//!
//! Propagation and placement take and return numbers in the layouts declared
//! here ([`crate::layout`]); anchor names are interned ids ([`crate::names`]).

use fontir::ir::AnchorKind as IrAnchorKind;
use serde::Serialize;
use shift_font::anchor_attachment::{self, AnchorLike, Following, follow_anchors};
use shift_font::anchor_propagation::{
    self, PropagatedAnchors, PropagationAnchor, compiled_anchors,
};
use shift_font::{ComponentAlignment, DecomposedTransform, Transform};
use tsify::{Ts, Tsify};
use wasm_bindgen::prelude::*;

use crate::layout::{call, enum_layout, foreign_layout, layout};

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
///
/// # Errors
///
/// Returns a [`JsError`] when the kind cannot be converted to a JavaScript value.
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
/// Input: a [`PropagationGlyph`]. Output: [`PropagatedAnchors`].
#[wasm_bindgen(js_name = propagateAnchors)]
pub fn propagate_anchors(input: &[f64]) -> Vec<f64> {
    call(input, |glyph: PropagationGlyph| {
        let components = glyph
            .components
            .iter()
            .map(|component| anchor_propagation::PropagationComponent {
                anchors: component.anchors.as_deref(),
                base_glyph_count: component.base_glyph_count,
                transform: component.transform,
            })
            .collect::<Vec<_>>();
        compiled_anchors(&anchor_propagation::PropagationGlyph {
            anchors: &glyph.anchors,
            components: &components,
            is_mark: glyph.is_mark,
            is_ligature: glyph.is_ligature,
        })
    })
}

/// Places a composite's components after an edit, anchored ones on their anchors.
///
/// Input: a list of [`FollowingComponent`]. Output: a list of [`Following`],
/// one per component.
#[wasm_bindgen(js_name = followAnchors)]
pub fn follow_anchors_in(input: &[f64]) -> Vec<f64> {
    call(input, |components: Vec<FollowingComponent>| {
        let components = components
            .iter()
            .map(|component| anchor_attachment::FollowingComponent {
                alignment: component.alignment,
                transform: component.transform,
                accepted_transform: component.accepted_transform,
                anchors: &component.anchors,
                accepted_anchors: &component.accepted_anchors,
            })
            .collect::<Vec<_>>();
        follow_anchors(&components)
    })
}

foreign_layout! {
    /// A named anchor position in a glyph's own coordinates.
    PropagationAnchor => PropagationAnchor {
        name: String,
        x: f64,
        y: f64,
    }
}

foreign_layout! {
    /// A glyph's anchors with its components' anchors copied in.
    PropagatedAnchors => PropagatedAnchors {
        anchors: Vec<PropagationAnchor>,
        /// How many base glyphs this glyph counts, for composites built on it.
        base_glyph_count: usize,
    }
}

foreign_layout! {
    /// An affine matrix: `x' = a·x + c·y + e`, `y' = b·x + d·y + f`.
    Transform => Matrix {
        xx: f64 => a,
        xy: f64 => b,
        yx: f64 => c,
        yy: f64 => d,
        dx: f64 => e,
        dy: f64 => f,
    }
}

foreign_layout! {
    /// A transform as its parts, in interpolation order.
    DecomposedTransform => DecomposedTransform {
        translate_x: f64,
        translate_y: f64,
        rotation: f64,
        scale_x: f64,
        scale_y: f64,
        skew_x: f64,
        skew_y: f64,
        t_center_x: f64,
        t_center_y: f64,
    }
}

enum_layout! {
    /// How a component was placed: by its anchors, by hand, or not recorded.
    ComponentAlignment {
        Unset => "unset",
        Anchored => "anchored",
        Free => "free",
    }
}

foreign_layout! {
    /// Where a component goes after an edit, and whether it is anchored.
    Following => Following {
        transform: DecomposedTransform,
        alignment: ComponentAlignment,
    }
}

layout! {
    /// One component of a composite, as propagation reads it.
    pub struct PropagationComponent {
        /// The component glyph's anchors after its own propagation; null when the glyph is missing.
        pub anchors: Option<Vec<PropagationAnchor>>,
        /// How many base glyphs the component glyph counts, for numbering ligature anchors.
        pub base_glyph_count: usize,
        /// Where the component sits in the composite.
        pub transform: Transform => matrix,
    }
}

layout! {
    /// A glyph's own anchors and components, and the category facts propagation reads.
    pub struct PropagationGlyph {
        pub anchors: Vec<PropagationAnchor>,
        pub components: Vec<PropagationComponent>,
        /// A mark that has anchors keeps exactly its own.
        pub is_mark: bool,
        /// A ligature numbers its components' anchors: `top` becomes `top_1`, `top_2`.
        pub is_ligature: bool,
    }
}

layout! {
    /// An anchor as alignment reads it.
    pub struct AlignmentAnchor {
        pub name: Option<String>,
        pub x: f64,
        pub y: f64,
    }
}

layout! {
    /// One component of a composite, as it is now and as the workspace last accepted it.
    pub struct FollowingComponent {
        /// As the workspace last accepted it.
        pub alignment: ComponentAlignment,
        pub transform: DecomposedTransform,
        /// Null for a component the edit added.
        pub accepted_transform: Option<DecomposedTransform>,
        /// The component glyph's own anchors now.
        pub anchors: Vec<AlignmentAnchor>,
        /// The component glyph's own anchors as last accepted.
        pub accepted_anchors: Vec<AlignmentAnchor>,
    }
}

impl AnchorLike for AlignmentAnchor {
    fn anchor_name(&self) -> Option<&str> {
        self.name.as_deref()
    }

    fn position(&self) -> shift_font::kurbo::Point {
        shift_font::kurbo::Point::new(self.x, self.y)
    }
}
