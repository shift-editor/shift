//! Semantic collections for Shift authoring entities.
//!
//! [`EntityList`] is for values that have stable identity and meaningful
//! order. It deliberately differs from a map: iteration and equality both
//! observe authoring order, and serialization emits an ordered sequence.
//! Unordered dictionaries and derived lookup indices should remain behind
//! their domain-specific types instead of using this collection.
//! [`PersistentEntityList`] has the same semantics with copies that share
//! structure.

use std::hash::Hash;
use std::sync::Arc;

use indexmap::IndexMap;

use crate::persistent::{PersistentMap, PersistentVec};
use serde::de::Error as _;
use serde::{Deserialize, Deserializer, Serialize, Serializer};

/// Supplies the stable identity owned by an authoring entity.
pub trait Identified {
    type Id: Clone + Eq + Hash;

    fn id(&self) -> Self::Id;
}

impl<T> Identified for Arc<T>
where
    T: Identified,
{
    type Id = T::Id;

    fn id(&self) -> Self::Id {
        self.as_ref().id()
    }
}

/// Implements [`Identified`] through each entity's own `id` method.
macro_rules! identified_by_id {
    ($($entity:ty => $id:ty,)*) => {
        $(impl Identified for $entity {
            type Id = $id;

            fn id(&self) -> Self::Id {
                <$entity>::id(self)
            }
        })*
    };
}

identified_by_id! {
    crate::Axis => crate::AxisId,
    crate::AxisMapping => crate::AxisMappingId,
    crate::MetricDefinition => crate::MetricId,
    crate::NamedInstance => crate::NamedInstanceId,
    crate::Source => crate::SourceId,
    crate::GlyphLayer => crate::LayerId,
}

/// An identity-addressable sequence whose order is part of its value.
///
/// Lookup uses an entity's stable ID, while iteration, equality, and
/// serialization preserve authoring order. Replacing an existing entity keeps
/// its current position; removing one preserves the relative order of the
/// remaining entities.
#[derive(Clone, Debug)]
pub struct EntityList<T>
where
    T: Identified,
{
    entries: IndexMap<T::Id, T>,
}

impl<T> EntityList<T>
where
    T: Identified,
{
    pub fn new() -> Self {
        Self {
            entries: IndexMap::new(),
        }
    }

    pub fn len(&self) -> usize {
        self.entries.len()
    }

    pub fn is_empty(&self) -> bool {
        self.entries.is_empty()
    }

    pub fn contains(&self, id: &T::Id) -> bool {
        self.entries.contains_key(id)
    }

    pub fn get(&self, id: &T::Id) -> Option<&T> {
        self.entries.get(id)
    }

    pub fn get_mut(&mut self, id: &T::Id) -> Option<&mut T> {
        self.entries.get_mut(id)
    }

    pub fn get_index(&self, index: usize) -> Option<(&T::Id, &T)> {
        self.entries.get_index(index)
    }

    /// Returns an entity's authored-order position without scanning the list.
    pub fn index_of(&self, id: &T::Id) -> Option<usize> {
        self.entries.get_index_of(id)
    }

    pub fn keys(&self) -> indexmap::map::Keys<'_, T::Id, T> {
        self.entries.keys()
    }

    pub fn values(&self) -> indexmap::map::Values<'_, T::Id, T> {
        self.entries.values()
    }

    pub fn values_mut(&mut self) -> indexmap::map::ValuesMut<'_, T::Id, T> {
        self.entries.values_mut()
    }

    pub fn iter(&self) -> indexmap::map::Iter<'_, T::Id, T> {
        self.entries.iter()
    }

    /// Inserts an entity at the end or replaces the entity with the same ID.
    ///
    /// Replacement preserves the existing position and returns the previous
    /// value. A newly inserted entity returns `None`.
    pub fn insert(&mut self, entity: T) -> Option<T> {
        self.entries.insert(entity.id(), entity)
    }

    pub fn shift_remove(&mut self, id: &T::Id) -> Option<T> {
        self.entries.shift_remove(id)
    }

    pub fn clear(&mut self) {
        self.entries.clear();
    }

    /// Moves an entity to another position without changing its identity.
    ///
    /// Returns `false` when either index is outside the list.
    pub fn move_index(&mut self, from: usize, to: usize) -> bool {
        if from >= self.len() || to >= self.len() {
            return false;
        }

        self.entries.move_index(from, to);
        true
    }
}

impl<T> Default for EntityList<T>
where
    T: Identified,
{
    fn default() -> Self {
        Self::new()
    }
}

impl<T> PartialEq for EntityList<T>
where
    T: Identified + PartialEq,
{
    fn eq(&self, other: &Self) -> bool {
        self.entries.as_slice() == other.entries.as_slice()
    }
}

