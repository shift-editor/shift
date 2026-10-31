//! Values packed into flat numbers to cross into TypeScript or another
//! process.
//!
//! A value crosses as one flat list of `f64`s, its fields in declaration
//! order with no names: a number, flag or count is one value; a name is its
//! interned id ([`Names`]), and so is an id ([`derive@PackId`]), which
//! TypeScript reads as its brand; a list is its length followed by its items,
//! and [`Numbers`] is the same but read as one `Float64Array`; an optional
//! value is a flag followed by the value when present; a map ([`HashMap`],
//! [`BTreeMap`]) is its length followed by each key and its value, read in
//! TypeScript as a `Record`; `()` is nothing; a [`Result`] is a flag, set for
//! `Ok`, followed by the value or the error; an enum is its variant's
//! index, followed by the variant's fields when it has any, read in
//! TypeScript as a string union for unit variants and otherwise as a union
//! tagged by `kind`.
//!
//! [`Bytes`] do not go into the numbers: each crosses as one blob beside
//! them, and the numbers hold its index in the message's blob list
//! ([`Packed::blobs`]), so a buffer crosses whole, without a number per byte.
//!
//! [`derive@Pack`] gives a type its [`Pack::read`] and [`Pack::write`].
//! [`macro@interface`] turns a trait into a request protocol: each method is
//! called by its index, with its arguments and result packed this way. Both
//! also describe themselves to TypeScript: when `PACK_TS_DIR` is set while
//! they expand, they write a JSON fragment per item there, which
//! `@shift/pack`'s generator turns into the TypeScript side. Both sides
//! come from the same build, so they cannot disagree about field order.
//!
//! Between two Rust modules that share no name table, such as the editor's
//! engine in WebAssembly and the store reader in a native addon, the names a
//! message uses travel with it: see [`CarriedNames`].

#![warn(clippy::unwrap_used, clippy::print_stdout)]

// The derives name `::pack`, which inside this crate is itself.
extern crate self as pack;

use std::collections::{BTreeMap, HashMap};
use std::hash::Hash;

pub use pack_derive::{Pack, PackId, interface};

/// Lookups between interned names and their ids, owned by whoever runs the
/// call, so a name crosses once as text and afterwards as a number.
pub trait Names {
    /// The name `id` stands for, or `None` for an id never handed out.
    fn name(&self, id: u32) -> Option<&str>;
    /// The id of `name`, interning it the first time.
    fn id(&mut self, name: &str) -> u32;
}

/// One message of a call: its numbers, and the blobs its [`Bytes`] values
/// name by index.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct Packed {
    pub numbers: Vec<f64>,
    /// Each [`Bytes`] value the message holds, in the order it was written.
    pub blobs: Vec<Vec<u8>>,
}

/// Reads numbers in order from a call's input.
///
/// Reading past the end yields zeros, so a short input decodes to empty and
/// zero values rather than panicking.
pub struct Reader<'a> {
    values: &'a [f64],
    at: usize,
    blobs: &'a mut [Vec<u8>],
    names: &'a dyn Names,
}

