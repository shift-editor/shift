use serde::de::Error as _;
use serde::{Deserialize, Deserializer, Serialize};

const SHORT_ID_ALPHABET: &[u8; 64] =
    b"useandom-26T198340PX75pxJACKVERYMINDBUSHWOLF_GQZbfghjklqvwyzrict";
const SHORT_ID_SUFFIX_LENGTH: usize = 10;
#[expect(
    clippy::cast_possible_truncation,
    reason = "the alphabet has 64 characters"
)]
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

/// The impls every id type shares, whatever holds its text.
macro_rules! id_impls {
    ($name:ident, $prefix:literal) => {
        impl Default for $name {
            fn default() -> Self {
                Self::new()
            }
        }

        impl $name {
            pub fn new() -> Self {
                Self::from_text(&prefixed_id($prefix))
            }

            pub fn from_raw(raw: impl std::fmt::Display) -> Self {
                let raw = raw.to_string();
                if raw.starts_with(concat!($prefix, "_")) {
                    Self::from_text(&raw)
                } else {
                    Self::from_text(&format!("{}_{raw}", $prefix))
                }
            }
        }

        impl std::fmt::Display for $name {
            fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                f.write_str(self.as_str())
            }
        }

        impl From<$name> for String {
            fn from(id: $name) -> Self {
                id.as_str().to_owned()
            }
        }

        impl std::str::FromStr for $name {
            type Err = InvalidEntityId;

            fn from_str(s: &str) -> Result<Self, Self::Err> {
                if s.starts_with(concat!($prefix, "_")) {
                    Ok(Self::from_text(s))
                } else {
                    Err(InvalidEntityId {
                        expected_prefix: $prefix,
                        value: s.to_string(),
                    })
                }
            }
        }

        impl Serialize for $name {
            fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
            where
                S: serde::Serializer,
            {
                serializer.serialize_str(self.as_str())
            }
        }

        /// Stored as its text, so `params![glyph.id()]` and `row.get("glyph_id")`
        /// need no conversion at the call site.
        #[cfg(feature = "rusqlite")]
        impl rusqlite::types::ToSql for $name {
            fn to_sql(&self) -> rusqlite::Result<rusqlite::types::ToSqlOutput<'_>> {
                Ok(rusqlite::types::ToSqlOutput::from(self.as_str()))
            }
        }

        /// Read back as [`Self::from_raw`] does, so stored ids keep reading
        /// exactly as before.
        #[cfg(feature = "rusqlite")]
        impl rusqlite::types::FromSql for $name {
            fn column_result(
                value: rusqlite::types::ValueRef<'_>,
            ) -> rusqlite::types::FromSqlResult<Self> {
                value.as_str().map(Self::from_raw)
            }
        }

        impl<'de> Deserialize<'de> for $name {
            fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
            where
                D: Deserializer<'de>,
            {
                let value = <std::borrow::Cow<'de, str>>::deserialize(deserializer)?;
                value.parse().map_err(D::Error::custom)
            }
        }
    };
}

/// An id that owns its text: one per entity inside a layer, freed with the layer.
macro_rules! typed_id {
    ($name:ident, $prefix:literal) => {
        #[derive(Debug, Clone, PartialEq, Eq, Hash, Ord, PartialOrd)]
        pub struct $name(std::sync::Arc<str>);

        impl $name {
            pub fn as_str(&self) -> &str {
                &self.0
            }

            fn from_text(text: &str) -> Self {
                Self(text.into())
            }
        }

        id_impls!($name, $prefix);
    };
}