impl<T> Eq for EntityList<T> where T: Identified + Eq {}

impl<T> Serialize for EntityList<T>
where
    T: Identified + Serialize,
{
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        serializer.collect_seq(self.values())
    }
}

impl<'de, T> Deserialize<'de> for EntityList<T>
where
    T: Identified + Deserialize<'de>,
{
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        let entities = Vec::<T>::deserialize(deserializer)?;
        let mut list = Self::new();

        for entity in entities {
            if list.insert(entity).is_some() {
                return Err(D::Error::custom("duplicate entity identity"));
            }
        }

        Ok(list)
    }
}

impl<T> FromIterator<T> for EntityList<T>
where
    T: Identified,
{
    /// Collects entities in order; a later entity replaces an earlier one with the same ID.
    fn from_iter<I: IntoIterator<Item = T>>(entities: I) -> Self {
        let mut list = Self::default();
        list.extend(entities);
        list
    }
}

impl<T> Extend<T> for EntityList<T>
where
    T: Identified,
{
    fn extend<I: IntoIterator<Item = T>>(&mut self, entities: I) {
        for entity in entities {
            self.insert(entity);
        }
    }
}

impl<'a, T> IntoIterator for &'a EntityList<T>
where
    T: Identified,
{
    type Item = (&'a T::Id, &'a T);
    type IntoIter = indexmap::map::Iter<'a, T::Id, T>;

    fn into_iter(self) -> Self::IntoIter {
        self.entries.iter()
    }
}

/// An [`EntityList`] whose copies share structure, for collections that a
/// copy-on-write owner duplicates on every edit.
///
/// Same semantics as [`EntityList`]: lookup by stable ID, and iteration,
/// equality, and serialization in authoring order. Cloning is O(1) and a
/// lookup or in-place change is O(log n), so copying a font to edit one glyph
/// no longer copies every glyph entry. Removing an entity before the end
/// renumbers the positions after it, which is O(n); appending and removing
/// the last entity are not.
#[derive(Clone, Debug)]
pub struct PersistentEntityList<T>
where
    T: Identified + Clone,
{
    entries: PersistentVec<T>,
    positions: PersistentMap<T::Id, usize>,
}

impl<T> PersistentEntityList<T>
where
    T: Identified + Clone,
{
    pub fn new() -> Self {
        Self {
            entries: PersistentVec::default(),
            positions: PersistentMap::default(),
        }
    }

    pub fn len(&self) -> usize {
        self.entries.len()
    }

    pub fn is_empty(&self) -> bool {
        self.entries.is_empty()
    }

    pub fn contains(&self, id: &T::Id) -> bool {
        self.positions.contains_key(id)
    }

    pub fn get(&self, id: &T::Id) -> Option<&T> {
        self.entries.get(*self.positions.get(id)?)
    }

    pub fn get_mut(&mut self, id: &T::Id) -> Option<&mut T> {
        let position = *self.positions.get(id)?;
        self.entries.get_mut(position)
    }

    /// The entity at `index` in authoring order, with its ID.
    pub fn get_index(&self, index: usize) -> Option<(T::Id, &T)> {
        self.entries.get(index).map(|entity| (entity.id(), entity))
    }

    /// Returns an entity's authored-order position without scanning the list.
    pub fn index_of(&self, id: &T::Id) -> Option<usize> {
        self.positions.get(id).copied()
    }

    pub fn values(&self) -> impl Iterator<Item = &T> {
        self.entries.iter()
    }

    pub fn iter(&self) -> impl Iterator<Item = (T::Id, &T)> {
        self.entries.iter().map(|entity| (entity.id(), entity))
    }

    /// Inserts an entity at the end or replaces the entity with the same ID.
    ///
    /// Replacement preserves the existing position and returns the previous
    /// value. A newly inserted entity returns `None`.
    pub fn insert(&mut self, entity: T) -> Option<T> {
        let id = entity.id();
        if let Some(&position) = self.positions.get(&id) {
            return Some(self.entries.set(position, entity));
        }

        self.positions.insert(id, self.entries.len());
        self.entries.push(entity);
        None
    }

    /// Removes an entity by ID, preserving the relative order of the rest.
    pub fn shift_remove(&mut self, id: &T::Id) -> Option<T> {
        let position = self.positions.remove(id)?;
        let removed = self.entries.remove(position);
        for entity in self.entries.iter().skip(position) {
            if let Some(later) = self.positions.get_mut(&entity.id()) {
                *later -= 1;
            }
        }
        Some(removed)
    }
}

