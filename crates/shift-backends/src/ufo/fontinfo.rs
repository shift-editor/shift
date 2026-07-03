//! Tolerant `fontinfo.plist` handling.
//!
//! norad deserializes fontinfo with `deny_unknown_fields`, so a single
//! non-spec key would fail the whole UFO load. Shift instead splits fontinfo
//! into the keys norad models and an unknown remainder: the known part flows
//! through norad, the unknown part is carried in the fontinfo remainder
//! passthrough and merged back into the written `fontinfo.plist` on save.

use crate::errors::{FormatBackendError, FormatBackendResult};
use std::path::{Path, PathBuf};

/// Splits a fontinfo dictionary into the keys norad models and the unknown
/// remainder. A key norad models but whose value it cannot parse is a hard
/// error, matching norad's own verdict on the file.
pub(crate) fn partition_fontinfo(
    dict: plist::Dictionary,
    context: &str,
) -> FormatBackendResult<(plist::Dictionary, plist::Dictionary)> {
    let mut known = plist::Dictionary::new();
    let mut unknown = plist::Dictionary::new();

    for (key, value) in dict {
        let mut probe = plist::Dictionary::new();
        probe.insert(key.clone(), value.clone());

        match plist::from_value::<norad::FontInfo>(&plist::Value::Dictionary(probe)) {
            Ok(_) => {
                known.insert(key, value);
            }
            Err(error) if is_unknown_field(&error) => {
                unknown.insert(key, value);
            }
            Err(error) => {
                return Err(FormatBackendError::Ufo(format!(
                    "invalid {context} value for key {key:?}: {error}"
                )));
            }
        }
    }

    Ok((known, unknown))
}

fn is_unknown_field(error: &plist::Error) -> bool {
    error.to_string().contains("unknown field")
}

/// Checks that a carried fontinfo remainder can be written back out as
/// `fontinfo.plist`. Callers that load persisted font state run this where
/// the state is created, so a tampered remainder surfaces at load time
/// instead of failing the next save.
pub fn validate_fontinfo_remainder(remainder: &shift_font::LibData) -> FormatBackendResult<()> {
    if remainder.is_empty() {
        return Ok(());
    }

    let dict = super::writer::UfoWriter::convert_lib(remainder);
    let (known, _unknown) = partition_fontinfo(dict, "preserved fontinfo")?;
    plist::from_value::<norad::FontInfo>(&plist::Value::Dictionary(known))
        .map(|_| ())
        .map_err(|e| FormatBackendError::Ufo(format!("invalid preserved fontinfo data: {e}")))
}

/// Loads a UFO through norad even when `fontinfo.plist` carries keys norad
/// does not model. Returns the loaded font, the unknown fontinfo keys, and —
/// when a sanitized shadow was needed — the temp directory backing the load,
/// which must stay alive until the font's lazy data/images stores have been
/// consumed.
pub(crate) fn load_norad_font_tolerant(
    ufo_path: &Path,
) -> FormatBackendResult<(norad::Font, plist::Dictionary, Option<tempfile::TempDir>)> {
    let load =
        |path: &Path| norad::Font::load(path).map_err(|e| FormatBackendError::Ufo(e.to_string()));

    let fontinfo_path = ufo_path.join("fontinfo.plist");
    if !fontinfo_path.exists() {
        return Ok((load(ufo_path)?, plist::Dictionary::new(), None));
    }

    let fontinfo = plist::Value::from_file(&fontinfo_path)
        .map_err(|e| FormatBackendError::Ufo(format!("failed to parse fontinfo.plist: {e}")))?;
    let plist::Value::Dictionary(dict) = fontinfo else {
        return Err(FormatBackendError::Ufo(
            "fontinfo.plist is not a dictionary".to_string(),
        ));
    };

    let (known, unknown) = partition_fontinfo(dict, "fontinfo.plist")?;
    if unknown.is_empty() {
        return Ok((load(ufo_path)?, unknown, None));
    }

    let (shadow, shadow_ufo) = shadow_ufo_with_fontinfo(ufo_path, known)?;
    Ok((load(&shadow_ufo)?, unknown, Some(shadow)))
}

