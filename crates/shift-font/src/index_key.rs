//! Sibling order keys: fractional indexes that sort as plain strings.
//!
//! A scene node's `index` orders it among the nodes that share its parent. A
//! key between any two others always exists, so moving a node writes only that
//! node's key. Keys are the base-62 fractional indexes of David Greenspan's
//! "Implementing Fractional Indexing" (as rocicorp's `fractional-indexing`
//! package writes them): an integer part whose head letter gives its length
//! (`a0`…`az`, then `b00`…; `Zz` and below for keys before `a0`), then an
//! optional fraction with no trailing zero. Keys compare byte by byte, so the
//! scene's existing `a0`, `a1`, … keys keep their order.

use std::cmp::Ordering;

/// The digits of a key, in ascending byte order.
const DIGITS: &[u8; 62] = b"0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
/// The heads of an integer part: `A`–`Z` for negative lengths, `a`–`z` for positive ones.
const INTEGER_HEADS: &[u8; 52] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
/// The smallest integer part, which no key may be, so a key before every key exists.
const SMALLEST_INTEGER: &str = "A00000000000000000000000000";

/// Why no key could be made between two keys.
#[derive(Clone, Debug, Eq, PartialEq, thiserror::Error)]
pub enum IndexKeyError {
    /// A key is not a fractional index: a bad head, too short, or a trailing zero.
    #[error("invalid index key {0:?}")]
    Invalid(String),
    /// The two keys are equal, so nothing sorts between them.
    #[error("index keys are equal: {0:?}")]
    Equal(String),
    /// The keys reach the end of the key space.
    #[error("no index key sorts beyond {0:?}")]
    Exhausted(String),
}

/// Returns a key that sorts after `before` and before `after`.
///
/// `None` stands for the start of the list (`before`) or its end (`after`); with
/// neither, the first key, `a0`. Keys given in the wrong order are swapped.
///
/// # Errors
///
/// Returns [`IndexKeyError::Invalid`] when either key is malformed,
/// [`IndexKeyError::Equal`] when they are the same key, and
/// [`IndexKeyError::Exhausted`] at the end of the key space.
pub fn between(before: Option<&str>, after: Option<&str>) -> Result<String, IndexKeyError> {
    if let Some(key) = before {
        validate(key)?;
    }
    if let Some(key) = after {
        validate(key)?;
    }

    match (before, after) {
        (None, None) => Ok("a0".to_owned()),
        (None, Some(after)) => before_key(after),
        (Some(before), None) => after_key(before),
        (Some(a), Some(b)) => match a.cmp(b) {
            Ordering::Equal => Err(IndexKeyError::Equal(a.to_owned())),
            Ordering::Less => between_keys(a, b),
            Ordering::Greater => between_keys(b, a),
        },
    }
}

/// Orders two keys: as plain strings, the order every key sorts in.
#[must_use]
pub fn compare(a: &str, b: &str) -> Ordering {
    a.cmp(b)
}

fn before_key(after: &str) -> Result<String, IndexKeyError> {
    let integer = integer_part(after)?;
    let fraction = &after[integer.len()..];
    if integer == SMALLEST_INTEGER {
        return Ok(format!("{integer}{}", midpoint("", Some(fraction))?));
    }
    if integer.len() < after.len() {
        return Ok(integer.to_owned());
    }

    decrement(integer)?.ok_or_else(|| IndexKeyError::Exhausted(after.to_owned()))
}

fn after_key(before: &str) -> Result<String, IndexKeyError> {
    let integer = integer_part(before)?;
    let fraction = &before[integer.len()..];
    match increment(integer)? {
        Some(next) => Ok(next),
        None => Ok(format!("{integer}{}", midpoint(fraction, None)?)),
    }
}

fn between_keys(a: &str, b: &str) -> Result<String, IndexKeyError> {
    let integer_a = integer_part(a)?;
    let fraction_a = &a[integer_a.len()..];
    let integer_b = integer_part(b)?;
    let fraction_b = &b[integer_b.len()..];
    if integer_a == integer_b {
        return Ok(format!("{integer_a}{}", midpoint(fraction_a, Some(fraction_b))?));
    }

    let next = increment(integer_a)?.ok_or_else(|| IndexKeyError::Exhausted(a.to_owned()))?;
    if next.as_str() < b {
        return Ok(next);
    }
    Ok(format!("{integer_a}{}", midpoint(fraction_a, None)?))
}

