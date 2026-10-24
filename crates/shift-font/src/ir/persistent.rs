//! Collections whose copies share structure.
//!
//! A [`Font`](crate::Font) is copied on the first write of every edit, so
//! anything it holds that grows with the font must copy in O(1) and change in
//! O(log n). These types give that with only the operations Shift uses; the
//! persistent backing crate is named here and nowhere else, so swapping it
//! changes this file alone.

use std::borrow::Borrow;
use std::hash::Hash;

use serde::{Deserialize, Serialize};

/// A hash map whose copies share structure.
#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct PersistentMap<K, V>(imbl::HashMap<K, V>)
where
    K: Hash + Eq + Clone,
    V: Clone;

impl<K, V> PersistentMap<K, V>
where
    K: Hash + Eq + Clone,
    V: Clone,
{
    pub(crate) fn get<Q>(&self, key: &Q) -> Option<&V>
    where
        K: Borrow<Q>,
        Q: Hash + Eq + ?Sized,
    {
        self.0.get(key)
    }

    /// The value at `key`, copied out of any structure it shares first.
    pub(crate) fn get_mut<Q>(&mut self, key: &Q) -> Option<&mut V>
    where
        K: Borrow<Q>,
        Q: Hash + Eq + ?Sized,
    {
        self.0.get_mut(key)
    }

    pub(crate) fn contains_key<Q>(&self, key: &Q) -> bool
    where
        K: Borrow<Q>,
        Q: Hash + Eq + ?Sized,
    {
        self.0.contains_key(key)
    }

    /// Inserts `value` at `key`, returning the value it replaced.
    pub(crate) fn insert(&mut self, key: K, value: V) -> Option<V> {
        self.0.insert(key, value)
    }

    pub(crate) fn remove<Q>(&mut self, key: &Q) -> Option<V>
    where
        K: Borrow<Q>,
        Q: Hash + Eq + ?Sized,
    {
        self.0.remove(key)
    }

    /// The value at `key`, inserting `V::default()` first when it is missing.
    pub(crate) fn get_or_default(&mut self, key: K) -> &mut V
    where
        V: Default,
    {
        self.0.entry(key).or_default()
    }
}

impl<K, V> Default for PersistentMap<K, V>
where
    K: Hash + Eq + Clone,
    V: Clone,
{
    fn default() -> Self {
        Self(imbl::HashMap::new())
    }
}

/// A hash set whose copies share structure.
#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct PersistentSet<T>(imbl::HashSet<T>)
where
    T: Hash + Eq + Clone;

impl<T> PersistentSet<T>
where
    T: Hash + Eq + Clone,
{
    pub(crate) fn contains(&self, value: &T) -> bool {
        self.0.contains(value)
    }

    /// Inserts `value`, returning whether it was new.
    pub(crate) fn insert(&mut self, value: T) -> bool {
        self.0.insert(value).is_none()
    }

    /// Removes `value`, returning whether it was present.
    pub(crate) fn remove(&mut self, value: &T) -> bool {
        self.0.remove(value).is_some()
    }

    pub(crate) fn is_empty(&self) -> bool {
        self.0.is_empty()
    }

    pub(crate) fn iter(&self) -> impl Iterator<Item = &T> {
        self.0.iter()
    }

    /// Inserts every value, failing with the first one already present.
    ///
    /// # Errors
    ///
    /// Returns that value, with the values before it inserted. Insert into a
    /// copy and keep it only on success.
    pub(crate) fn try_extend(&mut self, values: impl IntoIterator<Item = T>) -> Result<(), T> {
        for value in values {
            if self.0.contains(&value) {
                return Err(value);
            }
            self.0.insert(value);
        }
        Ok(())
    }

    pub(crate) fn remove_all<'a>(&mut self, values: impl IntoIterator<Item = &'a T>)
    where
        T: 'a,
    {
        for value in values {
            self.0.remove(value);
        }
    }
}