impl<T> Default for PersistentEntityList<T>
where
    T: Identified + Clone,
{
    fn default() -> Self {
        Self::new()
    }
}

impl<T> PartialEq for PersistentEntityList<T>
where
    T: Identified + Clone + PartialEq,
{
    fn eq(&self, other: &Self) -> bool {
        self.entries == other.entries
    }
}

impl<T> Eq for PersistentEntityList<T> where T: Identified + Clone + Eq {}

impl<T> Serialize for PersistentEntityList<T>
where
    T: Identified + Clone + Serialize,
{
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        serializer.collect_seq(self.values())
    }
}

impl<'de, T> Deserialize<'de> for PersistentEntityList<T>
where
    T: Identified + Clone + Deserialize<'de>,
{
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        let entities = Vec::<T>::deserialize(deserializer)?;
        let mut list = Self::new();

        for entity in entities {
            if list.insert(entity).is_some() {
                return Err(D::Error::custom("duplicate entity identity"));
            }
        }

        Ok(list)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
    struct Item {
        id: u32,
        value: String,
    }

    impl Identified for Item {
        type Id = u32;

        fn id(&self) -> Self::Id {
            self.id
        }
    }

    fn item(id: u32, value: &'static str) -> Item {
        Item {
            id,
            value: value.to_string(),
        }
    }

    #[test]
    fn equality_observes_entity_order() {
        let mut first = EntityList::new();
        first.insert(item(2, "second"));
        first.insert(item(1, "first"));

        let mut reordered = EntityList::new();
        reordered.insert(item(1, "first"));
        reordered.insert(item(2, "second"));

        assert_ne!(first, reordered);
    }

    #[test]
    fn replacement_preserves_position() {
        let mut list = EntityList::new();
        list.insert(item(2, "old"));
        list.insert(item(1, "first"));

        assert_eq!(list.insert(item(2, "new")), Some(item(2, "old")));
        assert_eq!(
            list.values()
                .map(|item| item.value.as_str())
                .collect::<Vec<_>>(),
            vec!["new", "first"]
        );
    }

    #[test]
    fn collecting_keeps_first_position_and_last_value() {
        let list: EntityList<Item> = [item(2, "old"), item(1, "first"), item(2, "new")]
            .into_iter()
            .collect();

        let mut entries = Vec::new();
        for (id, item) in &list {
            entries.push((*id, item.value.as_str()));
        }
        assert_eq!(entries, vec![(2, "new"), (1, "first")]);
    }

    fn persistent(items: &[(u32, &'static str)]) -> PersistentEntityList<Item> {
        let mut list = PersistentEntityList::new();
        for (id, value) in items {
            list.insert(item(*id, value));
        }
        list
    }

    fn persistent_values(list: &PersistentEntityList<Item>) -> Vec<&str> {
        list.values().map(|item| item.value.as_str()).collect()
    }

    #[test]
    fn persistent_list_keeps_entity_list_semantics() {
        let mut list = persistent(&[(2, "old"), (1, "first"), (3, "third")]);
        assert_ne!(list, persistent(&[(1, "first"), (2, "old"), (3, "third")]));

        assert_eq!(list.insert(item(2, "new")), Some(item(2, "old")));
        assert_eq!(persistent_values(&list), vec!["new", "first", "third"]);

        assert_eq!(list.shift_remove(&2), Some(item(2, "new")));
        assert_eq!(persistent_values(&list), vec!["first", "third"]);
        assert_eq!(list.index_of(&3), Some(1));
        assert_eq!(list.get_index(1).map(|(id, _)| id), Some(3));
        assert_eq!(list.get(&3), Some(&item(3, "third")));
        assert!(!list.contains(&2));
    }

    #[test]
    fn persistent_list_copies_change_independently() {
        let original = persistent(&[(1, "first"), (2, "second")]);
        let mut edited = original.clone();

        edited.get_mut(&1).unwrap().value = "edited".to_string();
        edited.insert(item(3, "third"));

        assert_eq!(persistent_values(&original), vec!["first", "second"]);
        assert_eq!(
            persistent_values(&edited),
            vec!["edited", "second", "third"]
        );
    }

    #[test]
    fn persistent_list_serializes_as_an_entity_list() {
        let list = persistent(&[(2, "second"), (1, "first")]);
        let entity_list: EntityList<Item> =
            [item(2, "second"), item(1, "first")].into_iter().collect();

        let json = serde_json::to_string(&list).unwrap();
        assert_eq!(json, serde_json::to_string(&entity_list).unwrap());
        assert_eq!(
            serde_json::from_str::<PersistentEntityList<Item>>(&json).unwrap(),
            list
        );
    }
}
