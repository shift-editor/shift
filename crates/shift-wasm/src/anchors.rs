//! Anchor rules: kinds, propagation into composites, and anchored placement.
//!
//! Propagation and placement are the [`Anchors`] interface, whose values
//! cross packed into numbers ([`pack`]); anchor names are interned ids
//! ([`crate::names`]).

use fontir::ir::AnchorKind as IrAnchorKind;
use pack::Pack;
use serde::Serialize;
use shift_font::anchor_attachment::{self, AnchorLike, Following, follow_anchors};
use shift_font::anchor_propagation::{
    self, PropagatedAnchors, PropagationAnchor, compiled_anchors,
};
use shift_font::{ComponentAlignment, DecomposedTransform, Transform};
use tsify::{Ts, Tsify};
use wasm_bindgen::prelude::*;

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

/// Anchor propagation and placement, as export and the workspace run them.
#[pack::interface]
pub trait Anchors {
    /// Propagates one glyph's anchors at one location, as export compiles them.
    fn propagate_anchors(&self, glyph: PropagationGlyph) -> PropagatedAnchors;
    /// Places a composite's components after an edit, anchored ones on their
    /// anchors; one placement per component.
    fn follow_anchors(&self, components: Vec<FollowingComponent>) -> Vec<Following>;
}

/// The anchor rules [`Anchors`] calls.
pub struct AnchorRules;

impl Anchors for AnchorRules {
    fn propagate_anchors(&self, glyph: PropagationGlyph) -> PropagatedAnchors {
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
    }

    fn follow_anchors(&self, components: Vec<FollowingComponent>) -> Vec<Following> {
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
    }
}

/// Runs one [`Anchors`] method for the editor's generated `Anchors` class.
#[wasm_bindgen(js_name = anchorsRequest)]
pub fn request(
    method: u32,
    input: &[f64],
    #[wasm_bindgen(unchecked_param_type = "readonly Uint8Array[] | undefined")] blobs: Option<
        js_sys::Array,
    >,
) -> Vec<f64> {
    crate::blobs::answer(blobs, |blobs, names| {
        anchors_request(&AnchorRules, method, input, blobs, names)
    })
}

/// One component of a composite, as propagation reads it.
#[derive(Clone, Debug, PartialEq, Pack)]
pub struct PropagationComponent {
    /// The component glyph's anchors after its own propagation; null when the glyph is missing.
    pub anchors: Option<Vec<PropagationAnchor>>,
    /// How many base glyphs the component glyph counts, for numbering ligature anchors.
    pub base_glyph_count: usize,
    /// Where the component sits in the composite.
    #[pack(rename = "matrix")]
    pub transform: Transform,
}

/// A glyph's own anchors and components, and the category facts propagation reads.
#[derive(Clone, Debug, PartialEq, Pack)]
pub struct PropagationGlyph {
    pub anchors: Vec<PropagationAnchor>,
    pub components: Vec<PropagationComponent>,
    /// A mark that has anchors keeps exactly its own.
    pub is_mark: bool,
    /// A ligature numbers its components' anchors: `top` becomes `top_1`, `top_2`.
    pub is_ligature: bool,
}

/// An anchor as alignment reads it.
#[derive(Clone, Debug, PartialEq, Pack)]
pub struct AlignmentAnchor {
    pub name: Option<String>,
    pub x: f64,
    pub y: f64,
}

/// One component of a composite, as it is now and as the workspace last accepted it.
#[derive(Clone, Debug, PartialEq, Pack)]
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

impl AnchorLike for AlignmentAnchor {
    fn anchor_name(&self) -> Option<&str> {
        self.name.as_deref()
    }

    fn position(&self) -> shift_font::kurbo::Point {
        shift_font::kurbo::Point::new(self.x, self.y)
    }
}
