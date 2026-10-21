use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};

/// Font lib key listing glyphs that are drawn but not exported (UFO
/// `public.skipExportGlyphs`). Glyphs sources fill it from each glyph's
/// export flag.
pub const SKIP_EXPORT_GLYPHS: &str = "public.skipExportGlyphs";

#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
pub struct LibData {
    data: BTreeMap<String, LibValue>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(tag = "type", content = "value", rename_all = "camelCase")]
pub enum LibValue {
    String(String),
    Integer(i64),
    /// Unsigned integers above `i64::MAX`; anything smaller uses `Integer`.
    UnsignedInteger(u64),
    Float(f64),
    Boolean(bool),
    Array(Vec<Self>),
    Dict(BTreeMap<String, Self>),
    Data(Vec<u8>),
    /// A plist date, carried as the RFC 3339 / ISO 8601 string used by XML
    /// plists (`plist::Date::to_xml_format`), e.g. `2024-02-02T02:02:02Z`.
    Date(String),
    /// A plist archive UID payload. XML plists cannot represent UIDs, so this
    /// only occurs in binary plists; it is carried verbatim.
    Uid(u64),
}

impl LibData {
    pub fn new() -> Self {
        Self {
            data: BTreeMap::new(),
        }
    }

    pub fn is_empty(&self) -> bool {
        self.data.is_empty()
    }

    pub fn len(&self) -> usize {
        self.data.len()
    }

    pub fn get(&self, key: &str) -> Option<&LibValue> {
        self.data.get(key)
    }

    pub fn set(&mut self, key: String, value: LibValue) {
        self.data.insert(key, value);
    }

    pub fn remove(&mut self, key: &str) -> Option<LibValue> {
        self.data.remove(key)
    }

    pub fn keys(&self) -> impl Iterator<Item = &String> {
        self.data.keys()
    }

    pub fn iter(&self) -> impl Iterator<Item = (&String, &LibValue)> {
        self.data.iter()
    }

    pub fn into_inner(self) -> BTreeMap<String, LibValue> {
        self.data
    }

    /// Returns the glyph names listed under [`SKIP_EXPORT_GLYPHS`].
    pub fn skipped_export_glyphs(&self) -> std::collections::HashSet<&str> {
        let Some(LibValue::Array(names)) = self.get(SKIP_EXPORT_GLYPHS) else {
            return std::collections::HashSet::new();
        };
        names
            .iter()
            .filter_map(|name| match name {
                LibValue::String(name) => Some(name.as_str()),
                _ => None,
            })
            .collect()
    }

    pub fn from_map(data: impl IntoIterator<Item = (String, LibValue)>) -> Self {
        Self {
            data: data.into_iter().collect(),
        }
    }
}

impl From<BTreeMap<String, LibValue>> for LibData {
    fn from(data: BTreeMap<String, LibValue>) -> Self {
        Self { data }
    }
}

impl FromIterator<(String, LibValue)> for LibData {
    fn from_iter<I: IntoIterator<Item = (String, LibValue)>>(data: I) -> Self {
        Self::from_map(data)
    }
}

impl<'a> IntoIterator for &'a LibData {
    type Item = (&'a String, &'a LibValue);
    type IntoIter = std::collections::btree_map::Iter<'a, String, LibValue>;

    fn into_iter(self) -> Self::IntoIter {
        self.data.iter()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn lib_data_operations() {
        let mut lib = LibData::new();
        assert!(lib.is_empty());

        lib.set("key1".to_string(), LibValue::String("value1".to_string()));
        lib.set("key2".to_string(), LibValue::Integer(42));

        assert_eq!(lib.len(), 2);
        assert!(matches!(lib.get("key1"), Some(LibValue::String(s)) if s == "value1"));
        assert!(matches!(lib.get("key2"), Some(LibValue::Integer(42))));

        lib.remove("key1");
        assert_eq!(lib.len(), 1);
    }
}
