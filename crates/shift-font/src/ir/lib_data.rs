use serde::{Deserialize, Serialize};
use std::collections::HashMap;

#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
pub struct LibData {
    data: HashMap<String, LibValue>,
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
    Array(Vec<LibValue>),
    Dict(HashMap<String, LibValue>),
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
            data: HashMap::new(),
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

    pub fn into_inner(self) -> HashMap<String, LibValue> {
        self.data
    }

    pub fn from_map(data: HashMap<String, LibValue>) -> Self {
        Self { data }
    }
}

impl From<HashMap<String, LibValue>> for LibData {
    fn from(data: HashMap<String, LibValue>) -> Self {
        Self { data }
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