/// A fraction between `a` and `b` (or after `a` when `b` is `None`), `a < b`.
fn midpoint(a: &str, b: Option<&str>) -> Result<String, IndexKeyError> {
    let invalid = |key: &str| IndexKeyError::Invalid(key.to_owned());
    if a.ends_with('0') {
        return Err(invalid(a));
    }
    if let Some(b) = b {
        if a >= b || b.ends_with('0') {
            return Err(invalid(b));
        }
        // Drop the common prefix, reading `a` as padded with zeros.
        let common = b
            .bytes()
            .enumerate()
            .take_while(|&(at, digit)| a.as_bytes().get(at).copied().unwrap_or(b'0') == digit)
            .count();
        if common > 0 {
            let rest_a = a.get(common..).unwrap_or("");
            return Ok(format!("{}{}", &b[..common], midpoint(rest_a, Some(&b[common..]))?));
        }
    }

    let digit_a = a.bytes().next().map_or(Ok(0), |digit| digit_index(digit, a))?;
    let digit_b = match b {
        Some(b) => b.bytes().next().map_or(Ok(DIGITS.len()), |digit| digit_index(digit, b))?,
        None => DIGITS.len(),
    };
    if digit_b - digit_a > 1 {
        return Ok(char::from(DIGITS[(digit_a + digit_b).div_ceil(2)]).to_string());
    }
    if let Some(b) = b.filter(|b| b.len() > 1) {
        return Ok(b[..1].to_owned());
    }

    Ok(format!("{}{}", char::from(DIGITS[digit_a]), midpoint(a.get(1..).unwrap_or(""), None)?))
}

fn validate(key: &str) -> Result<(), IndexKeyError> {
    if key == SMALLEST_INTEGER {
        return Err(IndexKeyError::Invalid(key.to_owned()));
    }
    let integer = integer_part(key)?;
    if key.len() > integer.len() && key.ends_with('0') {
        return Err(IndexKeyError::Invalid(key.to_owned()));
    }
    Ok(())
}

fn integer_part(key: &str) -> Result<&str, IndexKeyError> {
    let head = key.bytes().next().ok_or_else(|| IndexKeyError::Invalid(key.to_owned()))?;
    let length = integer_length(head).ok_or_else(|| IndexKeyError::Invalid(key.to_owned()))?;
    key.get(..length).ok_or_else(|| IndexKeyError::Invalid(key.to_owned()))
}

/// The length of an integer part with head `head`: 2 for `a` and `Z`, one more per letter outward.
fn integer_length(head: u8) -> Option<usize> {
    let half = INTEGER_HEADS.len() / 2;
    let at = INTEGER_HEADS.iter().position(|&candidate| candidate == head)?;
    Some(if at < half { half - at + 1 } else { at - half + 2 })
}

fn digit_index(digit: u8, key: &str) -> Result<usize, IndexKeyError> {
    DIGITS
        .iter()
        .position(|&candidate| candidate == digit)
        .ok_or_else(|| IndexKeyError::Invalid(key.to_owned()))
}

/// The next integer part, or `None` after the largest.
fn increment(integer: &str) -> Result<Option<String>, IndexKeyError> {
    step(integer, Step::Up)
}

/// The previous integer part, or `None` before the smallest.
fn decrement(integer: &str) -> Result<Option<String>, IndexKeyError> {
    step(integer, Step::Down)
}

#[derive(Clone, Copy)]
enum Step {
    Up,
    Down,
}

fn step(integer: &str, direction: Step) -> Result<Option<String>, IndexKeyError> {
    let bytes = integer.as_bytes();
    let (&head, digits) = bytes.split_first().ok_or_else(|| IndexKeyError::Invalid(integer.to_owned()))?;
    let (wrap_from, wrap_to) = match direction {
        Step::Up => (DIGITS[DIGITS.len() - 1], DIGITS[0]),
        Step::Down => (DIGITS[0], DIGITS[DIGITS.len() - 1]),
    };

    // Turn digits that overflow into the wrapped digit, right to left, until one can step.
    let mut stepped = digits.to_vec();
    for at in (0..stepped.len()).rev() {
        if stepped[at] == wrap_from {
            stepped[at] = wrap_to;
            continue;
        }
        let index = digit_index(stepped[at], integer)?;
        stepped[at] = match direction {
            Step::Up => DIGITS[index + 1],
            Step::Down => DIGITS[index - 1],
        };
        return Ok(Some(text(head, &stepped)));
    }

    // Every digit wrapped: the head moves one letter, and the digits grow or shrink to fit it.
    let head_at = INTEGER_HEADS
        .iter()
        .position(|&candidate| candidate == head)
        .ok_or_else(|| IndexKeyError::Invalid(integer.to_owned()))?;
    let next_at = match direction {
        Step::Up if head_at + 1 < INTEGER_HEADS.len() => head_at + 1,
        Step::Down if head_at > 0 => head_at - 1,
        _ => return Ok(None),
    };
    let next_head = INTEGER_HEADS[next_at];
    let (Some(length), Some(next_length)) = (integer_length(head), integer_length(next_head)) else {
        return Err(IndexKeyError::Invalid(integer.to_owned()));
    };
    match next_length.cmp(&length) {
        Ordering::Greater => stepped.push(wrap_to),
        Ordering::Less => {
            stepped.pop();
        }
        Ordering::Equal => {}
    }
    Ok(Some(text(next_head, &stepped)))
}

