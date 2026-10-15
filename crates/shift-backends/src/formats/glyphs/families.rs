//! Which family each Glyphs instance builds.
//!
//! One Glyphs source can build several families: an instance with its own
//! family name (Glyphs 3 `familyNames` property, Glyphs 2 `familyName`
//! custom parameter) belongs to that family, for example "Noto Sans Gujarati
//! UI" beside "Noto Sans Gujarati", or Lexend Deca beside Lexend. Shift holds
//! one family per font, so only the source's own family becomes named
//! instances. glyphs-reader keeps instance properties private, so the names
//! are read from the instance list in the file.

use std::collections::BTreeSet;
use std::path::Path;

use glyphs_reader::{Font as GlyphsFont, Plist};

use crate::{ImportLoss, ImportLossKind};

/// The family name each instance declares, in the source's instance order.
pub(crate) struct InstanceFamilies {
    /// `None` for an instance that declares no family of its own.
    declared: Vec<Option<String>>,
    family: Option<String>,
}

impl InstanceFamilies {
    /// Reads the family each instance of `font`, loaded from `path`, declares.
    ///
    /// When the instance list can't be read or doesn't line up with `font`'s
    /// instances, every instance counts as the source's own family, which is
    /// how Shift imported them before.
    pub(crate) fn read(path: &Path, font: &GlyphsFont) -> Self {
        let family = font.get_default_name("familyNames").map(str::to_string);
        let declared = declared_families(path)
            .filter(|declared| declared.len() == font.instances.len())
            .unwrap_or_else(|| vec![None; font.instances.len()]);
        Self { declared, family }
    }

    /// Whether the instance at `index` builds the source's own family.
    pub(crate) fn is_own(&self, index: usize) -> bool {
        match self.declared.get(index) {
            Some(Some(name)) => self.family.as_deref() == Some(name.as_str()),
            _ => true,
        }
    }

    /// The other families the source builds, by name.
    pub(crate) fn others(&self) -> BTreeSet<&str> {
        (0..self.declared.len())
            .filter(|index| !self.is_own(*index))
            .filter_map(|index| self.declared[index].as_deref())
            .collect()
    }

    /// Returns the import note for the families Shift leaves out, if any.
    pub(crate) fn loss(&self) -> Option<ImportLoss> {
        let others = self.others();
        if others.is_empty() {
            return None;
        }
        let names = others.into_iter().collect::<Vec<_>>().join(", ");
        Some(ImportLoss {
            kind: ImportLossKind::Omitted,
            message: format!(
                "This source also builds other families ({names}); Shift imports only its own family's instances."
            ),
        })
    }
}

/// Returns each instance's declared family, or `None` when the file has no
/// instance family names at all or can't be parsed.
fn declared_families(path: &Path) -> Option<Vec<Option<String>>> {
    let text = std::fs::read_to_string(instance_list_file(path)).ok()?;
    if !text.contains("familyName") {
        return None;
    }

    let plist = Plist::parse(&text).ok()?;
    let instances = plist.get("instances")?.as_array()?;
    Some(instances.iter().map(declared_family).collect())
}

/// The file holding the instance list: the `.glyphs` file itself, or a
/// package's `fontinfo.plist`.
fn instance_list_file(path: &Path) -> std::path::PathBuf {
    if path.is_dir() {
        path.join("fontinfo.plist")
    } else {
        path.to_path_buf()
    }
}

fn declared_family(instance: &Plist) -> Option<String> {
    let from_properties = instance
        .get("properties")
        .and_then(Plist::as_array)
        .into_iter()
        .flatten()
        .find(|property| property.get("key").and_then(Plist::as_str) == Some("familyNames"))
        .and_then(|property| property.get("values")?.as_array())
        .and_then(default_language_value);
    let from_parameter = || {
        instance
            .get("customParameters")
            .and_then(Plist::as_array)
            .into_iter()
            .flatten()
            .find(|parameter| parameter.get("name").and_then(Plist::as_str) == Some("familyName"))
            .and_then(|parameter| parameter.get("value")?.as_str())
            .map(str::to_string)
    };
    from_properties.or_else(from_parameter)
}

/// Picks the `dflt` value of a localized name, or the first one.
fn default_language_value(values: &[Plist]) -> Option<String> {
    let value = |entry: &Plist| entry.get("value")?.as_str().map(str::to_string);
    values
        .iter()
        .find(|entry| entry.get("language").and_then(Plist::as_str) == Some("dflt"))
        .and_then(value)
        .or_else(|| values.first().and_then(value))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_glyphs_3_family_properties_and_glyphs_2_parameters() {
        let plist = Plist::parse(
            r#"{instances = (
                {name = Regular;},
                {name = Regular; properties = ({key = familyNames; values = ({language = dflt; value = "Sans UI";});});},
                {name = Bold; customParameters = ({name = familyName; value = "Sans Deca";});}
            );}"#,
        )
        .unwrap();
        let declared = plist
            .get("instances")
            .unwrap()
            .as_array()
            .unwrap()
            .iter()
            .map(declared_family)
            .collect::<Vec<_>>();

        assert_eq!(
            declared,
            [
                None,
                Some("Sans UI".to_string()),
                Some("Sans Deca".to_string())
            ]
        );
    }

    #[test]
    fn an_instance_naming_the_source_family_belongs_to_it() {
        let families = InstanceFamilies {
            declared: vec![None, Some("Sans".into()), Some("Sans UI".into())],
            family: Some("Sans".into()),
        };

        assert!(families.is_own(0));
        assert!(families.is_own(1));
        assert!(!families.is_own(2));
        assert_eq!(families.others(), BTreeSet::from(["Sans UI"]));
    }
}