/// An id whose text is interned: every copy of the same id in the process
/// points at one [`IdText`], so it compares and hashes by address.
///
/// For font-level ids (glyphs, layers, sources, axes and the like), whose
/// number grows with the font, not with its content. Interned text is never
/// freed, so ids minted per point or contour stay [`typed_id!`] ids.
macro_rules! interned_id {
    ($name:ident, $prefix:literal) => {
        #[derive(Clone, Copy, PartialEq, Eq, Hash)]
        pub struct $name(IdText);

        impl std::fmt::Debug for $name {
            fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                f.debug_tuple(stringify!($name)).field(&self.0).finish()
            }
        }

        impl $name {
            pub fn as_str(self) -> &'static str {
                self.0.as_str()
            }

            fn from_text(text: &str) -> Self {
                Self(IdText::intern(text))
            }
        }

        /// By text, not address, so ordered collections and everything
        /// serialized from them keep the same order in every process.
        impl Ord for $name {
            fn cmp(&self, other: &Self) -> std::cmp::Ordering {
                self.0.cmp(&other.0)
            }
        }

        impl PartialOrd for $name {
            fn partial_cmp(&self, other: &Self) -> Option<std::cmp::Ordering> {
                Some(self.cmp(other))
            }
        }

        id_impls!($name, $prefix);
    };
}

/// The text of an interned id, held once per process for its lifetime.
///
/// A thin pointer, so an id is one word. Equal texts always intern to the
/// same allocation, so equality and hashing use the address; ordering
/// compares the text.
#[derive(Clone, Copy)]
pub(crate) struct IdText(&'static InternedText);

/// Interned text behind one more box, so a reference to it is thin.
struct InternedText(Box<str>);

impl IdText {
    /// The interned copy of `text`, interning it on first use.
    fn intern(text: &str) -> Self {
        type Texts = std::collections::HashMap<&'static str, &'static InternedText>;
        static TEXTS: std::sync::OnceLock<std::sync::Mutex<Texts>> = std::sync::OnceLock::new();
        let mut texts = TEXTS
            .get_or_init(Default::default)
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        if let Some(&interned) = texts.get(text) {
            return Self(interned);
        }
        let interned: &'static InternedText = Box::leak(Box::new(InternedText(text.into())));
        texts.insert(&interned.0, interned);
        Self(interned)
    }

    fn as_str(self) -> &'static str {
        &self.0.0
    }
}

impl std::fmt::Debug for IdText {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        std::fmt::Debug::fmt(self.as_str(), f)
    }
}

impl PartialEq for IdText {
    fn eq(&self, other: &Self) -> bool {
        std::ptr::eq(self.0, other.0)
    }
}

impl Eq for IdText {}

impl std::hash::Hash for IdText {
    fn hash<H: std::hash::Hasher>(&self, state: &mut H) {
        std::ptr::hash(self.0, state);
    }
}

impl Ord for IdText {
    fn cmp(&self, other: &Self) -> std::cmp::Ordering {
        if self == other {
            return std::cmp::Ordering::Equal;
        }
        self.as_str().cmp(other.as_str())
    }
}

impl PartialOrd for IdText {
    fn partial_cmp(&self, other: &Self) -> Option<std::cmp::Ordering> {
        Some(self.cmp(other))
    }
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

/// Encodes a stable 64-bit FNV-1a hash of `namespace` and `name` in the short-ID alphabet.
fn derived_id_suffix(namespace: &str, name: &str) -> String {
    const FNV_OFFSET_BASIS: u64 = 0xcbf2_9ce4_8422_2325;
    const FNV_PRIME: u64 = 0x0100_0000_01b3;

    let bytes = namespace
        .bytes()
        .chain(std::iter::once(0))
        .chain(name.bytes());
    let hash = bytes.fold(FNV_OFFSET_BASIS, |hash, byte| {
        (hash ^ u64::from(byte)).wrapping_mul(FNV_PRIME)
    });

    (0..SHORT_ID_SUFFIX_LENGTH)
        .map(|index| {
            #[expect(
                clippy::cast_possible_truncation,
                reason = "keeps the low byte, which the mask cuts to six bits"
            )]
            let bits = (hash >> (index * 6)) as u8 & SHORT_ID_ALPHABET_MASK;
            SHORT_ID_ALPHABET[bits as usize] as char
        })
        .collect()
}

typed_id!(PointId, "point");
typed_id!(ContourId, "contour");
typed_id!(ComponentId, "component");
typed_id!(AnchorId, "anchor");
typed_id!(GuidelineId, "guideline");
interned_id!(LayerId, "layer");
interned_id!(GlyphId, "glyph");

