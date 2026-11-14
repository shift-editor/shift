//! `test-only-pub`: a public function that only test code names. Rust can't
//! see callers in JavaScript, so functions exported through napi or
//! WebAssembly are left out, as are `test_support` modules, which exist for
//! tests.

use std::collections::{BTreeMap, BTreeSet};
use std::path::{Path, PathBuf};

use proc_macro2::{TokenStream, TokenTree};
use quote::ToTokens;
use syn::ItemFn;
use syn::visit::{self, Visit};

use crate::finding::{Finding, Kind};
use crate::syntax;
use crate::test_code::Role;

/// Attributes that export a function to JavaScript, whose callers Rust can't see.
const EXPORTS: [&str; 3] = ["napi", "wasm_bindgen", "no_mangle"];

fn is_exported(attrs: &[syn::Attribute]) -> bool {
    attrs.iter().any(|attr| {
        attr.path()
            .segments
            .last()
            .is_some_and(|segment| EXPORTS.contains(&segment.ident.to_string().as_str()))
    })
}

/// One public function of library code, a candidate for `test-only-pub`.
pub(crate) struct PublicFn {
    path: PathBuf,
    line: usize,
    name: String,
}

/// What `test-only-pub` needs from one crate: its public functions, the
/// names library code uses and defines, and the names test code uses.
#[derive(Default)]
pub(crate) struct NameUses {
    public: Vec<PublicFn>,
    library: BTreeMap<String, usize>,
    definitions: BTreeMap<String, usize>,
    tests: BTreeSet<String>,
}

impl NameUses {
    /// Records one file: `code` is it without tests, `syntax` with them.
    pub(crate) fn add_file(
        &mut self,
        path: &Path,
        syntax: &syn::File,
        code: &syn::File,
        role: Role,
    ) {
        let mut all = BTreeMap::new();
        Self::count(syntax.to_token_stream(), &mut all);
        if role != Role::Library {
            self.tests.extend(all.into_keys());
            return;
        }
        let mut library = BTreeMap::new();
        Self::count(code.to_token_stream(), &mut library);
        for (name, count) in &all {
            if library.get(name).copied().unwrap_or(0) < *count {
                self.tests.insert(name.clone());
            }
        }
        for (name, count) in library {
            *self.library.entry(name).or_default() += count;
        }
        let mut definitions = Definitions {
            path,
            uses: self,
            exempt: path.ends_with("test_support.rs"),
            in_inherent_impl: false,
        };
        definitions.visit_file(code);
    }

    fn count(stream: TokenStream, counts: &mut BTreeMap<String, usize>) {
        for tree in stream {
            match tree {
                TokenTree::Ident(ident) => *counts.entry(ident.to_string()).or_default() += 1,
                TokenTree::Group(group) => Self::count(group.stream(), counts),
                TokenTree::Punct(_) | TokenTree::Literal(_) => {}
            }
        }
    }

    pub(crate) fn extend(&mut self, other: Self) {
        self.public.extend(other.public);
        for (name, count) in other.library {
            *self.library.entry(name).or_default() += count;
        }
        for (name, count) in other.definitions {
            *self.definitions.entry(name).or_default() += count;
        }
        self.tests.extend(other.tests);
    }

    /// Public functions that library code never names beyond their own
    /// definitions, while tests do.
    pub(crate) fn findings(&self) -> Vec<Finding> {
        self.public
            .iter()
            .filter(|function| {
                let uses = self.library.get(&function.name).copied().unwrap_or(0);
                let defined = self.definitions.get(&function.name).copied().unwrap_or(0);
                uses <= defined && self.tests.contains(&function.name)
            })
            .map(|function| Finding {
                path: function.path.clone(),
                line: function.line,
                kind: Kind::TestOnlyPub,
                detail: format!(
                    "{} is public but only tests call it: test through its callers, or move it to test support",
                    function.name
                ),
            })
            .collect()
    }
}

/// Collects a file's function definitions into [`NameUses`].
struct Definitions<'a> {
    path: &'a Path,
    uses: &'a mut NameUses,
    exempt: bool,
    in_inherent_impl: bool,
}

impl Definitions<'_> {
    fn record(&mut self, sig: &syn::Signature, attrs: &[syn::Attribute], visible: bool) {
        let name = sig.ident.to_string();
        *self.uses.definitions.entry(name.clone()).or_default() += 1;
        let exported = is_exported(attrs);
        if visible && !exported && !self.exempt && name != "main" {
            self.uses.public.push(PublicFn {
                path: self.path.to_path_buf(),
                line: sig.ident.span().start().line,
                name,
            });
        }
    }
}

impl<'ast> Visit<'ast> for Definitions<'_> {
    fn visit_item_mod(&mut self, module: &'ast syn::ItemMod) {
        let outer = self.exempt;
        self.exempt |= module.ident == "test_support";
        visit::visit_item_mod(self, module);
        self.exempt = outer;
    }

    fn visit_item_fn(&mut self, function: &'ast ItemFn) {
        self.record(
            &function.sig,
            &function.attrs,
            syntax::is_visible(&function.vis),
        );
        visit::visit_item_fn(self, function);
    }

    fn visit_item_impl(&mut self, item: &'ast syn::ItemImpl) {
        let outer = self.in_inherent_impl;
        self.in_inherent_impl = item.trait_.is_none() && !is_exported(&item.attrs);
        visit::visit_item_impl(self, item);
        self.in_inherent_impl = outer;
    }

    fn visit_impl_item_fn(&mut self, method: &'ast syn::ImplItemFn) {
        let visible = self.in_inherent_impl && syntax::is_visible(&method.vis);
        self.record(&method.sig, &method.attrs, visible);
        visit::visit_impl_item_fn(self, method);
    }

    fn visit_trait_item_fn(&mut self, method: &'ast syn::TraitItemFn) {
        *self
            .uses
            .definitions
            .entry(method.sig.ident.to_string())
            .or_default() += 1;
        visit::visit_trait_item_fn(self, method);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_public_function_only_tests_call_is_reported() {
        let syntax = syn::parse_file(
            "pub fn used() {} pub fn tested() {} #[napi] pub fn exported() {}
             fn caller() { used(); }
             #[cfg(test)] mod tests { #[test] fn t() { tested(); exported(); } }",
        )
        .unwrap();
        let code = syntax::without_tests(&syntax);
        let mut uses = NameUses::default();
        uses.add_file(Path::new("lib.rs"), &syntax, &code, Role::Library);
        let details: Vec<_> = uses
            .findings()
            .into_iter()
            .map(|finding| finding.detail)
            .collect();
        assert_eq!(
            details,
            [
                "tested is public but only tests call it: test through its callers, or move it to test support"
            ]
        );
    }
}