/// Builds a temp-directory view of the UFO whose `fontinfo.plist` holds only
/// the norad-known keys; every other entry points at the real UFO, so no
/// glyph or binary data is copied.
fn shadow_ufo_with_fontinfo(
    ufo_path: &Path,
    known: plist::Dictionary,
) -> FormatBackendResult<(tempfile::TempDir, PathBuf)> {
    let io = |action: &str, e: std::io::Error| {
        FormatBackendError::Ufo(format!(
            "failed to {action} for tolerant fontinfo load of '{}': {e}",
            ufo_path.display()
        ))
    };

    let real = std::fs::canonicalize(ufo_path).map_err(|e| io("resolve UFO path", e))?;
    let file_name = real
        .file_name()
        .ok_or_else(|| FormatBackendError::Ufo(format!("invalid UFO path '{}'", real.display())))?;

    let shadow = tempfile::Builder::new()
        .prefix(".shift-ufo-fontinfo-")
        .tempdir()
        .map_err(|e| io("create shadow directory", e))?;
    let shadow_ufo = shadow.path().join(file_name);
    std::fs::create_dir(&shadow_ufo).map_err(|e| io("create shadow UFO directory", e))?;

    for entry in std::fs::read_dir(&real).map_err(|e| io("read UFO directory", e))? {
        let entry = entry.map_err(|e| io("read UFO directory", e))?;
        if entry.file_name() == "fontinfo.plist" {
            continue;
        }
        link_entry(&entry.path(), &shadow_ufo.join(entry.file_name()))
            .map_err(|e| io("mirror UFO entry", e))?;
    }

    plist::Value::Dictionary(known)
        .to_file_xml(shadow_ufo.join("fontinfo.plist"))
        .map_err(|e| {
            FormatBackendError::Ufo(format!("failed to write sanitized fontinfo.plist: {e}"))
        })?;

    Ok((shadow, shadow_ufo))
}

#[cfg(unix)]
fn link_entry(source: &Path, destination: &Path) -> std::io::Result<()> {
    std::os::unix::fs::symlink(source, destination)
}

// Windows symlinks need elevated privileges; this path is only reached for
// UFOs with unknown fontinfo keys, so a plain copy is acceptable there.
#[cfg(not(unix))]
fn link_entry(source: &Path, destination: &Path) -> std::io::Result<()> {
    if source.is_dir() {
        for entry in std::fs::read_dir(source)? {
            let entry = entry?;
            std::fs::create_dir_all(destination)?;
            link_entry(&entry.path(), &destination.join(entry.file_name()))?;
        }
        Ok(())
    } else {
        std::fs::copy(source, destination).map(|_| ())
    }
}

/// Merges the unknown fontinfo keys into a written `fontinfo.plist`. norad
/// cannot represent them, so they are re-applied to the staged file after
/// norad has serialized the known fields.
pub(crate) fn merge_unknown_fontinfo(
    fontinfo_path: &Path,
    unknown: &plist::Dictionary,
) -> FormatBackendResult<()> {
    if unknown.is_empty() {
        return Ok(());
    }

    let mut dict = if fontinfo_path.exists() {
        match plist::Value::from_file(fontinfo_path).map_err(|e| {
            FormatBackendError::Ufo(format!("failed to parse staged fontinfo.plist: {e}"))
        })? {
            plist::Value::Dictionary(dict) => dict,
            _ => plist::Dictionary::new(),
        }
    } else {
        plist::Dictionary::new()
    };

    for (key, value) in unknown {
        dict.insert(key.clone(), value.clone());
    }

    plist::Value::Dictionary(dict)
        .to_file_xml(fontinfo_path)
        .map_err(|e| FormatBackendError::Ufo(format!("failed to write staged fontinfo.plist: {e}")))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn partitions_unknown_keys_away_from_norad_known_keys() {
        let mut dict = plist::Dictionary::new();
        dict.insert("familyName".into(), plist::Value::String("Test".into()));
        dict.insert(
            "openTypeOS2WeightClass".into(),
            plist::Value::Integer(400.into()),
        );
        dict.insert(
            "com.example.customTool".into(),
            plist::Value::String("kept".into()),
        );

        let (known, unknown) = partition_fontinfo(dict, "fontinfo.plist").unwrap();

        assert!(known.contains_key("familyName"));
        assert!(known.contains_key("openTypeOS2WeightClass"));
        assert_eq!(
            unknown.get("com.example.customTool"),
            Some(&plist::Value::String("kept".into()))
        );
        assert_eq!(unknown.len(), 1);
    }

    #[test]
    fn known_key_with_invalid_value_is_a_hard_error() {
        let mut dict = plist::Dictionary::new();
        dict.insert(
            "openTypeOS2WeightClass".into(),
            plist::Value::String("heavy".into()),
        );

        let error = partition_fontinfo(dict, "preserved fontinfo")
            .expect_err("invalid value for a norad-known key should fail");
        assert!(
            error.to_string().contains("openTypeOS2WeightClass"),
            "unexpected error: {error}"
        );
    }

    #[test]
    fn validate_accepts_unknown_keys_and_rejects_unwritable_known_keys() {
        let mut valid = shift_font::LibData::new();
        valid.set(
            "com.example.customTool".to_string(),
            shift_font::LibValue::String("kept".to_string()),
        );
        valid.set(
            "openTypeOS2WeightClass".to_string(),
            shift_font::LibValue::Integer(700),
        );
        validate_fontinfo_remainder(&valid).expect("unknown keys are writable");

        let mut tampered = shift_font::LibData::new();
        tampered.set(
            "openTypeOS2WeightClass".to_string(),
            shift_font::LibValue::String("heavy".to_string()),
        );
        let error = validate_fontinfo_remainder(&tampered)
            .expect_err("a remainder norad cannot write must be rejected");
        assert!(
            error.to_string().contains("openTypeOS2WeightClass"),
            "unexpected error: {error}"
        );
    }
}
