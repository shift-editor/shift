//! Reads numbers in order from a call's input.

/// Reads numbers in order from a call's input.
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
