use std::sync::atomic::{AtomicU64, Ordering};

static ENTITY_COUNTER: AtomicU64 = AtomicU64::new(1);
static NO_PARENT: Id = Id(0);

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub struct Id(u64);

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub struct EntityId {
  id: Id,
  parent: Id,
}

impl EntityId {
  fn new() -> Self {
    Self {
      id: Id(ENTITY_COUNTER.fetch_add(1, Ordering::Relaxed)),
      parent: NO_PARENT,
    }
  }

  pub fn new_with_parent(parent: &Self) -> Self {
    Self {
      id: Id(ENTITY_COUNTER.fetch_add(1, Ordering::Relaxed)),
      parent: parent.id,
    }
  }
}

macro_rules! entity_id {
  ($name:ident) => {
    #[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
    pub struct $name(EntityId);

    impl $name {
      pub fn new() -> Self {
        Self(EntityId::new())
      }

      pub fn new_with_parent<T>(parent: &T) -> Self
      where
        T: AsRef<EntityId>,
      {
        Self(EntityId::new_with_parent(parent.as_ref()))
      }

      pub fn raw(&self) -> u64 {
        self.0.id.0
      }

      /// Reconstruct an ID from its raw value.
      /// Note: This creates an ID without a parent reference.
      /// Use with caution - mainly for deserializing IDs from JS.
      pub fn from_raw(raw: u128) -> Self {
        Self(EntityId {
          id: Id(raw as u64),
          parent: NO_PARENT,
        })
      }
    }

    impl From<$name> for u64 {
      fn from(id: $name) -> u64 {
        id.raw()
      }
    }

    impl AsRef<EntityId> for $name {
      fn as_ref(&self) -> &EntityId {
        &self.0
      }
    }
  };
}

entity_id!(ContourId);
entity_id!(PointId);
