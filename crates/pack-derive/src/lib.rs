//! `#[derive(Pack)]` and `#[pack::interface]`, re-exported by `pack`.
//!
//! Each expands to the Rust side of a packed type and, when `PACK_TS_DIR` is
//! set, also writes a JSON fragment describing the item to
//! `$PACK_TS_DIR/<package>/`, from which `@shift/pack`'s generator
//! writes the TypeScript side. Fragments name types as Rust spells them; the
//! generator resolves them across every crate's fragments.

use proc_macro::TokenStream;
use quote::{format_ident, quote};
use serde_json::{Value, json};
use syn::{
    Attribute, Data, DeriveInput, Error, Expr, ExprLit, Fields, FnArg, GenericArgument, ItemTrait,
    Lit, LitStr, Pat, PathArguments, ReturnType, TraitItem, Type, parse_macro_input,
};

mod fragments;

/// Gives a struct with named fields, or an enum, numbers to pack into.
///
/// A struct's fields are written in declaration order. An enum is its
/// variant's index, followed by the variant's named fields when any variant
/// has them; an unknown index reads as the first variant. TypeScript reads an
/// enum of unit variants as a string union and any other as a union tagged by
/// `kind`.
/// `#[pack(rename = "…")]` names the type, a field or a variant in
/// TypeScript; by default a type keeps its name, a field is camel-cased and a
/// variant is camel-cased with a lowercase first letter.
///
/// Two field attributes change only how TypeScript types a field, never what
/// crosses: `#[pack(id = "GlyphId")]` types each text in the field (a
/// `String`, or the strings of a list, option or map key) as that id's brand,
/// which crosses as its text too; `#[pack(numbers)]` types a `Vec<f64>` as a
/// `Float64Array`, which crosses as the same count and values.
///
/// A variant may instead hold one unnamed value, written after the index;
/// TypeScript reads it as a field named after the variant, as in
/// `{ kind: "movePoints", movePoints: MovePoints }`.
///
/// `#[pack(skip)]` leaves a struct's field behind: it does not cross, and
/// reads as its type's default.
///
/// A tuple struct of one field (`struct Name(Inner)`), or a struct of one
/// named field marked `#[pack(transparent)]`, crosses as that field alone,
/// and TypeScript reads it as the field's type.
#[proc_macro_derive(Pack, attributes(pack))]
pub fn derive_pack(input: TokenStream) -> TokenStream {
    let input = parse_macro_input!(input as DeriveInput);
    derive(&input)
        .unwrap_or_else(Error::into_compile_error)
        .into()
}

/// Turns a trait into a request protocol.
///
/// Every method takes `&self` or `&mut self`, and arguments and a result
/// that pack into numbers; a method without a result returns `()`. Next to
/// the trait it writes:
///
/// - `<trait>_request(target, method, input, blobs, names)`, which calls the
///   method at index `method` (in declaration order) on `target` with the
///   arguments decoded from `input` and `blobs`, and returns the encoded
///   result as a `pack::Packed`; an unknown index returns nothing. `target`
///   is `&mut` when any method takes `&mut self`.
/// - `<Trait>Client<T>`, which sends each method through a
///   `pack::Transport` `T` and returns its result, or the transport's error:
///   the asking side, for a caller in Rust.
///
/// Its fragment gives TypeScript one class per trait with a method per trait
/// method. A method that returns `Result<T, E>` returns `T` in TypeScript and
/// throws a `PackError` carrying `E`.
#[proc_macro_attribute]
pub fn interface(attribute: TokenStream, item: TokenStream) -> TokenStream {
    if !attribute.is_empty() {
        return Error::new(
            proc_macro2::Span::call_site(),
            "#[pack::interface] takes no arguments",
        )
        .into_compile_error()
        .into();
    }
    let item = parse_macro_input!(item as ItemTrait);
    interface_for(&item)
        .unwrap_or_else(Error::into_compile_error)
        .into()
}

