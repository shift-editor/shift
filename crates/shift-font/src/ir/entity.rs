use serde::{Deserialize, Serialize};

const SHORT_ID_ALPHABET: &[u8; 64] =
    b"useandom-26T198340PX75pxJACKVERYMINDBUSHWOLF_GQZbfghjklqvwyzrict";
const SHORT_ID_SUFFIX_LENGTH: usize = 10;
const SHORT_ID_ALPHABET_MASK: u8 = (SHORT_ID_ALPHABET.len() - 1) as u8;

#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub struct EntityId(String);

impl EntityId {
    pub fn new() -> Self {
        Self(prefixed_id("entity"))
    }

    pub fn as_str(&self) -> &str {
        &self.0
    }

    pub fn from_raw(raw: impl std::fmt::Display) -> Self {
        Self(format!("entity_{raw}"))
    }
}

impl Default for EntityId {
    fn default() -> Self {
        Self::new()
    }
}

impl std::fmt::Display for EntityId {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(self.as_str())
    }
}

macro_rules! typed_id {
    ($name:ident, $prefix:literal) => {
        #[derive(Debug, Clone, PartialEq, Eq, Hash, Ord, PartialOrd, Serialize, Deserialize)]
        pub struct $name(String);

        impl Default for $name {
            fn default() -> Self {
                Self::new()
            }
        }

        impl $name {
            pub fn new() -> Self {
                Self(prefixed_id($prefix))
            }

            pub fn as_str(&self) -> &str {
                &self.0
            }

            pub fn from_raw(raw: impl std::fmt::Display) -> Self {
                let raw = raw.to_string();
                if raw.starts_with(concat!($prefix, "_")) {
                    Self(raw)
                } else {
                    Self(format!("{}_{raw}", $prefix))
                }
            }
        }

        impl std::fmt::Display for $name {
            fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                f.write_str(self.as_str())
            }
        }

        impl std::str::FromStr for $name {
            type Err = InvalidEntityId;

            fn from_str(s: &str) -> Result<Self, Self::Err> {
                if s.starts_with(concat!($prefix, "_")) {
                    Ok(Self(s.to_string()))
                } else {
                    Err(InvalidEntityId {
                        expected_prefix: $prefix,
                        value: s.to_string(),
                    })
                }
            }
        }
    };
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct InvalidEntityId {
    expected_prefix: &'static str,
    value: String,
}

impl std::fmt::Display for InvalidEntityId {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(
            f,
            "expected ID with prefix '{}_', got '{}'",
            self.expected_prefix, self.value
        )
    }
}

impl std::error::Error for InvalidEntityId {}

fn prefixed_id(prefix: &str) -> String {
    format!("{prefix}_{}", short_id_suffix())
}

fn short_id_suffix() -> String {
    let mut bytes = [0; SHORT_ID_SUFFIX_LENGTH];
    getrandom::fill(&mut bytes).expect("secure random ID generation failed");

    bytes
        .iter()
        .map(|byte| SHORT_ID_ALPHABET[(byte & SHORT_ID_ALPHABET_MASK) as usize] as char)
        .collect()
}

typed_id!(PointId, "point");
typed_id!(ContourId, "contour");
typed_id!(ComponentId, "component");
typed_id!(AnchorId, "anchor");
typed_id!(GuidelineId, "guideline");
typed_id!(LayerId, "layer");
typed_id!(GlyphId, "glyph");
typed_id!(SourceId, "source");
typed_id!(AxisId, "axis");
typed_id!(AxisLabelId, "axisLabel");
typed_id!(AxisMappingId, "axisMapping");
typed_id!(NamedInstanceId, "namedInstance");

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn entity_id_is_unique() {
        let id1 = EntityId::new();
        let id2 = EntityId::new();
        assert_ne!(id1, id2);
    }

    #[test]
    fn typed_id_new_uses_short_readable_suffix() {
        let id = SourceId::new();
        let Some(suffix) = id.as_str().strip_prefix("source_") else {
            panic!("source id should keep its typed prefix");
        };

        assert_eq!(suffix.len(), SHORT_ID_SUFFIX_LENGTH);
        assert!(suffix.bytes().all(|byte| SHORT_ID_ALPHABET.contains(&byte)));
    }

    #[test]
    fn typed_id_from_raw_roundtrip() {
        let original = PointId::new();
        let raw = original.as_str();
        let reconstructed = PointId::from_raw(raw);
        assert_eq!(original, reconstructed);
    }

    #[test]
    fn typed_id_display_and_parse() {
        let id = ContourId::from_raw("test");
        assert_eq!(id.to_string(), "contour_test");
        let parsed: ContourId = "contour_test".parse().unwrap();
        assert_eq!(id, parsed);
    }
}
