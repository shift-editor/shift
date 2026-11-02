//! Names interned once each, so calls pass numbers instead of strings.
//!
//! A font has few distinct anchor names, so the table only grows by a name
//! the first time it is seen and is never cleared.

use std::cell::RefCell;
use std::collections::HashMap;

use wasm_bindgen::prelude::*;

#[derive(Default)]
struct Names {
    ids: HashMap<String, u32>,
    names: Vec<String>,
}

impl Names {
    /// Returns the id of `name`, adding it the first time.
    fn intern(&mut self, name: &str) -> u32 {
        if let Some(&id) = self.ids.get(name) {
            return id;
        }
        #[expect(
            clippy::cast_possible_truncation,
            reason = "usize is 32 bits on wasm32, the only target that interns names"
        )]
        let id = self.names.len() as u32;
        self.names.push(name.to_string());
        self.ids.insert(name.to_string(), id);
        id
    }
}

thread_local! {
    static NAMES: RefCell<Names> = RefCell::new(Names::default());
}

/// Returns the id of a name, interning it the first time.
#[wasm_bindgen(js_name = internName)]
pub fn intern_name(name: &str) -> u32 {
    NAMES.with_borrow_mut(|table| table.intern(name))
}

/// Returns the name an id stands for; empty for an unknown id.
#[wasm_bindgen(js_name = nameOf)]
pub fn name_of(id: u32) -> String {
    NAMES.with_borrow(|table| table.names.get(id as usize).cloned().unwrap_or_default())
}

/// Runs `call` with lookups between names and ids.
pub(crate) fn with_names<R>(call: impl FnOnce(&mut dyn pack::Names) -> R) -> R {
    NAMES.with_borrow_mut(|table| call(table))
}

impl pack::Names for Names {
    fn name(&self, id: u32) -> Option<&str> {
        self.names.get(id as usize).map(String::as_str)
    }

    fn id(&mut self, name: &str) -> u32 {
        self.intern(name)
    }
}
