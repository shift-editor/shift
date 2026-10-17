//! Scratch buffers in the module's memory for passing numbers without copies.
//!
//! The caller asks for an input buffer of a length, writes into it through a
//! view on the module's memory, and calls a function, which reads the input
//! and replaces the output buffer. A view goes stale when memory grows, which
//! any call may cause, so callers rebuild views after each call.

use std::cell::RefCell;

use wasm_bindgen::prelude::*;

thread_local! {
    static INPUT: RefCell<Vec<f64>> = const { RefCell::new(Vec::new()) };
    static OUTPUT: RefCell<Vec<f64>> = const { RefCell::new(Vec::new()) };
}

/// Returns the address of an input buffer of `len` numbers, zeroed.
#[wasm_bindgen(js_name = inputBuffer)]
pub fn input_buffer(len: usize) -> *mut f64 {
    INPUT.with_borrow_mut(|input| {
        input.clear();
        input.resize(len, 0.0);
        input.as_mut_ptr()
    })
}

/// The address of the last call's output.
#[wasm_bindgen(js_name = outputBuffer)]
pub fn output_buffer() -> *const f64 {
    OUTPUT.with_borrow(|output| output.as_ptr())
}

/// How many numbers the last call wrote.
#[wasm_bindgen(js_name = outputLength)]
pub fn output_length() -> usize {
    OUTPUT.with_borrow(Vec::len)
}

/// Runs `call` on the input buffer and stores what it writes as the output.
pub(crate) fn with_buffers(call: impl FnOnce(&[f64], &mut Vec<f64>)) {
    INPUT.with_borrow(|input| {
        OUTPUT.with_borrow_mut(|output| {
            output.clear();
            call(input, output);
        })
    });
}

/// Reads numbers in order from an input buffer.
pub(crate) struct Reader<'a> {
    values: &'a [f64],
    at: usize,
}

impl<'a> Reader<'a> {
    pub fn new(values: &'a [f64]) -> Self {
        Self { values, at: 0 }
    }

    pub fn number(&mut self) -> f64 {
        let value = self.values.get(self.at).copied().unwrap_or(0.0);
        self.at += 1;
        value
    }

    pub fn count(&mut self) -> usize {
        self.number().max(0.0) as usize
    }

    pub fn flag(&mut self) -> bool {
        self.number() != 0.0
    }
}