fn derive(input: &DeriveInput) -> syn::Result<proc_macro2::TokenStream> {
    if !input.generics.params.is_empty() {
        return Err(Error::new_spanned(
            &input.generics,
            "a packed type cannot be generic",
        ));
    }
    let options = TypeOptions::of(&input.attrs)?;
    match &input.data {
        Data::Struct(data) => match &data.fields {
            Fields::Unnamed(fields) if fields.unnamed.len() == 1 => {
                derive_transparent(input, &options, &data.fields)
            }
            Fields::Named(fields) if options.transparent && fields.named.len() == 1 => {
                derive_transparent(input, &options, &data.fields)
            }
            Fields::Named(_) if options.transparent => Err(Error::new_spanned(
                &input.ident,
                "a transparent struct has one field",
            )),
            Fields::Named(fields) => derive_struct(input, fields),
            _ => Err(Error::new_spanned(
                &input.ident,
                "a packed struct needs named fields, or one unnamed field",
            )),
        },
        Data::Enum(data)
            if data
                .variants
                .iter()
                .all(|v| matches!(v.fields, Fields::Unit)) =>
        {
            derive_unit_enum(input, data)
        }
        Data::Enum(data) => derive_data_enum(input, data),
        Data::Union(_) => Err(Error::new_spanned(&input.ident, "a union cannot be packed")),
    }
}

/// The Rust name and TypeScript name of a derived type.
fn names(input: &DeriveInput) -> syn::Result<(&syn::Ident, String)> {
    let name = &input.ident;
    Ok((
        name,
        TypeOptions::of(&input.attrs)?
            .rename
            .unwrap_or_else(|| name.to_string()),
    ))
}

/// A derived type's `#[pack(…)]` attributes.
#[derive(Default)]
struct TypeOptions {
    rename: Option<String>,
    /// Whether a struct of one named field crosses as that field.
    transparent: bool,
}

impl TypeOptions {
    fn of(attributes: &[Attribute]) -> syn::Result<Self> {
        let mut options = Self::default();
        for attribute in attributes.iter().filter(|a| a.path().is_ident("pack")) {
            attribute.parse_nested_meta(|meta| {
                if meta.path.is_ident("rename") {
                    options.rename = Some(meta.value()?.parse::<LitStr>()?.value());
                } else if meta.path.is_ident("transparent") {
                    options.transparent = true;
                } else {
                    return Err(meta.error("expected `rename = \"…\"` or `transparent`"));
                }
                Ok(())
            })?;
        }
        Ok(options)
    }
}

