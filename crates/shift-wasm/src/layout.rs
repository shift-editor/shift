//! Number layouts of values that cross the boundary in hot calls.
//!
//! A hot call takes and returns one flat `Float64Array`. Each value's layout
//! is declared once, here in Rust, with [`layout!`] (a struct this crate
//! owns), [`foreign_layout!`] (a shift-font struct), or [`enum_layout!`]. The
//! declaration gives the Rust side its [`Layout::read`] and [`Layout::write`]
//! and describes itself as a [`Kind`], from which a `generated_file_` test
//! writes the editor's TypeScript encoders and decoders
//! (`packages/editor/src/lib/wasm/layouts.ts`). The two sides cannot disagree
//! about field order without that test failing.
//!
//! Fields are written in declaration order: a number, flag, or count is one
//! value; a name is its interned id ([`crate::names`]); a list is its length
//! followed by its items; an optional value is a flag followed by the value
//! when present.

use crate::names::{NameTable, with_names};

/// Reads numbers in order from a call's input.
///
/// Reading past the end yields zeros, so a short input decodes to empty and
/// zero values rather than panicking inside the module.
pub(crate) struct Reader<'a> {
    values: &'a [f64],
    at: usize,
    names: &'a dyn NameTable,
}

impl<'a> Reader<'a> {
    pub fn new(values: &'a [f64], names: &'a dyn NameTable) -> Self {
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
}

/// Appends numbers to a call's output.
pub(crate) struct Writer<'a> {
    values: Vec<f64>,
    names: &'a mut dyn NameTable,
}

impl<'a> Writer<'a> {
    pub fn new(names: &'a mut dyn NameTable) -> Self {
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

/// Runs a hot call: decodes `input` as `I`, applies `rule`, and encodes its
/// result.
///
/// `rule` must not intern names itself; names in `I` are already resolved
/// and names in `O` are interned while encoding.
pub(crate) fn call<I: Layout, O: Layout>(input: &[f64], rule: impl FnOnce(I) -> O) -> Vec<f64> {
    with_names(|names| {
        let value = I::read(&mut Reader::new(input, &*names));
        let result = rule(value);
        let mut write = Writer::new(names);
        result.write(&mut write);
        write.finish()
    })
}

/// A value with a number layout.
pub(crate) trait Layout: Sized {
    fn read(read: &mut Reader) -> Self;
    fn write(&self, write: &mut Writer);
    /// Describes the layout, for generating the TypeScript side.
    #[cfg(test)]
    fn kind() -> Kind;
}

/// What a layout is made of, as the TypeScript generator reads it.
#[cfg(test)]
#[derive(Clone, Debug)]
pub(crate) enum Kind {
    Number,
    Flag,
    Count,
    Name,
    List(Box<Self>),
    Optional(Box<Self>),
    Struct(StructKind),
    Enum(EnumKind),
}

/// A struct layout's fields, in order.
#[cfg(test)]
#[derive(Clone, Debug)]
pub(crate) struct StructKind {
    /// The TypeScript interface name.
    pub name: &'static str,
    pub doc: &'static str,
    pub fields: Vec<FieldKind>,
}

#[cfg(test)]
#[derive(Clone, Debug)]
pub(crate) struct FieldKind {
    /// The TypeScript property name.
    pub name: &'static str,
    pub doc: &'static str,
    pub kind: Kind,
}

/// An enum written as its variant's index, read in TypeScript as a string.
#[cfg(test)]
#[derive(Clone, Debug)]
pub(crate) struct EnumKind {
    pub name: &'static str,
    pub doc: &'static str,
    pub variants: &'static [&'static str],
}

impl Layout for f64 {
    fn read(read: &mut Reader) -> Self {
        read.number()
    }

    fn write(&self, write: &mut Writer) {
        write.number(*self);
    }

    #[cfg(test)]
    fn kind() -> Kind {
        Kind::Number
    }
}

impl Layout for usize {
    fn read(read: &mut Reader) -> Self {
        read.count()
    }

