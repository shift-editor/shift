//! Sibling order keys: fractional indexes that sort as plain strings.
//!
//! A scene node's `index` orders it among the nodes that share its parent. A
//! key between any two others always exists, so moving a node writes only that
//! node's key. Keys are the `fractional_index` crate's indexes in its string
//! form: lowercase hex, two characters per byte, so comparing two keys as
//! strings orders them as their bytes do.

use fractional_index::FractionalIndex;

/// Why no key could be made between two keys.
#[derive(Clone, Debug, Eq, PartialEq, thiserror::Error)]
pub enum IndexKeyError {
    /// A key is not a fractional index's string form.
    #[error("invalid index key {0:?}")]
    Invalid(String),
    /// The keys are equal or out of order, so nothing sorts between them.
    #[error("index key {before:?} does not sort before {after:?}")]
    Unordered { before: String, after: String },
}

/// Returns a key that sorts after `before` and before `after`.
///
/// `None` stands for the start of the list (`before`) or its end (`after`);
/// with neither, the first key.
///
/// # Errors
///
/// Returns [`IndexKeyError::Invalid`] when either key is malformed, and
/// [`IndexKeyError::Unordered`] when `before` does not sort before `after`.
pub fn between(before: Option<&str>, after: Option<&str>) -> Result<String, IndexKeyError> {
    let lower = before.map(parse).transpose()?;
    let upper = after.map(parse).transpose()?;
    let key = FractionalIndex::new(lower.as_ref(), upper.as_ref()).ok_or_else(|| {
        IndexKeyError::Unordered {
            before: before.unwrap_or_default().to_owned(),
            after: after.unwrap_or_default().to_owned(),
        }
    })?;
    Ok(key.to_string())
}

fn parse(key: &str) -> Result<FractionalIndex, IndexKeyError> {
    FractionalIndex::from_string(key).map_err(|_| IndexKeyError::Invalid(key.to_owned()))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn key(before: Option<&str>, after: Option<&str>) -> String {
        between(before, after).expect("a key between")
    }

    #[test]
    fn makes_a_key_between_any_two_neighbours() {
        let mut keys = vec![key(None, None)];
        for _ in 0..200 {
            let last = keys.last().cloned();
            keys.push(key(last.as_deref(), None));
        }
        let first = keys[0].clone();
        keys.insert(0, key(None, Some(&first)));
        for pair in keys.windows(2) {
            let middle = key(Some(&pair[0]), Some(&pair[1]));
            assert!(pair[0] < middle && middle < pair[1]);
        }
    }

    #[test]
    fn narrows_repeatedly_between_two_keys() {
        let high = key(None, None);
        let mut low = key(None, Some(&high));
        for _ in 0..100 {
            let middle = key(Some(&low), Some(&high));
            assert!(low < middle && middle < high);
            low = middle;
        }
    }

    #[test]
    fn orders_keys_as_strings_the_way_their_bytes_order() {
        let mut keys = vec![key(None, None)];
        for index in 0..300 {
            let next = if index % 3 == 0 {
                key(None, keys.first().map(String::as_str))
            } else {
                key(keys.last().map(String::as_str), None)
            };
            keys.push(next);
        }
        let by_string = {
            let mut sorted = keys.clone();
            sorted.sort();
            sorted
        };
        let by_bytes = {
            let mut sorted = keys.clone();
            sorted.sort_by_key(|key| parse(key).expect("a key").as_bytes().to_vec());
            sorted
        };
        assert_eq!(by_string, by_bytes);
    }

    #[test]
    fn refuses_malformed_equal_and_reversed_keys() {
        let first = key(None, None);
        let second = key(Some(&first), None);
        assert!(matches!(
            between(Some("zz"), None),
            Err(IndexKeyError::Invalid(_))
        ));
        assert!(matches!(
            between(Some(""), None),
            Err(IndexKeyError::Invalid(_))
        ));
        assert!(matches!(
            between(Some(&first), Some(&first)),
            Err(IndexKeyError::Unordered { .. })
        ));
        assert!(matches!(
            between(Some(&second), Some(&first)),
            Err(IndexKeyError::Unordered { .. })
        ));
    }
}