impl<T> Default for PersistentSet<T>
where
    T: Hash + Eq + Clone,
{
    fn default() -> Self {
        Self(imbl::HashSet::new())
    }
}

impl<T> Extend<T> for PersistentSet<T>
where
    T: Hash + Eq + Clone,
{
    fn extend<I: IntoIterator<Item = T>>(&mut self, values: I) {
        self.0.extend(values);
    }
}

/// A map from each key to the set of values filed under it, whose copies
/// share structure. A key with no values is never stored.
#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct PersistentMultiMap<K, V>(PersistentMap<K, PersistentSet<V>>)
where
    K: Hash + Eq + Clone,
    V: Hash + Eq + Clone;

impl<K, V> PersistentMultiMap<K, V>
where
    K: Hash + Eq + Clone,
    V: Hash + Eq + Clone,
{
    /// The values filed under `key`, in no particular order.
    pub(crate) fn get(&self, key: &K) -> impl Iterator<Item = &V> {
        self.0.get(key).into_iter().flat_map(PersistentSet::iter)
    }

    pub(crate) fn insert(&mut self, key: K, value: V) {
        self.0.get_or_default(key).insert(value);
    }

    /// Removes `value` from `key`, and `key` with it when no values remain.
    pub(crate) fn remove(&mut self, key: &K, value: &V) {
        let Some(values) = self.0.get_mut(key) else {
            return;
        };
        values.remove(value);
        if values.is_empty() {
            self.0.remove(key);
        }
    }

    pub(crate) fn remove_all<'a>(&mut self, entries: impl IntoIterator<Item = &'a (K, V)>)
    where
        K: 'a,
        V: 'a,
    {
        for (key, value) in entries {
            self.remove(key, value);
        }
    }
}

impl<K, V> Extend<(K, V)> for PersistentMultiMap<K, V>
where
    K: Hash + Eq + Clone,
    V: Hash + Eq + Clone,
{
    fn extend<I: IntoIterator<Item = (K, V)>>(&mut self, entries: I) {
        for (key, value) in entries {
            self.insert(key, value);
        }
    }
}

impl<K, V> Default for PersistentMultiMap<K, V>
where
    K: Hash + Eq + Clone,
    V: Hash + Eq + Clone,
{
    fn default() -> Self {
        Self(PersistentMap::default())
    }
}

/// A map whose keys may each be held by one value, whose copies share
/// structure.
#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct UniqueIndex<K, V>(PersistentMap<K, V>)
where
    K: Hash + Eq + Clone,
    V: Clone;

impl<K, V> UniqueIndex<K, V>
where
    K: Hash + Eq + Clone,
    V: Clone,
{
    pub(crate) fn get<Q>(&self, key: &Q) -> Option<&V>
    where
        K: Borrow<Q>,
        Q: Hash + Eq + ?Sized,
    {
        self.0.get(key)
    }

    /// Inserts every entry, failing with the first key already held.
    ///
    /// # Errors
    ///
    /// Returns that key, with the entries before it inserted. Insert into a
    /// copy and keep it only on success.
    pub(crate) fn try_extend(
        &mut self,
        entries: impl IntoIterator<Item = (K, V)>,
    ) -> Result<(), K> {
        for (key, value) in entries {
            if self.0.contains_key(&key) {
                return Err(key);
            }
            self.0.insert(key, value);
        }
        Ok(())
    }

    pub(crate) fn remove_all<'a>(&mut self, entries: impl IntoIterator<Item = &'a (K, V)>)
    where
        K: 'a,
        V: 'a,
    {
        for (key, _) in entries {
            self.0.remove(key);
        }
    }
}

impl<K, V> Default for UniqueIndex<K, V>
where
    K: Hash + Eq + Clone,
    V: Clone,
{
    fn default() -> Self {
        Self(PersistentMap::default())
    }
}

/// A map from each key to the values filed under it in the order they were
/// filed, whose copies share structure. A key with no values is never
/// stored.
#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct PersistentListMultiMap<K, V>(PersistentMap<K, Vec<V>>)
where
    K: Hash + Eq + Clone,
    V: Eq + Clone;

