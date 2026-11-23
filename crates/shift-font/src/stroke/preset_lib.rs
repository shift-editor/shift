//! Font-level named stroke style presets, stored in the font lib.
//!
//! Each preset has a stable string id, a user-visible name, and an
//! [`OutlineStrokeStyle`]. Contours reference a preset by id through
//! [`ContourStrokeEntry::style_id`]; the reference is for display and
//! management only — the contour also stores the resolved style inline so
//! the solver never needs a font-level lookup on the hot path.

use std::collections::BTreeMap;

use crate::ir::lib_data::LibValue;
use crate::stroke::layer_lib::{outline_style_from_lib, outline_style_to_lib};
use crate::stroke::style::OutlineStrokeStyle;
use crate::{CoreError, CoreResult, Font};

/// Font lib key holding the stroke preset list.
pub const STROKE_PRESETS_LIB_KEY: &str = "com.shift.strokePresets";

/// A named stroke style a font keeps at the font level.
///
/// Contours that belong to this preset carry the preset's id in their
/// [`ContourStrokeEntry::style_id`] and also store the style inline.
#[derive(Clone, Debug, PartialEq)]
#[cfg_attr(feature = "pack", derive(pack::Pack))]
pub struct StrokePreset {
    /// Caller-minted stable identifier; never changes after creation.
    pub id: String,
    /// User-visible label; can be renamed.
    pub name: String,
    /// The style parameters this preset defines.
    pub style: OutlineStrokeStyle,
}

impl StrokePreset {
    /// Serialises this preset to a [`LibValue`] dict the font lib stores.
    pub fn to_lib(&self) -> LibValue {
        let style_value = outline_style_to_lib(self.style);
        LibValue::Dict(BTreeMap::from([
            ("id".to_string(), LibValue::String(self.id.clone())),
            ("name".to_string(), LibValue::String(self.name.clone())),
            ("style".to_string(), style_value),
        ]))
    }

    /// Reads a preset from a [`LibValue`] dict, or returns `None` on any
    /// malformed field.
    pub fn from_lib(value: &LibValue) -> Option<Self> {
        let LibValue::Dict(fields) = value else {
            return None;
        };
        let id = match fields.get("id")? {
            LibValue::String(s) => s.clone(),
            _ => return None,
        };
        let name = match fields.get("name")? {
            LibValue::String(s) => s.clone(),
            _ => return None,
        };
        let style = outline_style_from_lib(fields.get("style")?)?;
        Some(Self { id, name, style })
    }
}

/// The ordered list of named stroke presets stored in a font's lib.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct FontStrokePresetLib {
    pub presets: Vec<StrokePreset>,
}

impl FontStrokePresetLib {
    /// Serialises the preset list to the value stored under
    /// [`STROKE_PRESETS_LIB_KEY`].
    pub fn to_lib(&self) -> LibValue {
        LibValue::Array(self.presets.iter().map(StrokePreset::to_lib).collect())
    }

    /// Reads the preset list from the value stored under
    /// [`STROKE_PRESETS_LIB_KEY`], or returns `None` for any malformed value.
    ///
    /// An absent key reads as `None`; the font then has no presets.
    pub fn from_lib(value: &LibValue) -> Option<Self> {
        let LibValue::Array(items) = value else {
            return None;
        };
        let presets = items
            .iter()
            .map(StrokePreset::from_lib)
            .collect::<Option<Vec<_>>>()?;
        Some(Self { presets })
    }

    /// Whether the list contains a preset with this id.
    pub fn contains(&self, id: &str) -> bool {
        self.presets.iter().any(|p| p.id == id)
    }

    /// The preset with the given id, or `None`.
    pub fn find(&self, id: &str) -> Option<&StrokePreset> {
        self.presets.iter().find(|p| p.id == id)
    }

    /// Mutable ref to the preset with the given id, or `None`.
    fn find_mut(&mut self, id: &str) -> Option<&mut StrokePreset> {
        self.presets.iter_mut().find(|p| p.id == id)
    }
}

// — Font methods ————————————————————————————————————————————————————————————

impl Font {
    /// The font's named stroke presets, in creation order.
    ///
    /// Returns an empty list when the font stores none, or when the lib value
    /// is malformed (e.g. hand-edited).
    pub fn stroke_presets(&self) -> Vec<StrokePreset> {
        self.lib()
            .get(STROKE_PRESETS_LIB_KEY)
            .and_then(FontStrokePresetLib::from_lib)
            .map(|lib| lib.presets)
            .unwrap_or_default()
    }

    /// Reads the full preset lib (presets + order) from the font lib.
    fn stroke_preset_lib(&self) -> FontStrokePresetLib {
        self.lib()
            .get(STROKE_PRESETS_LIB_KEY)
            .and_then(FontStrokePresetLib::from_lib)
            .unwrap_or_default()
    }