impl GlyphId {
    /// Derives the ID a glyph read from a font source gets on import.
    ///
    /// Every reader of the same source derives the same ID for the same glyph name, so
    /// glyphs keep their identity when a preview is converted into a document. Glyphs
    /// created while editing still use [`GlyphId::new`].
    ///
    /// `source_key` identifies the source font, such as its canonical path, so same-named
    /// glyphs from different fonts get different IDs. `name` must be unique within the source.
    pub fn from_source(source_key: &str, name: &str) -> Self {
        Self::from_text(&format!("glyph_{}", derived_id_suffix(source_key, name)))
    }
}
interned_id!(SourceId, "source");
interned_id!(AxisId, "axis");
interned_id!(AxisLabelId, "axisLabel");
interned_id!(AxisMappingId, "axisMapping");
interned_id!(NamedInstanceId, "namedInstance");
interned_id!(KerningGroupId, "kerningGroup");
interned_id!(MetricId, "metric");

#[derive(Clone, Debug, Eq, PartialEq, Hash)]
pub enum GlyphEntityId {
    Contour(ContourId),
    Point(PointId),
    Component(ComponentId),
    Anchor(AnchorId),
    Guideline(GuidelineId),
}

/// Converts each id, and each entity holding one, into a [`GlyphEntityId`].
macro_rules! glyph_entities {
    ($($variant:ident($id:ty, $entity:ty)),+ $(,)?) => {
        $(
            impl From<$id> for GlyphEntityId {
                fn from(id: $id) -> Self {
                    Self::$variant(id)
                }
            }

            impl From<&$entity> for GlyphEntityId {
                fn from(entity: &$entity) -> Self {
                    Self::$variant(entity.id())
                }
            }
        )+
    };
}

glyph_entities! {
    Contour(ContourId, crate::Contour),
    Point(PointId, crate::Point),
    Component(ComponentId, crate::Component),
    Anchor(AnchorId, crate::Anchor),
    Guideline(GuidelineId, crate::Guideline),
}

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

    #[test]
    fn source_glyph_id_is_stable_for_the_same_source_and_name() {
        let first = GlyphId::from_source("/fonts/Mutator.ufo", "A");
        let second = GlyphId::from_source("/fonts/Mutator.ufo", "A");

        assert_eq!(first, second);
        let suffix = first.as_str().strip_prefix("glyph_").unwrap();
        assert_eq!(suffix.len(), SHORT_ID_SUFFIX_LENGTH);
        assert!(suffix.bytes().all(|byte| SHORT_ID_ALPHABET.contains(&byte)));
    }

    #[test]
    fn source_glyph_id_differs_across_sources_and_names() {
        let a = GlyphId::from_source("/fonts/Mutator.ufo", "A");

        assert_ne!(a, GlyphId::from_source("/fonts/Other.ufo", "A"));
        assert_ne!(a, GlyphId::from_source("/fonts/Mutator.ufo", "B"));
    }

    #[test]
    fn interned_ids_with_the_same_text_share_one_copy() {
        let minted = LayerId::new();
        let parsed: LayerId = minted.as_str().parse().unwrap();

        assert_eq!(minted, parsed);
        assert!(std::ptr::eq(minted.as_str(), parsed.as_str()));
    }

    #[test]
    fn interned_ids_order_by_text_whatever_order_they_were_interned_in() {
        let later = GlyphId::from_raw("zz_interned_first");
        let earlier = GlyphId::from_raw("aa_interned_second");

        assert!(earlier < later);
        let ordered: std::collections::BTreeSet<GlyphId> = [later, earlier].into();
        assert_eq!(ordered.into_iter().collect::<Vec<_>>(), [earlier, later]);
    }

    #[test]
    fn interned_ids_serialize_as_their_text() {
        let id = SourceId::from_raw("serde");
        let json = serde_json::to_string(&id).unwrap();

        assert_eq!(json, "\"source_serde\"");
        assert_eq!(serde_json::from_str::<SourceId>(&json).unwrap(), id);
    }
}
