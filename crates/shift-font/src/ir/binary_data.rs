use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

/// Opaque binary files carried with the font, keyed by relative path.
///
/// Mirrors the UFO `data/` and `images/` directories: the font model never
/// interprets these bytes, it only preserves them across load and save.
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
pub struct BinaryData {
    files: BTreeMap<String, Vec<u8>>,
}

impl BinaryData {
    pub fn new() -> Self {
        Self {
            files: BTreeMap::new(),
        }
    }

    pub fn is_empty(&self) -> bool {
        self.files.is_empty()
    }

    pub fn len(&self) -> usize {
        self.files.len()
    }

    pub fn get(&self, path: &str) -> Option<&[u8]> {
        self.files.get(path).map(Vec::as_slice)
    }

    pub fn insert(&mut self, path: String, bytes: Vec<u8>) {
        self.files.insert(path, bytes);
    }

    pub fn remove(&mut self, path: &str) -> Option<Vec<u8>> {
        self.files.remove(path)
    }

    pub fn paths(&self) -> impl Iterator<Item = &String> {
        self.files.keys()
    }

    pub fn iter(&self) -> impl Iterator<Item = (&String, &Vec<u8>)> {
        self.files.iter()
    }

    pub fn from_map(files: BTreeMap<String, Vec<u8>>) -> Self {
        Self { files }
    }

    pub fn into_inner(self) -> BTreeMap<String, Vec<u8>> {
        self.files
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn binary_data_operations() {
        let mut data = BinaryData::new();
        assert!(data.is_empty());

        data.insert("nested/blob.bin".to_string(), vec![0, 1, 2]);
        assert_eq!(data.len(), 1);
        assert_eq!(data.get("nested/blob.bin"), Some([0, 1, 2].as_slice()));

        data.remove("nested/blob.bin");
        assert!(data.is_empty());
    }
}