    /// Writes `lib` back to the font lib, or removes the key when empty.
    fn set_stroke_preset_lib(&mut self, lib: FontStrokePresetLib) {
        if lib.presets.is_empty() {
            self.lib_mut().remove(STROKE_PRESETS_LIB_KEY);
        } else {
            self.lib_mut()
                .set(STROKE_PRESETS_LIB_KEY.to_string(), lib.to_lib());
        }
    }

    /// Adds a new preset.
    ///
    /// # Errors
    ///
    /// Returns [`CoreError::DuplicateStrokePresetId`] when a preset with
    /// `id` already exists, and [`CoreError::StrokeOperationFailed`] when
    /// the style is invalid.
    pub(crate) fn apply_create_stroke_preset(
        &mut self,
        id: String,
        name: String,
        style: OutlineStrokeStyle,
    ) -> CoreResult<()> {
        style.require_valid()?;
        let mut lib = self.stroke_preset_lib();
        if lib.contains(&id) {
            return Err(CoreError::DuplicateStrokePresetId(id));
        }
        lib.presets.push(StrokePreset { id, name, style });
        self.set_stroke_preset_lib(lib);
        Ok(())
    }

    /// Renames an existing preset.
    ///
    /// # Errors
    ///
    /// Returns [`CoreError::StrokePresetNotFound`] when no preset has `id`.
    pub(crate) fn apply_rename_stroke_preset(
        &mut self,
        id: &str,
        name: String,
    ) -> CoreResult<()> {
        let mut lib = self.stroke_preset_lib();
        let preset = lib
            .find_mut(id)
            .ok_or_else(|| CoreError::StrokePresetNotFound(id.to_string()))?;
        preset.name = name;
        self.set_stroke_preset_lib(lib);
        Ok(())
    }

    /// Removes a preset.
    ///
    /// Contours that referenced this preset by id keep their inline style;
    /// their `style_id` becomes an orphaned reference. The caller is
    /// responsible for cleaning those up when desired.
    ///
    /// # Errors
    ///
    /// Returns [`CoreError::StrokePresetNotFound`] when no preset has `id`.
    pub(crate) fn apply_delete_stroke_preset(&mut self, id: &str) -> CoreResult<()> {
        let mut lib = self.stroke_preset_lib();
        let before = lib.presets.len();
        lib.presets.retain(|p| p.id != id);
        if lib.presets.len() == before {
            return Err(CoreError::StrokePresetNotFound(id.to_string()));
        }
        self.set_stroke_preset_lib(lib);
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::stroke::style::{StrokeCap, StrokeJoin};

    fn sample_style() -> OutlineStrokeStyle {
        OutlineStrokeStyle {
            width: 50.0,
            cap: StrokeCap::Round,
            join: StrokeJoin::Miter,
            miter_limit: 4.0,
            position: 0.0,
        }
    }

    #[test]
    fn preset_round_trips_through_lib() {
        let preset = StrokePreset {
            id: "abc123".to_string(),
            name: "Hairline".to_string(),
            style: sample_style(),
        };
        let value = preset.to_lib();
        let restored = StrokePreset::from_lib(&value);
        assert_eq!(restored, Some(preset));
    }

    #[test]
    fn font_preset_lib_round_trips_through_lib() {
        let lib = FontStrokePresetLib {
            presets: vec![
                StrokePreset {
                    id: "p1".to_string(),
                    name: "Light".to_string(),
                    style: OutlineStrokeStyle::round(20.0),
                },
                StrokePreset {
                    id: "p2".to_string(),
                    name: "Bold".to_string(),
                    style: sample_style(),
                },
            ],
        };
        let value = lib.to_lib();
        let restored = FontStrokePresetLib::from_lib(&value);
        assert_eq!(restored, Some(lib));
    }

    #[test]
    fn empty_preset_lib_round_trips() {
        let lib = FontStrokePresetLib::default();
        let value = lib.to_lib();
        let restored = FontStrokePresetLib::from_lib(&value);
        assert_eq!(restored, Some(lib));
    }

    #[test]
    fn from_lib_returns_none_for_non_array() {
        assert_eq!(
            FontStrokePresetLib::from_lib(&LibValue::String("not-an-array".to_string())),
            None
        );
    }

    #[test]
    fn from_lib_returns_none_when_any_entry_is_malformed() {
        let malformed = LibValue::Array(vec![
            StrokePreset {
                id: "good".to_string(),
                name: "Good".to_string(),
                style: OutlineStrokeStyle::round(10.0),
            }
            .to_lib(),
            LibValue::String("bad".to_string()),
        ]);
        assert_eq!(FontStrokePresetLib::from_lib(&malformed), None);
    }
}