    fn write(&self, write: &mut Writer) {
        write.count(*self);
    }

    #[cfg(test)]
    fn kind() -> Kind {
        Kind::Count
    }
}

impl Layout for bool {
    fn read(read: &mut Reader) -> Self {
        read.flag()
    }

    fn write(&self, write: &mut Writer) {
        write.flag(*self);
    }

    #[cfg(test)]
    fn kind() -> Kind {
        Kind::Flag
    }
}

impl Layout for String {
    fn read(read: &mut Reader) -> Self {
        read.name()
    }

    fn write(&self, write: &mut Writer) {
        write.name(self);
    }

    #[cfg(test)]
    fn kind() -> Kind {
        Kind::Name
    }
}

impl<T: Layout> Layout for Vec<T> {
    fn read(read: &mut Reader) -> Self {
        let count = read.count();
        // A corrupt count must not reserve unbounded memory; items past the
        // end of the input read as zeros.
        let mut items = Self::with_capacity(count.min(read.values.len()));
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

    #[cfg(test)]
    fn kind() -> Kind {
        Kind::List(Box::new(T::kind()))
    }
}

impl<T: Layout> Layout for Option<T> {
    fn read(read: &mut Reader) -> Self {
        read.flag().then(|| T::read(read))
    }

    fn write(&self, write: &mut Writer) {
        write.flag(self.is_some());
        if let Some(value) = self {
            value.write(write);
        }
    }

