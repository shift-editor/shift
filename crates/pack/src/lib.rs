//! Values packed into flat numbers to cross into TypeScript.
//!
//! A value crosses as one flat list of `f64`s, its fields in declaration
//! order with no names: a number, flag or count is one value; a name is its
//! interned id ([`Names`]); a list is its length followed by its items; an
//! optional value is a flag followed by the value when present; a unit enum
//! is its variant's index.
//!
//! [`derive@Pack`] gives a type its [`Pack::read`] and [`Pack::write`].
//! [`macro@interface`] turns a trait into a request protocol: each method is
//! called by its index, with its arguments and result packed this way. Both
//! also describe themselves to TypeScript: when `PACK_TS_DIR` is set while
//! they expand, they write a JSON fragment per item there, which
//! `@shift/pack`'s generator turns into the TypeScript side. Both sides
//! come from the same build, so they cannot disagree about field order.

#![warn(clippy::unwrap_used, clippy::print_stdout)]

// The derives name `::pack`, which inside this crate is itself.
extern crate self as pack;

pub use pack_derive::{Pack, interface};

/// Lookups between interned names and their ids, owned by whoever runs the
/// call, so a name crosses once as text and afterwards as a number.
pub trait Names {
    /// The name `id` stands for, or `None` for an id never handed out.
    fn name(&self, id: u32) -> Option<&str>;
    /// The id of `name`, interning it the first time.
    fn id(&mut self, name: &str) -> u32;
}

/// Reads numbers in order from a call's input.
///
/// Reading past the end yields zeros, so a short input decodes to empty and
/// zero values rather than panicking.
pub struct Reader<'a> {
    values: &'a [f64],
    at: usize,
    names: &'a dyn Names,
}

impl<'a> Reader<'a> {
    pub fn new(values: &'a [f64], names: &'a dyn Names) -> Self {
        Self {
            values,
            at: 0,
            names,
        }
    }

    pub fn number(&mut self) -> f64 {
        let value = self.values.get(self.at).copied().unwrap_or(0.0);
        self.at += 1;
        value
    }

    #[expect(
        clippy::cast_possible_truncation,
        clippy::cast_sign_loss,
        reason = "a count read as f64; negatives clamp to 0 and `as` saturates"
    )]
    pub fn count(&mut self) -> usize {
        self.number().max(0.0) as usize
    }

    pub fn flag(&mut self) -> bool {
        self.number() != 0.0
    }

    /// Returns the name an interned id stands for; empty for an unknown id.
    pub fn name(&mut self) -> String {
        let id = self.count();
        u32::try_from(id)
            .ok()
            .and_then(|id| self.names.name(id))
            .unwrap_or_default()
            .to_string()
    }

    /// How many numbers are left; bounds what a count may reserve.
    pub fn remaining(&self) -> usize {
        self.values.len().saturating_sub(self.at)
    }
}

/// Appends numbers to a call's output.
pub struct Writer<'a> {
    values: Vec<f64>,
    names: &'a mut dyn Names,
}

impl<'a> Writer<'a> {
    pub fn new(names: &'a mut dyn Names) -> Self {
        Self {
            values: Vec::new(),
            names,
        }
    }

    pub fn number(&mut self, value: f64) {
        self.values.push(value);
    }

    pub fn count(&mut self, value: usize) {
        self.values.push(value as f64);
    }

    pub fn flag(&mut self, value: bool) {
        self.values.push(if value { 1.0 } else { 0.0 });
    }

    pub fn name(&mut self, name: &str) {
        let id = self.names.id(name);
        self.values.push(f64::from(id));
    }

    pub fn finish(self) -> Vec<f64> {
        self.values
    }
}

/// A value that packs into numbers.
pub trait Pack: Sized {
    fn read(read: &mut Reader) -> Self;
    fn write(&self, write: &mut Writer);
}

impl Pack for f64 {
    fn read(read: &mut Reader) -> Self {
        read.number()
    }

    fn write(&self, write: &mut Writer) {
        write.number(*self);
    }
}

impl Pack for usize {
    fn read(read: &mut Reader) -> Self {
        read.count()
    }

    fn write(&self, write: &mut Writer) {
        write.count(*self);
    }
}

impl Pack for bool {
    fn read(read: &mut Reader) -> Self {
        read.flag()
    }

    fn write(&self, write: &mut Writer) {
        write.flag(*self);
    }
}

impl Pack for String {
    fn read(read: &mut Reader) -> Self {
        read.name()
    }

    fn write(&self, write: &mut Writer) {
        write.name(self);
    }
}

impl<T: Pack> Pack for Vec<T> {
    fn read(read: &mut Reader) -> Self {
        let count = read.count();
        // A corrupt count must not reserve unbounded memory; items past the
        // end of the input read as zeros.
        let mut items = Self::with_capacity(count.min(read.remaining()));
        for _ in 0..count {
            items.push(T::read(read));
        }
        items
    }

    fn write(&self, write: &mut Writer) {
        write.count(self.len());
        for item in self {
            item.write(write);
        }
    }
}

impl<T: Pack> Pack for Option<T> {
    fn read(read: &mut Reader) -> Self {
        read.flag().then(|| T::read(read))
    }

    fn write(&self, write: &mut Writer) {
        write.flag(self.is_some());
        if let Some(value) = self {
            value.write(write);
        }
    }
}

