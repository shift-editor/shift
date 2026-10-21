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

thread_local! {
    static NAMES: RefCell<Names> = RefCell::new(Names::default());
}

/// Returns the id of a name, interning it the first time.
#[wasm_bindgen(js_name = internName)]
pub fn intern_name(name: &str) -> u32 {
    NAMES.with_borrow_mut(|table| intern(table, name))
}

/// Returns the name an id stands for; empty for an unknown id.
#[wasm_bindgen(js_name = nameOf)]
pub fn name_of(id: u32) -> String {
    NAMES.with_borrow(|table| table.names.get(id as usize).cloned().unwrap_or_default())
}

fn intern(table: &mut Names, name: &str) -> u32 {
    if let Some(&id) = table.ids.get(name) {
        return id;
    }
    #[expect(
        clippy::cast_possible_truncation,
        reason = "usize is 32 bits on wasm32, the only target that interns names"
    )]
    let id = table.names.len() as u32;
    table.names.push(name.to_string());
    table.ids.insert(name.to_string(), id);
    id
}

/// Runs `call` with lookups between names and ids.
pub(crate) fn with_names<R>(call: impl FnOnce(&mut dyn NameTable) -> R) -> R {
    NAMES.with_borrow_mut(|table| call(table))
}

/// Lookups between interned names and their ids.
pub(crate) trait NameTable {
    fn name(&self, id: u32) -> Option<&str>;
    fn id(&mut self, name: &str) -> u32;
}

impl NameTable for Names {
    fn name(&self, id: u32) -> Option<&str> {
        self.names.get(id as usize).map(String::as_str)
    }

    fn id(&mut self, name: &str) -> u32 {
        intern(self, name)
    }
}