    #[cfg(test)]
    fn kind() -> Kind {
        Kind::Optional(Box::new(T::kind()))
    }
}

/// Declares a struct this crate owns and its number layout.
///
/// Fields are read and written in declaration order; the TypeScript
/// interface takes the struct's name and camel-cased field names, or the
/// name given with `field: Type => typeScriptName`.
macro_rules! layout {
    (
        $(#[doc = $doc:literal])*
        pub struct $name:ident {
            $(
                $(#[doc = $field_doc:literal])*
                pub $field:ident: $ty:ty $(=> $ts_field:ident)?,
            )*
        }
    ) => {
        $(#[doc = $doc])*
        #[derive(Clone, Debug, PartialEq)]
        pub struct $name {
            $(
                $(#[doc = $field_doc])*
                pub $field: $ty,
            )*
        }

        $crate::layout::foreign_layout! {
            $(#[doc = $doc])*
            $name => $name {
                $(
                    $(#[doc = $field_doc])*
                    $field: $ty $(=> $ts_field)?,
                )*
            }
        }
    };
}

/// Declares the number layout of a struct another crate owns.
///
/// `RustName => TypeScriptName` names the interface; fields not listed are
/// not part of the layout. A field may be renamed for TypeScript with
/// `field: Type => typeScriptName`.
macro_rules! foreign_layout {
    (
        $(#[doc = $doc:literal])*
        $name:ident => $ts_name:ident {
            $(
                $(#[doc = $field_doc:literal])*
                $field:ident: $ty:ty $(=> $ts_field:ident)?,
            )*
        }
    ) => {
        impl $crate::layout::Layout for $name {
            fn read(read: &mut $crate::layout::Reader) -> Self {
                // Struct expressions evaluate their fields in source order.
                Self {
                    $($field: <$ty as $crate::layout::Layout>::read(read),)*
                }
            }

            fn write(&self, write: &mut $crate::layout::Writer) {
                $($crate::layout::Layout::write(&self.$field, write);)*
            }

            #[cfg(test)]
            fn kind() -> $crate::layout::Kind {
                $crate::layout::Kind::Struct($crate::layout::StructKind {
                    name: stringify!($ts_name),
                    doc: concat!($($doc, "\n",)*),
                    fields: vec![$(
                        $crate::layout::FieldKind {
                            name: $crate::layout::foreign_layout!(@name $field $($ts_field)?),
                            doc: concat!($($field_doc, "\n",)*),
                            kind: <$ty as $crate::layout::Layout>::kind(),
                        },
                    )*],
                })
            }
        }
    };
    (@name $field:ident $ts_field:ident) => { stringify!($ts_field) };
    (@name $field:ident) => { stringify!($field) };
}

/// Declares the number layout of a fieldless enum: its variant's index,
/// read in TypeScript as the variant's camel-cased name.
macro_rules! enum_layout {
    (
        $(#[doc = $doc:literal])*
        $name:ident { $($variant:ident => $ts_variant:literal,)* }
    ) => {
        impl $crate::layout::Layout for $name {
            fn read(read: &mut $crate::layout::Reader) -> Self {
                const VARIANTS: &[$name] = &[$($name::$variant,)*];
                VARIANTS.get(read.count()).copied().unwrap_or_default()
            }

            fn write(&self, write: &mut $crate::layout::Writer) {
                const VARIANTS: &[$name] = &[$($name::$variant,)*];
                let index = VARIANTS.iter().position(|variant| variant == self).unwrap_or(0);
                write.count(index);
            }

            #[cfg(test)]
            fn kind() -> $crate::layout::Kind {
                $crate::layout::Kind::Enum($crate::layout::EnumKind {
                    name: stringify!($name),
                    doc: concat!($($doc, "\n",)*),
                    variants: &[$($ts_variant,)*],
                })
            }
        }
    };
}

pub(crate) use {enum_layout, foreign_layout, layout};

#[cfg(test)]
mod typescript;

#[cfg(test)]
mod tests {
    use shift_font::ComponentAlignment;

    use super::*;
    use crate::anchors::{AlignmentAnchor, FollowingComponent};

    fn encode<T: Layout>(value: &T) -> Vec<f64> {
        with_names(|names| {
            let mut write = Writer::new(names);
            value.write(&mut write);
            write.finish()
        })
    }

    fn decode<T: Layout>(values: &[f64]) -> T {
        with_names(|names| T::read(&mut Reader::new(values, &*names)))
    }

    fn component() -> FollowingComponent {
        FollowingComponent {
            alignment: ComponentAlignment::Free,
            transform: shift_font::DecomposedTransform {
                translate_x: 10.0,
                ..Default::default()
            },
            accepted_transform: None,
            anchors: vec![
                AlignmentAnchor {
                    name: Some("top".into()),
                    x: 1.0,
                    y: 2.0,
                },
                AlignmentAnchor {
                    name: None,
                    x: 3.0,
                    y: 4.0,
                },
            ],
            accepted_anchors: vec![],
        }
    }

    #[test]
    fn a_layout_reads_back_what_it_wrote() {
        let components = vec![component(), component()];

        assert_eq!(
            decode::<Vec<FollowingComponent>>(&encode(&components)),
            components
        );
    }

    #[test]
    fn fields_are_written_in_declaration_order() {
        let anchor = AlignmentAnchor {
            name: None,
            x: 3.0,
            y: 4.0,
        };

        assert_eq!(encode(&anchor), [0.0, 3.0, 4.0]);
    }

    #[test]
    fn an_enum_is_its_variant_index() {
        assert_eq!(encode(&ComponentAlignment::Free), [2.0]);
        assert_eq!(
            decode::<ComponentAlignment>(&[1.0]),
            ComponentAlignment::Anchored
        );
    }

    #[test]
    fn an_unknown_enum_index_reads_as_the_default() {
        assert_eq!(
            decode::<ComponentAlignment>(&[7.0]),
            ComponentAlignment::Unset
        );
    }

    #[test]
    fn a_name_crosses_as_its_interned_id() {
        let encoded = encode(&"bottom".to_string());

        assert_eq!(encoded.len(), 1);
        assert_eq!(decode::<String>(&encoded), "bottom");
    }

    #[test]
    fn a_short_input_reads_as_zeros_without_panicking() {
        let components = decode::<Vec<FollowingComponent>>(&[2.0, 1.0]);

        assert_eq!(components.len(), 2);
        assert_eq!(components[0].alignment, ComponentAlignment::Anchored);
        assert!(components[1].anchors.is_empty());
    }
}
