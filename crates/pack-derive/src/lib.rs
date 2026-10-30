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

/// Gives a struct with named fields, or an enum of unit variants, numbers to pack
/// into.
///
/// A struct's fields are written in declaration order; an enum is its
/// variant's index, and an unknown index reads as the first variant.
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
    let name = &input.ident;
    let ts_name = rename(&input.attrs)?.unwrap_or_else(|| name.to_string());
    match &input.data {
        Data::Struct(data) => {
            let Fields::Named(fields) = &data.fields else {
                return Err(Error::new_spanned(
                    name,
                    "a packed struct needs named fields",
                ));
            };
            let mut described = Vec::new();
            let mut reads = Vec::new();
            let mut writes = Vec::new();
            for field in &fields.named {
                let Some(ident) = &field.ident else { continue };
                let ty = &field.ty;
                reads.push(quote! { #ident: <#ty as ::pack::Pack>::read(read) });
                writes.push(quote! { ::pack::Pack::write(&self.#ident, write); });
                described.push(json!({
                    "name": rename(&field.attrs)?.unwrap_or_else(|| camel(&ident.to_string())),
                    "doc": doc_of(&field.attrs),
                    "type": type_of(ty)?,
                }));
            }
            fragments::write(
                &format!("struct-{name}"),
                &json!({
                    "kind": "struct",
                    "rust": name.to_string(),
                    "name": ts_name,
                    "doc": doc_of(&input.attrs),
                    "fields": described,
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
        Data::Enum(data) => {
            let mut variants = Vec::new();
            let mut names = Vec::new();
            for variant in &data.variants {
                if !matches!(variant.fields, Fields::Unit) {
                    return Err(Error::new_spanned(
                        variant,
                        "a packed enum's variants carry no data",
                    ));
                }
                let ident = &variant.ident;
                variants.push(ident);
                names.push(
                    rename(&variant.attrs)?.unwrap_or_else(|| lower_first(&ident.to_string())),
                );
            }
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
                    "variants": names,
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
        Data::Union(_) => Err(Error::new_spanned(name, "a union cannot be packed")),
    }
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
        "f64" => json!({ "kind": "number" }),
        "usize" => json!({ "kind": "count" }),
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