impl<'a> Reader<'a> {
    /// Reads `values`, taking each [`Bytes`] value from `blobs` by the index
    /// the values hold; pass an empty slice for a message without bytes.
    pub fn new(values: &'a [f64], blobs: &'a mut [Vec<u8>], names: &'a dyn Names) -> Self {
        Self {
            values,
            at: 0,
            blobs,
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

    /// Reads a blob index and takes that blob, without copying it; empty for
    /// an index past the blob list or a blob already taken.
    pub fn bytes(&mut self) -> Vec<u8> {
        let index = self.count();
        self.blobs
            .get_mut(index)
            .map(std::mem::take)
            .unwrap_or_default()
    }

    /// How many numbers are left; bounds what a count may reserve.
    pub fn remaining(&self) -> usize {
        self.values.len().saturating_sub(self.at)
    }
}

/// Appends numbers to a call's output.
pub struct Writer<'a> {
    values: Vec<f64>,
    blobs: Vec<Vec<u8>>,
    names: &'a mut dyn Names,
}

impl<'a> Writer<'a> {
    pub fn new(names: &'a mut dyn Names) -> Self {
        Self {
            values: Vec::new(),
            blobs: Vec::new(),
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

    /// Appends `bytes` to the message's blob list, copying them once, and
    /// writes their index there.
    pub fn bytes(&mut self, bytes: &[u8]) {
        self.count(self.blobs.len());
        self.blobs.push(bytes.to_vec());
    }

    /// The numbers and blobs written.
    pub fn finish(self) -> Packed {
        Packed {
            numbers: self.values,
            blobs: self.blobs,
        }
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

impl Pack for u32 {
    /// A count past `u32::MAX` saturates.
    fn read(read: &mut Reader) -> Self {
        Self::try_from(read.count()).unwrap_or(Self::MAX)
    }

    fn write(&self, write: &mut Writer) {
        write.number(f64::from(*self));
    }
}

impl Pack for i32 {
    #[expect(
        clippy::cast_possible_truncation,
        reason = "a number read as f64; out-of-range values saturate"
    )]
    fn read(read: &mut Reader) -> Self {
        read.number() as Self
    }

    fn write(&self, write: &mut Writer) {
        write.number(f64::from(*self));
    }
}

/// A run of numbers that TypeScript reads as one `Float64Array` view rather
/// than a `number[]`: the same count and values as a `Vec<f64>`, without a
/// JavaScript array of boxed numbers on the other side.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct Numbers(pub Vec<f64>);

impl Pack for Numbers {
    fn read(read: &mut Reader) -> Self {
        Self(Vec::read(read))
    }

    fn write(&self, write: &mut Writer) {
        self.0.write(write);
    }
}

/// A buffer that crosses whole as one blob beside the numbers, which hold
/// its index in the message's blob list; TypeScript reads it as a
/// `Uint8Array`.
///
/// Writing copies the buffer into the message once; reading takes it from
/// the message without a copy.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct Bytes(pub Vec<u8>);

impl Pack for Bytes {
    fn read(read: &mut Reader) -> Self {
        Self(read.bytes())
    }

    fn write(&self, write: &mut Writer) {
        write.bytes(&self.0);
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

/// Nothing: what a method that returns no value replies with.
impl Pack for () {
    fn read(_read: &mut Reader) -> Self {}

    fn write(&self, _write: &mut Writer) {}
}

/// A count, then each key followed by its value, in the map's iteration
/// order. TypeScript reads it as a `Record`, so a key is a name or an id.
impl<K: Pack + Eq + Hash, V: Pack> Pack for HashMap<K, V> {
    fn read(read: &mut Reader) -> Self {
        let count = read.count();
        // As for a list: a corrupt count must not reserve unbounded memory.
        let mut map = Self::with_capacity(count.min(read.remaining()));
        for _ in 0..count {
            let key = K::read(read);
            map.insert(key, V::read(read));
        }
        map
    }

    fn write(&self, write: &mut Writer) {
        write.count(self.len());
        #[expect(
            clippy::iter_over_hash_type,
            reason = "a map crosses in any order; the reader keys it again"
        )]
        for (key, value) in self {
            key.write(write);
            value.write(write);
        }
    }
}

/// As a [`HashMap`]: a count, then each key followed by its value, in key
/// order.
impl<K: Pack + Ord, V: Pack> Pack for BTreeMap<K, V> {
    fn read(read: &mut Reader) -> Self {
        let count = read.count();
        let mut map = Self::new();
        for _ in 0..count {
            let key = K::read(read);
            map.insert(key, V::read(read));
        }
        map
    }

    fn write(&self, write: &mut Writer) {
        write.count(self.len());
        for (key, value) in self {
            key.write(write);
            value.write(write);
        }
    }
}

/// A flag, set for `Ok`, then the value or the error. A short input reads as
/// `Err`, so an empty reply, as for an unknown method, is a failure rather
/// than a zero value.
///
/// TypeScript reads a method's `Result` as its value, and throws a
/// `PackError` carrying the error.
impl<T: Pack, E: Pack> Pack for Result<T, E> {
    fn read(read: &mut Reader) -> Self {
        if read.flag() {
            Ok(T::read(read))
        } else {
            Err(E::read(read))
        }
    }

    fn write(&self, write: &mut Writer) {
        write.flag(self.is_ok());
        match self {
            Ok(value) => value.write(write),
            Err(error) => error.write(write),
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
    blobs: &mut [Vec<u8>],
    names: &mut dyn Names,
    method: impl FnOnce(I) -> O,
) -> Packed {
    let value = I::read(&mut Reader::new(input, blobs, &*names));
    let result = method(value);
    let mut write = Writer::new(names);
    result.write(&mut write);
    write.finish()
}

/// Carries a request to whatever answers an interface, and reads its reply:
/// what a [`macro@interface`]'s generated `<Trait>Client` calls through.
pub trait Transport {
    /// Why a request did not get a reply, as when the other side threw.
    type Error;

    /// Sends method `method` with the arguments `write` writes, and reads
    /// the reply as `O`.
    ///
    /// # Errors
    ///
    /// Returns the transport's error when the request gets no reply.
    fn call<O: Pack>(&self, method: u32, write: impl FnOnce(&mut Writer))
    -> Result<O, Self::Error>;
}

/// The names one message uses, for a call between two Rust modules that
/// share no name table: what the message writes is interned in a table of
/// its own, which travels as the message's last blob, and what it reads
/// resolves in the table the other side sent.
///
/// [`CarryingNames`] does this for the side that asks, and
/// [`Packed::answer_carrying_names`] for the side that answers. A call between
/// TypeScript and a module with a table of its own does not need it: its
/// names cross once each, by the module's ids.
#[derive(Debug, Default)]
pub struct CarriedNames {
    received: Vec<String>,
    sent: Vec<String>,
    ids: HashMap<String, u32>,
}

impl CarriedNames {
    /// Names that resolve in the table `blob` holds, as [`Self::into_blob`]
    /// wrote it. A malformed table resolves the names it holds up to where it
    /// breaks.
    pub fn received(blob: &[u8]) -> Self {
        let mut received = Vec::new();
        let mut rest = blob;
        while let Some((length, tail)) = rest.split_first_chunk::<4>() {
            let Some((name, tail)) = usize::try_from(u32::from_le_bytes(*length))
                .ok()
                .and_then(|length| tail.split_at_checked(length))
            else {
                break;
            };
            received.push(String::from_utf8_lossy(name).into_owned());
            rest = tail;
        }
        Self {
            received,
            ..Self::default()
        }
    }

    /// The names written, as a blob: each one's UTF-8 length as a
    /// little-endian `u32`, then its text, in id order.
    pub fn into_blob(self) -> Vec<u8> {
        let mut blob = Vec::new();
        for name in &self.sent {
            // A name past 4 GiB cannot be written; it reads as empty.
            let length = u32::try_from(name.len()).unwrap_or(0);
            blob.extend_from_slice(&length.to_le_bytes());
            if length > 0 {
                blob.extend_from_slice(name.as_bytes());
            }
        }
        blob
    }
}

impl Names for CarriedNames {
    fn name(&self, id: u32) -> Option<&str> {
        self.received
            .get(usize::try_from(id).ok()?)
            .map(String::as_str)
    }

    fn id(&mut self, name: &str) -> u32 {
        if let Some(&id) = self.ids.get(name) {
            return id;
        }
        // More than u32::MAX names in one message cannot be told apart.
        let id = u32::try_from(self.sent.len()).unwrap_or(u32::MAX);
        self.sent.push(name.to_string());
        self.ids.insert(name.to_string(), id);
        id
    }
}

/// A [`Transport`] over a function that sends a request to another Rust
/// module and returns its reply, with the names each message uses carried
/// as its last blob ([`CarriedNames`]). The other side answers with
/// [`Packed::answer_carrying_names`].
pub struct CarryingNames<F>(pub F);

impl<F, E> Transport for CarryingNames<F>
where
    F: Fn(u32, Packed) -> Result<Packed, E>,
{
    type Error = E;

    fn call<O: Pack>(&self, method: u32, write: impl FnOnce(&mut Writer)) -> Result<O, E> {
        let mut names = CarriedNames::default();
        let mut writer = Writer::new(&mut names);
        write(&mut writer);
        let mut request = writer.finish();
        request.blobs.push(names.into_blob());
        let mut reply = (self.0)(method, request)?;
        let names = CarriedNames::received(&reply.blobs.pop().unwrap_or_default());
        Ok(O::read(&mut Reader::new(
            &reply.numbers,
            &mut reply.blobs,
            &names,
        )))
    }
}

impl Packed {
    /// Answers this request, which a [`CarryingNames`] transport sent: takes
    /// the names table off the end of its blobs, runs `dispatch` (an
    /// interface's `<trait>_request`) with names resolving in it, and returns
    /// the reply with the names it wrote as its last blob.
    pub fn answer_carrying_names(
        mut self,
        dispatch: impl FnOnce(&[f64], Vec<Vec<u8>>, &mut dyn Names) -> Self,
    ) -> Self {
        let mut names = CarriedNames::received(&self.blobs.pop().unwrap_or_default());
        let mut reply = dispatch(&self.numbers, self.blobs, &mut names);
        reply.blobs.push(names.into_blob());
        reply
    }
}

#[cfg(test)]
mod tests {
    use std::collections::{BTreeMap, HashMap};

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

    #[derive(Clone, Debug, PartialEq, Pack)]
    enum Edit {
        Move { x: f64, y: f64 },
        Rename { name: String },
        Undo,
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
        write.finish().numbers
    }

    fn decode<T: Pack>(names: &Table, values: &[f64]) -> T {
        T::read(&mut Reader::new(values, &mut [], names))
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
    fn a_data_enum_is_its_variant_index_then_its_fields() {
        let mut names = Table::default();

        assert_eq!(
            encode(&mut names, &Edit::Move { x: 3.0, y: 4.0 }),
            [0.0, 3.0, 4.0]
        );
        assert_eq!(encode(&mut names, &Edit::Undo), [2.0]);
    }

    #[test]
    fn a_data_enum_reads_back_what_it_wrote() {
        let mut names = Table::default();
        let edits = vec![
            Edit::Rename { name: "a".into() },
            Edit::Undo,
            Edit::Move { x: 1.0, y: 2.0 },
        ];

        let encoded = encode(&mut names, &edits);

        assert_eq!(decode::<Vec<Edit>>(&names, &encoded), edits);
    }

    #[test]
    fn an_unknown_data_enum_index_reads_as_the_first_variant() {
        assert_eq!(
            decode::<Edit>(&Table::default(), &[9.0, 5.0, 6.0]),
            Edit::Move { x: 5.0, y: 6.0 }
        );
    }

    #[test]
    fn numbers_cross_as_a_list_of_numbers() {
        let mut names = Table::default();
        let numbers = Numbers(vec![1.5, -2.0]);

        let encoded = encode(&mut names, &numbers);

        assert_eq!(encoded, [2.0, 1.5, -2.0]);
        assert_eq!(decode::<Numbers>(&names, &encoded), numbers);
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

        let reply = measure_request(&Ruler, 1, &input, Vec::new(), &mut names);

        assert_eq!(
            decode::<Anchor>(&names, &reply.numbers),
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

        assert_eq!(
            measure_request(&Ruler, 2, &[], Vec::new(), &mut names).numbers,
            [3.0]
        );
    }

    #[test]
    fn an_unknown_method_replies_with_nothing() {
        let mut names = Table::default();

        assert_eq!(
            measure_request(&Ruler, 9, &[], Vec::new(), &mut names),
            Packed::default()
        );
    }

    #[derive(Clone, Debug, PartialEq, Pack)]
    enum Wrapped {
        Anchor(Anchor),
        Count(usize),
        Nothing,
    }

    #[test]
    fn a_variant_holding_one_value_is_its_index_then_the_value() {
        let mut names = Table::default();
        let wrapped = vec![
            Wrapped::Count(3),
            Wrapped::Nothing,
            Wrapped::Anchor(Anchor {
                name: None,
                x: 1.0,
                y: 2.0,
            }),
        ];

        let encoded = encode(&mut names, &wrapped);

        assert_eq!(encoded, [3.0, 1.0, 3.0, 2.0, 0.0, 0.0, 1.0, 2.0]);
        assert_eq!(decode::<Vec<Wrapped>>(&names, &encoded), wrapped);
    }

    #[derive(Clone, Debug, PartialEq, Pack)]
    struct Width(f64);

    #[derive(Clone, Debug, PartialEq, Pack)]
    #[pack(transparent)]
    struct Values {
        #[pack(numbers)]
        values: Vec<f64>,
    }

    #[test]
    fn a_struct_of_one_field_crosses_as_the_field() {
        let mut names = Table::default();
        let values = Values {
            values: vec![1.0, 2.0],
        };

        assert_eq!(encode(&mut names, &Width(5.0)), [5.0]);
        assert_eq!(encode(&mut names, &values), [2.0, 1.0, 2.0]);
        assert_eq!(decode::<Values>(&names, &[2.0, 1.0, 2.0]), values);
    }

    #[test]
    fn an_ordered_map_crosses_in_key_order() {
        let mut names = Table::default();
        let map = BTreeMap::from([("wght".to_string(), 400.0), ("wdth".to_string(), 75.0)]);
        let wdth = f64::from(names.id("wdth"));
        let wght = f64::from(names.id("wght"));

        let encoded = encode(&mut names, &map);

        assert_eq!(encoded, [2.0, wdth, 75.0, wght, 400.0]);
        assert_eq!(decode::<BTreeMap<String, f64>>(&names, &encoded), map);
    }

    #[derive(Clone, Debug, PartialEq, Pack)]
    struct Payload {
        before: f64,
        first: Bytes,
        second: Bytes,
        after: f64,
    }

    #[test]
    fn bytes_cross_as_an_index_into_the_blob_list() {
        let mut names = Table::default();
        let payload = Payload {
            before: 1.0,
            first: Bytes(vec![1, 2, 3]),
            second: Bytes(vec![]),
            after: 2.0,
        };
        let mut write = Writer::new(&mut names);
        payload.write(&mut write);
        let mut packed = write.finish();

        assert_eq!(packed.numbers, [1.0, 0.0, 1.0, 2.0]);
        assert_eq!(packed.blobs, [vec![1, 2, 3], vec![]]);
        assert_eq!(
            Payload::read(&mut Reader::new(&packed.numbers, &mut packed.blobs, &names)),
            payload
        );
    }

    #[test]
    fn bytes_past_the_blob_list_read_as_empty() {
        assert_eq!(
            Bytes::read(&mut Reader::new(&[4.0], &mut [], &Table::default())),
            Bytes::default()
        );
    }

    #[derive(Clone, Debug, PartialEq, Pack)]
    enum ReadError {
        Closed,
        Missing { name: String },
    }

    #[test]
    fn a_result_is_a_flag_set_for_ok_then_the_value_or_the_error() {
        let mut names = Table::default();
        let ok: Result<f64, ReadError> = Ok(5.0);
        let err: Result<f64, ReadError> = Err(ReadError::Missing { name: "a".into() });

        assert_eq!(encode(&mut names, &ok), [1.0, 5.0]);
        let encoded = encode(&mut names, &err);
        assert_eq!(encoded, [0.0, 1.0, 0.0]);
        assert_eq!(decode::<Result<f64, ReadError>>(&names, &encoded), err);
    }

    #[test]
    fn an_empty_reply_reads_as_an_error() {
        assert_eq!(
            decode::<Result<f64, ReadError>>(&Table::default(), &[]),
            Err(ReadError::Closed)
        );
    }

    #[interface]
    trait Store {
        fn layers(&self, names: Vec<String>) -> Result<Bytes, ReadError>;
        fn echo(&self, name: String) -> String;
    }

    struct Shelf;

    impl Store for Shelf {
        fn layers(&self, names: Vec<String>) -> Result<Bytes, ReadError> {
            match names.as_slice() {
                [] => Err(ReadError::Closed),
                [first, ..] if first == "missing" => Err(ReadError::Missing {
                    name: first.clone(),
                }),
                _ => Ok(Bytes(names.join(",").into_bytes())),
            }
        }

        fn echo(&self, name: String) -> String {
            name
        }
    }

    /// A client and a server with no name table in common, as the engine in
    /// WebAssembly and the store reader in the native addon are.
    fn client() -> StoreClient<CarryingNames<impl Fn(u32, Packed) -> Result<Packed, ()>>> {
        StoreClient(CarryingNames(|method, request: Packed| {
            Ok(request.answer_carrying_names(|input, blobs, names| {
                store_request(&Shelf, method, input, blobs, names)
            }))
        }))
    }

    #[test]
    fn a_client_calls_through_a_transport_carrying_its_names() {
        let client = client();

        assert_eq!(
            client.layers(vec!["a".into(), "b".into()]),
            Ok(Ok(Bytes(b"a,b".to_vec())))
        );
        assert_eq!(client.echo("caf\u{e9}".into()), Ok("caf\u{e9}".to_string()));
    }

    #[test]
    fn a_client_reads_the_error_a_method_returned() {
        let client = client();

        assert_eq!(client.layers(vec![]), Ok(Err(ReadError::Closed)));
        assert_eq!(
            client.layers(vec!["missing".into()]),
            Ok(Err(ReadError::Missing {
                name: "missing".into()
            }))
        );
    }

    #[interface]
    trait Counter {
        fn add(&mut self, amount: f64);
        fn total(&self) -> f64;
        fn reset(&mut self) -> Result<(), ReadError>;
    }

    #[derive(Default)]
    struct Tally(f64);

    impl Counter for Tally {
        fn add(&mut self, amount: f64) {
            self.0 += amount;
        }

        fn total(&self) -> f64 {
            self.0
        }

        fn reset(&mut self) -> Result<(), ReadError> {
            if self.0 == 0.0 {
                return Err(ReadError::Closed);
            }
            self.0 = 0.0;
            Ok(())
        }
    }

    #[test]
    fn a_method_may_change_its_target_and_return_nothing() {
        let mut names = Table::default();
        let mut tally = Tally::default();

        let added = counter_request(&mut tally, 0, &[2.5], Vec::new(), &mut names);
        let total = counter_request(&mut tally, 1, &[], Vec::new(), &mut names);

        assert_eq!(added, Packed::default());
        assert_eq!(total.numbers, [2.5]);
    }

    #[test]
    fn a_result_without_a_value_is_its_flag_alone() {
        let mut names = Table::default();
        let mut tally = Tally(1.0);

        let reset = counter_request(&mut tally, 2, &[], Vec::new(), &mut names);
        let again = counter_request(&mut tally, 2, &[], Vec::new(), &mut names);

        assert_eq!(reset.numbers, [1.0]);
        assert_eq!(again.numbers, [0.0, 0.0]);
    }

    #[test]
    fn a_map_crosses_as_its_length_then_each_key_and_value() {
        let mut names = Table::default();
        let map = HashMap::from([("wght".to_string(), 400.0)]);

        let encoded = encode(&mut names, &map);

        assert_eq!(encoded, [1.0, 0.0, 400.0]);
        assert_eq!(decode::<HashMap<String, f64>>(&names, &encoded), map);
    }

    #[derive(Clone, Debug, PartialEq, Pack)]
    struct Typed {
        #[pack(id = "GlyphId")]
        glyph: String,
        #[pack(numbers)]
        values: Vec<f64>,
    }

    #[test]
    fn a_field_typed_only_for_typescript_crosses_as_its_rust_type() {
        let mut names = Table::default();
        let typed = Typed {
            glyph: "glyph_a".into(),
            values: vec![1.0, 2.0],
        };

        let encoded = encode(&mut names, &typed);

        assert_eq!(encoded, [0.0, 2.0, 1.0, 2.0]);
        assert_eq!(decode::<Typed>(&names, &encoded), typed);
    }

    #[test]
    fn carried_names_read_back_in_id_order() {
        let mut names = CarriedNames::default();
        assert_eq!(names.id("b"), 0);
        assert_eq!(names.id("a"), 1);
        assert_eq!(names.id("b"), 0);

        let received = CarriedNames::received(&names.into_blob());

        assert_eq!(received.name(0), Some("b"));
        assert_eq!(received.name(1), Some("a"));
        assert_eq!(received.name(2), None);
    }

    #[test]
    fn a_truncated_names_table_keeps_the_names_before_the_break() {
        let mut names = CarriedNames::default();
        names.id("whole");
        names.id("cut");
        let mut blob = names.into_blob();
        blob.truncate(blob.len() - 1);

        let received = CarriedNames::received(&blob);

        assert_eq!(received.name(0), Some("whole"));
        assert_eq!(received.name(1), None);
    }
}