fn text(head: u8, digits: &[u8]) -> String {
    let mut text = String::with_capacity(digits.len() + 1);
    text.push(char::from(head));
    text.extend(digits.iter().copied().map(char::from));
    text
}

#[cfg(test)]
mod tests {
    use super::*;

    fn key(before: Option<&str>, after: Option<&str>) -> String {
        between(before, after).expect("a key between")
    }

    #[test]
    fn starts_at_a0_and_counts_up() {
        assert_eq!(key(None, None), "a0");
        assert_eq!(key(Some("a0"), None), "a1");
        assert_eq!(key(Some("a9"), None), "aA");
        assert_eq!(key(Some("az"), None), "b00");
        assert_eq!(key(Some("Zz"), None), "a0");
    }

    #[test]
    fn counts_down_before_the_first_key() {
        assert_eq!(key(None, Some("a0")), "Zz");
        assert_eq!(key(None, Some("a1")), "a0");
        assert_eq!(key(None, Some("b00")), "az");
        assert_eq!(key(None, Some("a0V")), "a0");
    }

    #[test]
    fn makes_fractions_between_neighbours() {
        assert_eq!(key(Some("a0"), Some("a1")), "a0V");
        assert_eq!(key(Some("a0V"), Some("a1")), "a0l");
        assert_eq!(key(Some("a0"), Some("a0V")), "a0G");
        assert_eq!(key(Some("a1"), Some("a3")), "a2");
        assert_eq!(key(Some("a0"), Some("a0G")), "a08");
        assert_eq!(key(Some("Zz"), Some("a0")), "ZzV");
        assert_eq!(key(Some("a1"), Some("a0")), "a0V");
    }

    #[test]
    fn keeps_every_key_between_its_neighbours() {
        let mut keys = vec![key(None, None)];
        for _ in 0..200 {
            let last = keys.last().cloned();
            keys.push(key(last.as_deref(), None));
        }
        for at in 0..50 {
            let middle = key(Some(&keys[at]), Some(&keys[at + 1]));
            assert_eq!(compare(&keys[at], &middle), Ordering::Less);
            assert_eq!(compare(&middle, &keys[at + 1]), Ordering::Less);
        }
        let mut sorted = keys.clone();
        sorted.sort_by(|a, b| compare(a, b));
        assert_eq!(sorted, keys);
    }

    #[test]
    fn narrows_repeatedly_between_two_keys() {
        let (mut low, high) = ("a0".to_owned(), "a1".to_owned());
        for _ in 0..100 {
            let middle = key(Some(&low), Some(&high));
            assert!(low < middle && middle < high);
            low = middle;
        }
    }

    #[test]
    fn smallest_integer_is_the_longest_negative_head_and_zeros() {
        assert_eq!(integer_length(b'A'), Some(SMALLEST_INTEGER.len()));
        assert!(SMALLEST_INTEGER[1..].bytes().all(|digit| digit == b'0'));
    }

    #[test]
    fn refuses_malformed_and_equal_keys() {
        assert!(matches!(between(Some("a10"), None), Err(IndexKeyError::Invalid(_))));
        assert!(matches!(between(Some(""), None), Err(IndexKeyError::Invalid(_))));
        assert!(matches!(between(Some("!0"), None), Err(IndexKeyError::Invalid(_))));
        assert!(matches!(between(Some(SMALLEST_INTEGER), None), Err(IndexKeyError::Invalid(_))));
        assert_eq!(between(Some("a1"), Some("a1")), Err(IndexKeyError::Equal("a1".to_owned())));
    }

    #[test]
    fn orders_the_keys_scenes_wrote_before_as_strings() {
        let mut existing: Vec<String> = (0..12).map(|count| format!("a{count}")).collect();
        existing.sort_by(|a, b| compare(a, b));
        let as_strings = ["a0", "a1", "a10", "a11", "a2", "a3", "a4", "a5", "a6", "a7", "a8", "a9"];
        assert_eq!(existing, as_strings);
    }
}
