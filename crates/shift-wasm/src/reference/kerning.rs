//! Kerning precedence, as `Kerning::resolve` applies it.

use serde::{Deserialize, Serialize};
use shift_font::{
    GlyphId, Kerning, KerningGroup, KerningGroupId, KerningPair, KerningPosition, KerningSide,
    SourceId,
};
use tsify::{Ts, Tsify};
use wasm_bindgen::prelude::*;

/// Kerning groups and pairs; the editor's `KerningSnapshot` satisfies this.
#[derive(Deserialize, Tsify)]
pub struct ReferenceKerning {
    groups: Vec<ReferenceKerningGroup>,
    sources: Vec<ReferenceSourceKerning>,
}

#[derive(Deserialize, Tsify)]
#[serde(rename_all = "camelCase")]
pub struct ReferenceKerningGroup {
    id: String,
    position: ReferenceKerningPosition,
    name: String,
    glyph_ids: Vec<String>,
}

#[derive(Deserialize, Tsify)]
#[serde(rename_all = "lowercase")]
pub enum ReferenceKerningPosition {
    First,
    Second,
}

#[derive(Deserialize, Tsify)]
#[serde(rename_all = "camelCase")]
pub struct ReferenceSourceKerning {
    source_id: String,
    pairs: Vec<ReferenceKerningPair>,
}

#[derive(Deserialize, Tsify)]
pub struct ReferenceKerningPair {
    first: ReferenceKerningSide,
    second: ReferenceKerningSide,
    amount: f64,
}

#[derive(Deserialize, Tsify)]
pub struct ReferenceKerningSide {
    kind: ReferenceKerningSideKind,
    id: String,
}

#[derive(Deserialize, Tsify)]
#[serde(rename_all = "lowercase")]
pub enum ReferenceKerningSideKind {
    Glyph,
    Group,
}

/// Pair values to set, or remove when `amount` is absent, applied in order;
/// the editor's `KerningValueEdit[]` satisfies this.
#[derive(Deserialize, Tsify)]
#[serde(transparent)]
pub struct ReferenceKerningEdits(Vec<ReferenceKerningEdit>);

#[derive(Deserialize, Tsify)]
#[serde(rename_all = "camelCase")]
pub struct ReferenceKerningEdit {
    source_id: String,
    first: ReferenceKerningSide,
    second: ReferenceKerningSide,
    #[tsify(optional)]
    amount: Option<f64>,
}

/// The pair that applies, by side id, and its value; the editor's
/// `ResolvedKerning` has the same shape.
#[derive(Serialize, Tsify)]
pub struct ReferenceResolvedKerning {
    first: String,
    second: String,
    amount: f64,
}

/// `Kerning::resolve` for `first` then `second` at `sourceId`, after `edits`
/// are applied with `set_value` and `remove_value`; undefined when no pair
/// applies.
#[wasm_bindgen(js_name = resolveKerning)]
pub fn resolve_kerning(
    kerning: Ts<ReferenceKerning>,
    edits: Ts<ReferenceKerningEdits>,
    source_id: &str,
    first: &str,
    second: &str,
) -> Result<Option<Ts<ReferenceResolvedKerning>>, JsError> {
    let mut kerning = kerning_from(kerning.to_rust()?)?;
    for edit in edits.to_rust()?.0 {
        let source_id = SourceId::from_raw(edit.source_id);
        let pair = KerningPair::new(side(edit.first), side(edit.second));
        match edit.amount {
            Some(amount) => kerning.set_value(source_id, pair, amount),
            None => kerning.remove_value(&source_id, &pair),
        };
    }
    let resolved = kerning.resolve(
        &SourceId::from_raw(source_id),
        &GlyphId::from_raw(first),
        &GlyphId::from_raw(second),
    );
    let Some(resolved) = resolved else {
        return Ok(None);
    };
    Ok(Some(
        ReferenceResolvedKerning {
            first: side_id(&resolved.pair.first),
            second: side_id(&resolved.pair.second),
            amount: resolved.value,
        }
        .into_ts()?,
    ))
}

fn kerning_from(data: ReferenceKerning) -> Result<Kerning, JsError> {
    let mut kerning = Kerning::new();
    for group in data.groups {
        let position = match group.position {
            ReferenceKerningPosition::First => KerningPosition::First,
            ReferenceKerningPosition::Second => KerningPosition::Second,
        };
        let members = group.glyph_ids.into_iter().map(GlyphId::from_raw).collect();
        kerning.set_group(
            KerningGroupId::from_raw(group.id),
            KerningGroup::new(position, group.name, members),
        )?;
    }
    for source in data.sources {
        let source_id = SourceId::from_raw(source.source_id);
        for pair in source.pairs {
            kerning.set_value(
                source_id.clone(),
                KerningPair::new(side(pair.first), side(pair.second)),
                pair.amount,
            );
        }
    }
    Ok(kerning)
}

fn side(side: ReferenceKerningSide) -> KerningSide {
    match side.kind {
        ReferenceKerningSideKind::Glyph => KerningSide::Glyph(GlyphId::from_raw(side.id)),
        ReferenceKerningSideKind::Group => KerningSide::Group(KerningGroupId::from_raw(side.id)),
    }
}

fn side_id(side: &KerningSide) -> String {
    match side {
        KerningSide::Glyph(glyph_id) => glyph_id.to_string(),
        KerningSide::Group(group_id) => group_id.to_string(),
    }
}