/// Decodes `input` as `I`, applies `method`, and encodes its result: one
/// method of a request protocol, as [`macro@interface`]'s dispatch calls it.
///
/// `method` must not intern names itself; names in `I` are already resolved
/// and names in `O` are interned while encoding.
pub fn call<I: Pack, O: Pack>(
    input: &[f64],
    names: &mut dyn Names,
    method: impl FnOnce(I) -> O,
) -> Vec<f64> {
    let value = I::read(&mut Reader::new(input, &*names));
    let result = method(value);
    let mut write = Writer::new(names);
    result.write(&mut write);
    write.finish()
}

#[cfg(test)]
mod tests {
    use std::collections::HashMap;

    use super::*;

    #[derive(Default)]
    struct Table {
        ids: HashMap<String, u32>,
        names: Vec<String>,
    }

    impl Names for Table {
        fn name(&self, id: u32) -> Option<&str> {
            self.names.get(id as usize).map(String::as_str)
        }

        fn id(&mut self, name: &str) -> u32 {
            if let Some(&id) = self.ids.get(name) {
                return id;
            }
            let id = u32::try_from(self.names.len()).unwrap();
            self.names.push(name.to_string());
            self.ids.insert(name.to_string(), id);
            id
        }
    }

    #[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Pack)]
    enum Alignment {
        #[default]
        Unset,
        Anchored,
        Free,
    }

    #[derive(Clone, Debug, PartialEq, Pack)]
    struct Anchor {
        name: Option<String>,
        x: f64,
        y: f64,
    }

    #[derive(Clone, Debug, PartialEq, Pack)]
    struct Component {
        alignment: Alignment,
        anchors: Vec<Anchor>,
        base_glyph_count: usize,
    }

    #[interface]
    trait Measure {
        fn width(&self, anchor: Anchor) -> f64;
        fn scaled(&self, anchor: Anchor, factor: f64) -> Anchor;
        fn count(&self) -> usize;
    }

    struct Ruler;

    impl Measure for Ruler {
        fn width(&self, anchor: Anchor) -> f64 {
            anchor.x
        }

        fn scaled(&self, anchor: Anchor, factor: f64) -> Anchor {
            Anchor {
                x: anchor.x * factor,
                y: anchor.y * factor,
                ..anchor
            }
        }

        fn count(&self) -> usize {
            3
        }
    }

    fn encode<T: Pack>(names: &mut Table, value: &T) -> Vec<f64> {
        let mut write = Writer::new(names);
        value.write(&mut write);
        write.finish()
    }

    fn decode<T: Pack>(names: &Table, values: &[f64]) -> T {
        T::read(&mut Reader::new(values, names))
    }

    fn component() -> Component {
        Component {
            alignment: Alignment::Free,
            anchors: vec![
                Anchor {
                    name: Some("top".into()),
                    x: 1.0,
                    y: 2.0,
                },
                Anchor {
                    name: None,
                    x: 3.0,
                    y: 4.0,
                },
            ],
            base_glyph_count: 2,
        }
    }

    #[test]
    fn a_packed_value_reads_back_what_it_wrote() {
        let mut names = Table::default();
        let components = vec![component(), component()];

        let encoded = encode(&mut names, &components);

        assert_eq!(decode::<Vec<Component>>(&names, &encoded), components);
    }

    #[test]
    fn fields_are_written_in_declaration_order() {
        let mut names = Table::default();
        let anchor = Anchor {
            name: None,
            x: 3.0,
            y: 4.0,
        };

        assert_eq!(encode(&mut names, &anchor), [0.0, 3.0, 4.0]);
    }

    #[test]
    fn an_enum_is_its_variant_index() {
        let mut names = Table::default();

        assert_eq!(encode(&mut names, &Alignment::Free), [2.0]);
        assert_eq!(decode::<Alignment>(&names, &[1.0]), Alignment::Anchored);
    }

    #[test]
    fn an_unknown_enum_index_reads_as_the_first_variant() {
        assert_eq!(
            decode::<Alignment>(&Table::default(), &[7.0]),
            Alignment::Unset
        );
    }

    #[test]
    fn a_name_crosses_as_its_interned_id() {
        let mut names = Table::default();

        let encoded = encode(&mut names, &"bottom".to_string());

        assert_eq!(encoded.len(), 1);
        assert_eq!(decode::<String>(&names, &encoded), "bottom");
    }

    #[test]
    fn a_short_input_reads_as_zeros_without_panicking() {
        let components = decode::<Vec<Component>>(&Table::default(), &[2.0, 1.0]);

        assert_eq!(components.len(), 2);
        assert_eq!(components[0].alignment, Alignment::Anchored);
        assert!(components[1].anchors.is_empty());
    }

    #[test]
    fn a_method_is_called_by_its_index_with_its_arguments_in_order() {
        let mut names = Table::default();
        let anchor = Anchor {
            name: None,
            x: 3.0,
            y: 4.0,
        };
        let mut input = encode(&mut names, &anchor);
        input.push(2.0);

        let reply = measure_request(&Ruler, 1, &input, &mut names);

        assert_eq!(
            decode::<Anchor>(&names, &reply),
            Anchor {
                name: None,
                x: 6.0,
                y: 8.0
            }
        );
    }

    #[test]
    fn a_method_without_arguments_reads_nothing() {
        let mut names = Table::default();

        assert_eq!(measure_request(&Ruler, 2, &[], &mut names), [3.0]);
    }

    #[test]
    fn an_unknown_method_replies_with_nothing() {
        let mut names = Table::default();

        assert!(measure_request(&Ruler, 9, &[], &mut names).is_empty());
    }
}