impl<K, V> PersistentListMultiMap<K, V>
where
    K: Hash + Eq + Clone,
    V: Eq + Clone,
{
    /// The values filed under `key`, in order.
    pub(crate) fn get(&self, key: &K) -> impl Iterator<Item = &V> + use<'_, K, V> {
        self.0.get(key).into_iter().flatten()
    }

    /// Files `value` last under `key`.
    pub(crate) fn push(&mut self, key: K, value: V) {
        self.0.get_or_default(key).push(value);
    }

    /// Removes `value` from `key`, and `key` with it when no values remain.
    pub(crate) fn remove(&mut self, key: &K, value: &V) {
        let Some(values) = self.0.get_mut(key) else {
            return;
        };
        values.retain(|held| held != value);
        if values.is_empty() {
            self.0.remove(key);
        }
    }

    pub(crate) fn remove_all<'a>(&mut self, entries: impl IntoIterator<Item = &'a (K, V)>)
    where
        K: 'a,
        V: 'a,
    {
        for (key, value) in entries {
            self.remove(key, value);
        }
    }

    /// Orders the values under `key` by `order`.
    pub(crate) fn sort_by_key<O: Ord>(&mut self, key: &K, order: impl FnMut(&V) -> O) {
        if let Some(values) = self.0.get_mut(key) {
            values.sort_by_key(order);
        }
    }
}

impl<K, V> Extend<(K, V)> for PersistentListMultiMap<K, V>
where
    K: Hash + Eq + Clone,
    V: Eq + Clone,
{
    fn extend<I: IntoIterator<Item = (K, V)>>(&mut self, entries: I) {
        for (key, value) in entries {
            self.push(key, value);
        }
    }
}

impl<K, V> Default for PersistentListMultiMap<K, V>
where
    K: Hash + Eq + Clone,
    V: Eq + Clone,
{
    fn default() -> Self {
        Self(PersistentMap::default())
    }
}

/// An ordered map whose copies share structure. Iteration, equality, and
/// serialization follow key order.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(transparent)]
#[serde(bound(
    serialize = "K: Serialize, V: Serialize",
    deserialize = "K: Deserialize<'de>, V: Deserialize<'de>"
))]
pub(crate) struct PersistentOrdMap<K, V>(imbl::OrdMap<K, V>)
where
    K: Ord + Clone,
    V: Clone;

impl<K, V> PersistentOrdMap<K, V>
where
    K: Ord + Clone,
    V: Clone,
{
    pub(crate) fn get(&self, key: &K) -> Option<&V> {
        self.0.get(key)
    }

    /// The value at `key`, copied out of any structure it shares first.
    pub(crate) fn get_mut(&mut self, key: &K) -> Option<&mut V> {
        self.0.get_mut(key)
    }

    /// Inserts `value` at `key`, returning the value it replaced.
    pub(crate) fn insert(&mut self, key: K, value: V) -> Option<V> {
        self.0.insert(key, value)
    }

    pub(crate) fn remove(&mut self, key: &K) -> Option<V> {
        self.0.remove(key)
    }

    pub(crate) fn contains_key(&self, key: &K) -> bool {
        self.0.contains_key(key)
    }

    /// The value at `key`, inserting `V::default()` first when it is missing.
    pub(crate) fn get_or_default(&mut self, key: K) -> &mut V
    where
        V: Default,
    {
        self.0.entry(key).or_default()
    }

    pub(crate) fn len(&self) -> usize {
        self.0.len()
    }

    pub(crate) fn is_empty(&self) -> bool {
        self.0.is_empty()
    }

    /// Every entry, in key order.
    pub(crate) fn iter(&self) -> impl Iterator<Item = (&K, &V)> {
        self.0.iter()
    }

    /// Every key, in order.
    pub(crate) fn keys(&self) -> impl Iterator<Item = &K> {
        self.0.keys()
    }
}