/// A struct of one field, which crosses as that field alone and which
/// TypeScript reads as the field's type.
fn derive_transparent(
    input: &DeriveInput,
    options: &TypeOptions,
    fields: &Fields,
) -> syn::Result<proc_macro2::TokenStream> {
    let name = &input.ident;
    let Some(field) = fields.iter().next() else {
        return Err(Error::new_spanned(
            name,
            "a transparent struct has one field",
        ));
    };
    let ty = &field.ty;
    let (construct, value) = match &field.ident {
        Some(ident) => (
            quote! { Self { #ident: <#ty as ::pack::Pack>::read(read) } },
            quote! { &self.#ident },
        ),
        None => (
            quote! { Self(<#ty as ::pack::Pack>::read(read)) },
            quote! { &self.0 },
        ),
    };
    fragments::write(
        &format!("alias-{name}"),
        &json!({
            "kind": "alias",
            "rust": name.to_string(),
            "name": options.rename.clone().unwrap_or_else(|| name.to_string()),
            "doc": doc_of(&input.attrs),
            "type": FieldOptions::of(&field.attrs)?.describe(field, type_of(ty)?)?,
        }),
    );
    Ok(quote! {
        impl ::pack::Pack for #name {
            fn read(read: &mut ::pack::Reader) -> Self {
                #construct
            }

            fn write(&self, write: &mut ::pack::Writer) {
                ::pack::Pack::write(#value, write);
            }
        }
    })
}

/// A named field's read and write, and its description for TypeScript.
struct PackedField {
    read: proc_macro2::TokenStream,
    write: proc_macro2::TokenStream,
    described: Value,
}

/// Each of `fields`' read, written as `<field>: read`, and write of `<path>.<field>`
/// (or of the binding `<field>` when `path` is `None`).
fn packed_fields(
    fields: &syn::FieldsNamed,
    path: Option<&proc_macro2::TokenStream>,
) -> syn::Result<Vec<PackedField>> {
    let mut packed = Vec::new();
    let mut skipped = Vec::new();
    for field in &fields.named {
        let Some(ident) = &field.ident else { continue };
        let ty = &field.ty;
        let value = match path {
            Some(path) => quote! { &#path.#ident },
            None => quote! { #ident },
        };
        let options = FieldOptions::of(&field.attrs)?;
        if options.skip {
            if path.is_none() {
                return Err(Error::new_spanned(
                    field,
                    "`skip` leaves out a struct's field, not a variant's",
                ));
            }
            skipped.push(quote! { #ident: ::std::default::Default::default() });
            continue;
        }
        packed.push(PackedField {
            read: quote! { #ident: <#ty as ::pack::Pack>::read(read) },
            write: quote! { ::pack::Pack::write(#value, write); },
            described: json!({
                "name": options.rename.clone().unwrap_or_else(|| camel(&ident.to_string())),
                "doc": doc_of(&field.attrs),
                "type": options.describe(field, type_of(ty)?)?,
            }),
        });
    }
    // A skipped field reads as its default, after the fields that cross.
    if skipped.is_empty() {
        return Ok(packed);
    }
    if let Some(last) = packed.last_mut() {
        let read = &last.read;
        last.read = quote! { #read, #(#skipped),* };
    } else {
        return Err(Error::new_spanned(
            &fields.named,
            "a packed struct keeps a field that crosses",
        ));
    }
    Ok(packed)
}

fn derive_struct(
    input: &DeriveInput,
    fields: &syn::FieldsNamed,
) -> syn::Result<proc_macro2::TokenStream> {
    let (name, ts_name) = names(input)?;
    let packed = packed_fields(fields, Some(&quote! { self }))?;
    let reads = packed.iter().map(|field| &field.read);
    let writes = packed.iter().map(|field| &field.write);
    fragments::write(
        &format!("struct-{name}"),
        &json!({
            "kind": "struct",
            "rust": name.to_string(),
            "name": ts_name,
            "doc": doc_of(&input.attrs),
            "fields": packed.iter().map(|field| &field.described).collect::<Vec<_>>(),
        }),
    );
    Ok(quote! {
        impl ::pack::Pack for #name {
            fn read(read: &mut ::pack::Reader) -> Self {
                // Struct expressions evaluate their fields in source order.
                Self { #(#reads,)* }
            }

            fn write(&self, write: &mut ::pack::Writer) {
                #(#writes)*
            }
        }
    })
}

/// The TypeScript names of an enum's variants: renamed, or camel-cased with a
/// lowercase first letter.
fn variant_names(data: &syn::DataEnum) -> syn::Result<Vec<String>> {
    data.variants
        .iter()
        .map(|variant| {
            Ok(rename(&variant.attrs)?.unwrap_or_else(|| lower_first(&variant.ident.to_string())))
        })
        .collect()
}

fn derive_unit_enum(
    input: &DeriveInput,
    data: &syn::DataEnum,
) -> syn::Result<proc_macro2::TokenStream> {
    let (name, ts_name) = names(input)?;
    let variants: Vec<_> = data.variants.iter().map(|variant| &variant.ident).collect();
    let Some(first) = variants.first() else {
        return Err(Error::new_spanned(name, "a packed enum needs a variant"));
    };
    let indices = 0..variants.len();
    let read_indices = indices.clone();
    fragments::write(
        &format!("enum-{name}"),
        &json!({
            "kind": "enum",
            "rust": name.to_string(),
            "name": ts_name,
            "doc": doc_of(&input.attrs),
            "variants": variant_names(data)?,
        }),
    );
    Ok(quote! {
        impl ::pack::Pack for #name {
            fn read(read: &mut ::pack::Reader) -> Self {
                match read.count() {
                    #(#read_indices => Self::#variants,)*
                    _ => Self::#first,
                }
            }

            fn write(&self, write: &mut ::pack::Writer) {
                write.count(match self {
                    #(Self::#variants => #indices,)*
                });
            }
        }
    })
}

/// An enum whose variants carry named fields (or none): the variant's index,
/// then its fields in order. TypeScript reads it as a union tagged by `kind`.
fn derive_data_enum(
    input: &DeriveInput,
    data: &syn::DataEnum,
) -> syn::Result<proc_macro2::TokenStream> {
    let (name, ts_name) = names(input)?;
    let mut reads = Vec::new();
    let mut writes = Vec::new();
    let mut cases = Vec::new();
    for ((index, variant), tag) in data.variants.iter().enumerate().zip(variant_names(data)?) {
        let ident = &variant.ident;
        if let Fields::Unnamed(fields) = &variant.fields {
            let [field] = fields.unnamed.iter().collect::<Vec<_>>()[..] else {
                return Err(Error::new_spanned(
                    variant,
                    "a packed enum's variants have named fields, one unnamed value, or none",
                ));
            };
            let ty = &field.ty;
            reads.push(quote! { #index => Self::#ident(<#ty as ::pack::Pack>::read(read)), });
            if index == 0 {
                reads.push(quote! { _ => Self::#ident(<#ty as ::pack::Pack>::read(read)), });
            }
            writes.push(quote! {
                Self::#ident(value) => {
                    write.count(#index);
                    ::pack::Pack::write(value, write);
                }
            });
            cases.push(json!({
                "name": tag,
                "doc": doc_of(&variant.attrs),
                "fields": [{
                    "name": tag,
                    "doc": Value::Null,
                    "type": FieldOptions::of(&field.attrs)?.describe(field, type_of(ty)?)?,
                }],
            }));
            continue;
        }
        let packed = match &variant.fields {
            Fields::Named(fields) => packed_fields(fields, None)?,
            _ => Vec::new(),
        };
        let bindings: Vec<_> = match &variant.fields {
            Fields::Named(fields) => fields
                .named
                .iter()
                .filter_map(|f| f.ident.as_ref())
                .collect(),
            _ => Vec::new(),
        };
        let field_reads = packed.iter().map(|field| &field.read);
        let field_writes = packed.iter().map(|field| &field.write);
        let construct = if matches!(variant.fields, Fields::Unit) {
            quote! { Self::#ident }
        } else {
            quote! { Self::#ident { #(#field_reads,)* } }
        };
        let pattern = if matches!(variant.fields, Fields::Unit) {
            quote! { Self::#ident }
        } else {
            quote! { Self::#ident { #(#bindings,)* } }
        };
        reads.push(quote! { #index => #construct, });
        if index == 0 {
            reads.push(quote! { _ => #construct, });
        }
        writes.push(quote! {
            #pattern => {
                write.count(#index);
                #(#field_writes)*
            }
        });
        cases.push(json!({
            "name": tag,
            "doc": doc_of(&variant.attrs),
            "fields": packed.iter().map(|field| &field.described).collect::<Vec<_>>(),
        }));
    }
    if cases.is_empty() {
        return Err(Error::new_spanned(name, "a packed enum needs a variant"));
    }
    // The first variant also reads an unknown index, so it is listed twice;
    // move the catch-all last.
    let catch_all = reads.remove(1);
    reads.push(catch_all);
    fragments::write(
        &format!("union-{name}"),
        &json!({
            "kind": "union",
            "rust": name.to_string(),
            "name": ts_name,
            "doc": doc_of(&input.attrs),
            "cases": cases,
        }),
    );
    Ok(quote! {
        impl ::pack::Pack for #name {
            fn read(read: &mut ::pack::Reader) -> Self {
                match read.count() {
                    #(#reads)*
                }
            }

            fn write(&self, write: &mut ::pack::Writer) {
                match self {
                    #(#writes)*
                }
            }
        }
    })
}

/// Packs an id type as its text, interned in the module's name table.
///
/// The type must have `as_str(&self) -> &str` and `from_raw(impl Display)`.
/// TypeScript reads it as the brand of the same name imported from the module
/// given with `#[pack(brand = "…")]`.
#[proc_macro_derive(PackId, attributes(pack))]
pub fn derive_pack_id(input: TokenStream) -> TokenStream {
    let input = parse_macro_input!(input as DeriveInput);
    pack_id(&input)
        .unwrap_or_else(Error::into_compile_error)
        .into()
}

fn pack_id(input: &DeriveInput) -> syn::Result<proc_macro2::TokenStream> {
    let name = &input.ident;
    let mut brand = None;
    for attribute in input.attrs.iter().filter(|a| a.path().is_ident("pack")) {
        attribute.parse_nested_meta(|meta| {
            if meta.path.is_ident("brand") {
                brand = Some(meta.value()?.parse::<LitStr>()?.value());
                Ok(())
            } else {
                Err(meta.error("expected `brand = \"…\"`"))
            }
        })?;
    }
    let Some(brand) = brand else {
        return Err(Error::new_spanned(
            name,
            "an id names the module of its TypeScript brand: #[pack(brand = \"…\")]",
        ));
    };
    fragments::write(
        &format!("id-{name}"),
        &json!({
            "kind": "id",
            "rust": name.to_string(),
            "name": name.to_string(),
            "doc": Value::Null,
            "module": brand,
        }),
    );
    Ok(quote! {
        impl ::pack::Pack for #name {
            fn read(read: &mut ::pack::Reader) -> Self {
                Self::from_raw(read.name())
            }

            fn write(&self, write: &mut ::pack::Writer) {
                write.name(self.as_str());
            }
        }
    })
}

fn interface_for(item: &ItemTrait) -> syn::Result<proc_macro2::TokenStream> {
    let name = &item.ident;
    let visibility = &item.vis;
    let request = format_ident!("{}_request", snake(&name.to_string()));
    let client = format_ident!("{name}Client");
    let mut methods = Vec::new();
    let mut arms = Vec::new();
    let mut client_methods = Vec::new();
    let mut mutable = false;
    for (index, trait_item) in item.items.iter().enumerate() {
        let TraitItem::Fn(method) = trait_item else {
            return Err(Error::new_spanned(
                trait_item,
                "an interface holds only methods",
            ));
        };
        let signature = &method.sig;
        let ident = &signature.ident;
        let mut inputs = signature.inputs.iter();
        match inputs.next() {
            Some(FnArg::Receiver(receiver)) if receiver.reference.is_some() => {
                mutable |= receiver.mutability.is_some();
            }
            _ => {
                return Err(Error::new_spanned(
                    signature,
                    "an interface method takes `&self` or `&mut self`",
                ));
            }
        }
        let mut params = Vec::new();
        let mut reads = Vec::new();
        let mut arguments = Vec::new();
        let mut client_params = Vec::new();
        let mut client_writes = Vec::new();
        for (position, input) in inputs.enumerate() {
            let FnArg::Typed(typed) = input else {
                continue;
            };
            let Pat::Ident(pattern) = typed.pat.as_ref() else {
                return Err(Error::new_spanned(
                    &typed.pat,
                    "an interface argument needs a plain name",
                ));
            };
            let ty = &typed.ty;
            let argument = format_ident!("argument{position}");
            reads.push(quote! { let #argument = <#ty as ::pack::Pack>::read(&mut read); });
            let parameter = &pattern.ident;
            client_params.push(quote! { #parameter: #ty });
            client_writes.push(quote! { ::pack::Pack::write(&#parameter, write); });
            arguments.push(argument);
            params.push(json!({
                "name": camel(&pattern.ident.to_string()),
                "type": type_of(ty)?,
            }));
        }
        let unit: Type = syn::parse_quote! { () };
        let output = match &signature.output {
            ReturnType::Type(_, output) => output.as_ref(),
            ReturnType::Default => &unit,
        };
        let index = u32::try_from(index)
            .map_err(|_| Error::new_spanned(signature, "an interface has too many methods"))?;
        arms.push(quote! {
            #index => {
                let mut read = ::pack::Reader::new(input, &mut blobs, &*names);
                #(#reads)*
                let result = target.#ident(#(#arguments),*);
                let mut write = ::pack::Writer::new(names);
                ::pack::Pack::write(&result, &mut write);
                write.finish()
            }
        });
        let method_docs = &method
            .attrs
            .iter()
            .filter(|a| a.path().is_ident("doc"))
            .collect::<Vec<_>>();
        client_methods.push(quote! {
            #(#method_docs)*
            ///
            /// The outer `Result` is the transport's: its error when the
            /// request gets no reply.
            pub fn #ident(&self, #(#client_params),*) -> ::std::result::Result<#output, T::Error> {
                self.0.call(#index, |write| {
                    #(#client_writes)*
                })
            }
        });
        methods.push(json!({
            "name": camel(&ident.to_string()),
            "doc": doc_of(&method.attrs),
            "params": params,
            "output": type_of(output)?,
        }));
    }
    fragments::write(
        &format!("interface-{name}"),
        &json!({
            "kind": "interface",
            "rust": name.to_string(),
            "name": name.to_string(),
            "doc": doc_of(&item.attrs),
            "methods": methods,
        }),
    );
    let docs = format!(
        "Calls the [`{name}`] method at index `method` on `target` with the \
         arguments in `input` and `blobs`, and returns its encoded result; \
         nothing for an unknown index."
    );
    let client_docs = format!(
        "Asks for [`{name}`]'s methods through a [`pack::Transport`]: each \
         method sends its arguments by the method's index and reads the reply."
    );
    let target = if mutable {
        quote! { &mut T }
    } else {
        quote! { &T }
    };
    Ok(quote! {
        #item

        #[doc = #docs]
        #[allow(clippy::needless_pass_by_value, unused_mut, unused_variables)]
        #visibility fn #request<T: #name + ?Sized>(
            target: #target,
            method: u32,
            input: &[f64],
            mut blobs: ::std::vec::Vec<::std::vec::Vec<u8>>,
            names: &mut dyn ::pack::Names,
        ) -> ::pack::Packed {
            match method {
                #(#arms)*
                _ => ::pack::Packed::default(),
            }
        }

        #[doc = #client_docs]
        #[allow(dead_code)]
        #visibility struct #client<T>(pub T);

        #[allow(dead_code, clippy::needless_pass_by_value, clippy::missing_errors_doc)]
        impl<T: ::pack::Transport> #client<T> {
            #(#client_methods)*
        }
    })
}

/// Describes a field's type for TypeScript, as Rust spells it.
fn type_of(ty: &Type) -> syn::Result<Value> {
    // A type a `macro_rules!` macro passed through as `$ty:ty` arrives grouped.
    if let Type::Group(group) = ty {
        return type_of(&group.elem);
    }
    if let Type::Tuple(tuple) = ty
        && tuple.elems.is_empty()
    {
        return Ok(json!({ "kind": "unit" }));
    }
    let Type::Path(path) = ty else {
        return Err(Error::new_spanned(ty, "a packed type is a path"));
    };
    let Some(segment) = path.path.segments.last() else {
        return Err(Error::new_spanned(ty, "a packed type is a path"));
    };
    let ident = segment.ident.to_string();
    let inner = || -> syn::Result<Value> {
        let PathArguments::AngleBracketed(arguments) = &segment.arguments else {
            return Err(Error::new_spanned(ty, "expected one type argument"));
        };
        match arguments.args.first() {
            Some(GenericArgument::Type(inner)) if arguments.args.len() == 1 => type_of(inner),
            _ => Err(Error::new_spanned(ty, "expected one type argument")),
        }
    };
    Ok(match ident.as_str() {
        "f64" | "i32" => json!({ "kind": "number" }),
        "usize" | "u32" => json!({ "kind": "count" }),
        "Numbers" => json!({ "kind": "numbers" }),
        "bool" => json!({ "kind": "flag" }),
        "String" => json!({ "kind": "name" }),
        "Vec" => json!({ "kind": "list", "item": inner()? }),
        "Option" => json!({ "kind": "option", "inner": inner()? }),
        "Bytes" => json!({ "kind": "bytes" }),
        "Result" => {
            let [ok, err] = two_arguments(ty, segment)?;
            json!({ "kind": "result", "ok": type_of(ok)?, "err": type_of(err)? })
        }
        "HashMap" | "BTreeMap" => {
            let [key, value] = two_arguments(ty, segment)?;
            json!({ "kind": "map", "key": type_of(key)?, "value": type_of(value)? })
        }
        _ => json!({ "kind": "ref", "rust": ident }),
    })
}

/// The two type arguments of a `Result` or a map.
fn two_arguments<'a>(ty: &Type, segment: &'a syn::PathSegment) -> syn::Result<[&'a Type; 2]> {
    let PathArguments::AngleBracketed(arguments) = &segment.arguments else {
        return Err(Error::new_spanned(ty, "expected two type arguments"));
    };
    let types: Vec<_> = arguments
        .args
        .iter()
        .filter_map(|argument| match argument {
            GenericArgument::Type(inner) => Some(inner),
            _ => None,
        })
        .collect();
    match types.as_slice() {
        [first, second] => Ok([*first, *second]),
        _ => Err(Error::new_spanned(ty, "expected two type arguments")),
    }
}

/// A field's `#[pack(…)]` attributes.
#[derive(Default)]
struct FieldOptions {
    rename: Option<String>,
    /// The id whose brand types the field's text.
    id: Option<String>,
    /// Whether the field's `Vec<f64>` is typed as a `Float64Array`.
    numbers: bool,
    /// Whether the field stays behind: it does not cross, and reads as its
    /// type's default.
    skip: bool,
}

impl FieldOptions {
    fn of(attributes: &[Attribute]) -> syn::Result<Self> {
        let mut options = Self::default();
        for attribute in attributes.iter().filter(|a| a.path().is_ident("pack")) {
            attribute.parse_nested_meta(|meta| {
                if meta.path.is_ident("rename") {
                    options.rename = Some(meta.value()?.parse::<LitStr>()?.value());
                } else if meta.path.is_ident("id") {
                    options.id = Some(meta.value()?.parse::<LitStr>()?.value());
                } else if meta.path.is_ident("numbers") {
                    options.numbers = true;
                } else if meta.path.is_ident("skip") {
                    options.skip = true;
                } else {
                    return Err(
                        meta.error("expected `rename = \"…\"`, `id = \"…\"`, `numbers` or `skip`")
                    );
                }
                Ok(())
            })?;
        }
        Ok(options)
    }

    /// `described`, the field's type as Rust spells it, as TypeScript types
    /// it: with its text typed as the id's brand, or its numbers as a
    /// `Float64Array`.
    fn describe(&self, field: &syn::Field, mut described: Value) -> syn::Result<Value> {
        if let Some(id) = &self.id
            && !replace(
                &mut described,
                &json!({ "kind": "name" }),
                &json!({ "kind": "ref", "rust": id }),
            )
        {
            return Err(Error::new_spanned(
                field,
                "`id` types a field that holds a `String`",
            ));
        }
        if self.numbers
            && !replace(
                &mut described,
                &json!({ "kind": "list", "item": { "kind": "number" } }),
                &json!({ "kind": "numbers" }),
            )
        {
            return Err(Error::new_spanned(
                field,
                "`numbers` types a field that holds a `Vec<f64>`",
            ));
        }
        Ok(described)
    }
}

/// Replaces every `from` in `value` with `to`; whether any was replaced.
fn replace(value: &mut Value, from: &Value, to: &Value) -> bool {
    if value == from {
        *value = to.clone();
        return true;
    }
    match value {
        Value::Object(entries) => entries
            .values_mut()
            .fold(false, |replaced, entry| replace(entry, from, to) | replaced),
        _ => false,
    }
}

/// The `rename` in a `#[pack(rename = "…")]` attribute, if any.
fn rename(attributes: &[Attribute]) -> syn::Result<Option<String>> {
    let mut renamed = None;
    for attribute in attributes.iter().filter(|a| a.path().is_ident("pack")) {
        attribute.parse_nested_meta(|meta| {
            if meta.path.is_ident("rename") {
                renamed = Some(meta.value()?.parse::<LitStr>()?.value());
                Ok(())
            } else {
                Err(meta.error("expected `rename = \"…\"`"))
            }
        })?;
    }
    Ok(renamed)
}

/// The doc comment on an item, its lines trimmed and joined.
fn doc(attributes: &[Attribute]) -> String {
    attributes
        .iter()
        .filter(|a| a.path().is_ident("doc"))
        .filter_map(|a| match &a.meta.require_name_value().ok()?.value {
            Expr::Lit(ExprLit {
                lit: Lit::Str(text),
                ..
            }) => Some(text.value().trim().to_string()),
            _ => None,
        })
        .collect::<Vec<_>>()
        .join("\n")
}

fn doc_of(attributes: &[Attribute]) -> Value {
    let text = doc(attributes);
    if text.is_empty() {
        Value::Null
    } else {
        Value::String(text)
    }
}

/// `t_center_x` → `tCenterX`.
fn camel(snake: &str) -> String {
    let mut out = String::with_capacity(snake.len());
    let mut upper = false;
    for character in snake.chars() {
        if character == '_' {
            upper = true;
        } else if upper {
            out.extend(character.to_uppercase());
            upper = false;
        } else {
            out.push(character);
        }
    }
    out
}

/// `OnCurve` → `onCurve`.
fn lower_first(name: &str) -> String {
    let mut characters = name.chars();
    characters.next().map_or_else(String::new, |first| {
        first.to_lowercase().chain(characters).collect()
    })
}

/// `EngineReads` → `engine_reads`.
fn snake(name: &str) -> String {
    let mut out = String::with_capacity(name.len() + 4);
    for (index, character) in name.chars().enumerate() {
        if character.is_uppercase() {
            if index > 0 {
                out.push('_');
            }
            out.extend(character.to_lowercase());
        } else {
            out.push(character);
        }
    }
    out
}
