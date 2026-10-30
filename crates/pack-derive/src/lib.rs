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
#[proc_macro_derive(Pack, attributes(pack))]
pub fn derive_pack(input: TokenStream) -> TokenStream {
    let input = parse_macro_input!(input as DeriveInput);
    derive(&input)
        .unwrap_or_else(Error::into_compile_error)
        .into()
}

/// Turns a trait into a request protocol.
///
/// Every method takes `&self` and arguments and a result that pack into
/// numbers. Next to the trait it writes `<trait>_request(target, method,
/// input, names)`, which calls the method at index `method` (in declaration
/// order) on `target` with the arguments decoded from `input`, and returns
/// the encoded result; an unknown index returns nothing. Its fragment gives
/// TypeScript one class per trait with a method per trait method.
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
    match &input.data {
        Data::Struct(data) => {
            let Fields::Named(fields) = &data.fields else {
                return Err(Error::new_spanned(
                    &input.ident,
                    "a packed struct needs named fields",
                ));
            };
            derive_struct(input, fields)
        }
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
        rename(&input.attrs)?.unwrap_or_else(|| name.to_string()),
    ))
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
    for field in &fields.named {
        let Some(ident) = &field.ident else { continue };
        let ty = &field.ty;
        let value = match path {
            Some(path) => quote! { &#path.#ident },
            None => quote! { #ident },
        };
        packed.push(PackedField {
            read: quote! { #ident: <#ty as ::pack::Pack>::read(read) },
            write: quote! { ::pack::Pack::write(#value, write); },
            described: json!({
                "name": rename(&field.attrs)?.unwrap_or_else(|| camel(&ident.to_string())),
                "doc": doc_of(&field.attrs),
                "type": type_of(ty)?,
            }),
        });
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
        let packed = match &variant.fields {
            Fields::Named(fields) => packed_fields(fields, None)?,
            Fields::Unit => Vec::new(),
            Fields::Unnamed(_) => {
                return Err(Error::new_spanned(
                    variant,
                    "a packed enum's variants have named fields or none",
                ));
            }
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
    let mut methods = Vec::new();
    let mut arms = Vec::new();
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
            Some(FnArg::Receiver(receiver))
                if receiver.reference.is_some() && receiver.mutability.is_none() => {}
            _ => {
                return Err(Error::new_spanned(
                    signature,
                    "an interface method takes `&self`",
                ));
            }
        }
        let mut params = Vec::new();
        let mut reads = Vec::new();
        let mut arguments = Vec::new();
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
            arguments.push(argument);
            params.push(json!({
                "name": camel(&pattern.ident.to_string()),
                "type": type_of(ty)?,
            }));
        }
        let ReturnType::Type(_, output) = &signature.output else {
            return Err(Error::new_spanned(
                signature,
                "an interface method returns a value",
            ));
        };
        let index = u32::try_from(index)
            .map_err(|_| Error::new_spanned(signature, "an interface has too many methods"))?;
        arms.push(quote! {
            #index => {
                let mut read = ::pack::Reader::new(input, &*names);
                #(#reads)*
                let result = target.#ident(#(#arguments),*);
                let mut write = ::pack::Writer::new(names);
                ::pack::Pack::write(&result, &mut write);
                write.finish()
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
         arguments in `input`, and returns its encoded result; nothing for an \
         unknown index."
    );
    Ok(quote! {
        #item

        #[doc = #docs]
        #[allow(clippy::needless_pass_by_value, unused_mut, unused_variables)]
        #visibility fn #request<T: #name + ?Sized>(
            target: &T,
            method: u32,
            input: &[f64],
            names: &mut dyn ::pack::Names,
        ) -> ::std::vec::Vec<f64> {
            match method {
                #(#arms)*
                _ => ::std::vec::Vec::new(),
            }
        }
    })
}

/// Describes a field's type for TypeScript, as Rust spells it.
fn type_of(ty: &Type) -> syn::Result<Value> {
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
        _ => json!({ "kind": "ref", "rust": ident }),
    })
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