impl<K, V> Default for PersistentOrdMap<K, V>
where
    K: Ord + Clone,
    V: Clone,
{
    fn default() -> Self {
        Self(imbl::OrdMap::new())
    }
}

impl<K, V> FromIterator<(K, V)> for PersistentOrdMap<K, V>
where
    K: Ord + Clone,
    V: Clone,
{
    fn from_iter<I: IntoIterator<Item = (K, V)>>(entries: I) -> Self {
        Self(entries.into_iter().collect())
    }
}

impl<K, V> IntoIterator for PersistentOrdMap<K, V>
where
    K: Ord + Clone,
    V: Clone,
{
    type Item = (K, V);
    type IntoIter = imbl::ordmap::ConsumingIter<K, V, imbl::shared_ptr::DefaultSharedPtr>;

    fn into_iter(self) -> Self::IntoIter {
        self.0.into_iter()
    }
}

/// An ordered list keyed by position, whose copies share structure.
#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct PersistentVec<T>(imbl::Vector<T>)
where
    T: Clone;

impl<T> PersistentVec<T>
where
    T: Clone,
{
    pub(crate) fn len(&self) -> usize {
        self.0.len()
    }

    pub(crate) fn is_empty(&self) -> bool {
        self.0.is_empty()
    }

    pub(crate) fn get(&self, index: usize) -> Option<&T> {
        self.0.get(index)
    }

    pub(crate) fn get_mut(&mut self, index: usize) -> Option<&mut T> {
        self.0.get_mut(index)
    }

    /// Replaces the value at `index`, returning the one it replaced.
    pub(crate) fn set(&mut self, index: usize, value: T) -> T {
        self.0.set(index, value)
    }

    pub(crate) fn push(&mut self, value: T) {
        self.0.push_back(value);
    }

    pub(crate) fn remove(&mut self, index: usize) -> T {
        self.0.remove(index)
    }

    pub(crate) fn iter(&self) -> impl Iterator<Item = &T> {
        self.0.iter()
    }
}

impl<T> Default for PersistentVec<T>
where
    T: Clone,
{
    fn default() -> Self {
        Self(imbl::Vector::new())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn unique_index_rejects_a_held_or_repeated_key() {
        let mut index = UniqueIndex::default();
        index.try_extend([("A", 1)]).unwrap();

        assert_eq!(index.clone().try_extend([("B", 2), ("A", 3)]), Err("A"));
        assert_eq!(index.clone().try_extend([("C", 4), ("C", 5)]), Err("C"));
        assert_eq!(index.get("A"), Some(&1));
    }

    #[test]
    fn list_multimap_keeps_filing_order_and_drops_an_empty_key() {
        let mut map = PersistentListMultiMap::default();
        map.extend([(65, "b"), (65, "a")]);
        assert_eq!(map.get(&65).collect::<Vec<_>>(), [&"b", &"a"]);

        map.sort_by_key(&65, |value| *value);
        assert_eq!(map.get(&65).collect::<Vec<_>>(), [&"a", &"b"]);

        map.remove_all(&[(65, "a"), (65, "b")]);
        assert_eq!(map, PersistentListMultiMap::default());
    }

    #[test]
    fn multimap_drops_a_key_with_no_values_left() {
        let mut map = PersistentMultiMap::default();
        map.insert("base", 1);
        map.insert("base", 2);
        map.remove(&"base", &1);
        assert_eq!(map.get(&"base").collect::<Vec<_>>(), [&2]);

        map.remove(&"base", &2);
        assert_eq!(map, PersistentMultiMap::default());
    }

    #[test]
    fn copies_change_independently() {
        let mut original = PersistentOrdMap::default();
        original.insert(1, "one");
        let mut edited = original.clone();
        edited.insert(2, "two");
        *edited.get_mut(&1).unwrap() = "uno";

        assert_eq!(original.iter().collect::<Vec<_>>(), [(&1, &"one")]);
        assert_eq!(
            edited.iter().collect::<Vec<_>>(),
            [(&1, &"uno"), (&2, &"two")]
        );
    }
}
