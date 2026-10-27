use std::collections::{BTreeMap, BTreeSet, HashSet};
use std::path::Path;

use quote::ToTokens;
use syn::spanned::Spanned;
use syn::visit::{self, Visit};
use syn::{Expr, FnArg, ImplItem, Type};

use crate::chain::MethodChain;
use crate::finding::{Finding, Kind};

/// A chain this long or longer is reported.
const LONG_CHAIN_STEPS: usize = 4;
/// A conversion copying this many fields or more is reported.
const COPIED_FIELDS: usize = 4;

/// The public inherent methods seen so far, by name and arity, with the types
/// that have one.
pub(crate) type InherentMethods = BTreeMap<(String, usize), BTreeSet<String>>;

/// Walks one file's syntax tree, skipping tests, and records what it finds.
pub(crate) struct FileScan<'a> {
    path: &'a Path,
    crate_types: &'a BTreeSet<String>,
    pub(crate) findings: Vec<Finding>,
    pub(crate) inherent_methods: &'a mut InherentMethods,
    /// Receivers already counted as part of a longer chain.
    inside_chains: HashSet<*const Expr>,
}

impl<'a> FileScan<'a> {
    pub(crate) fn new(
        path: &'a Path,
        crate_types: &'a BTreeSet<String>,
        inherent_methods: &'a mut InherentMethods,
    ) -> Self {
        Self {
            path,
            crate_types,
            findings: Vec::new(),
            inherent_methods,
            inside_chains: HashSet::new(),
        }
    }

    fn report(&mut self, kind: Kind, span: proc_macro2::Span, detail: String) {
        self.findings.push(Finding {
            path: self.path.to_path_buf(),
            line: span.start().line,
            kind,
            detail,
        });
    }

    /// The type a parameter is about: `&Font`, `&mut Font` and `Font` are all `Font`.
    fn subject(ty: &Type) -> Option<String> {
        match ty {
            Type::Reference(reference) => Self::subject(&reference.elem),
            Type::Path(path) => path
                .path
                .segments
                .last()
                .map(|segment| segment.ident.to_string()),
            _ => None,
        }
    }

    fn is_test(attrs: &[syn::Attribute]) -> bool {
        attrs.iter().any(|attr| {
            attr.path().is_ident("test")
                || (attr.path().is_ident("cfg")
                    && attr.to_token_stream().to_string().contains("test"))
        })
    }

    /// Builds a value from paths and literals only, so evaluating it eagerly
    /// would cost little.
    fn is_cheap(expr: &Expr) -> bool {
        match expr {
            Expr::Path(_) | Expr::Lit(_) => true,
            Expr::Call(call) => call.args.iter().all(Self::is_cheap),
            Expr::Struct(value) => value.fields.iter().all(|field| Self::is_cheap(&field.expr)),
            Expr::Reference(reference) => Self::is_cheap(&reference.expr),
            _ => false,
        }
    }

    fn record_inherent_methods(&mut self, item: &syn::ItemImpl) {
        let Some(self_type) = Self::subject(&item.self_ty) else {
            return;
        };
        for method in &item.items {
            let ImplItem::Fn(method) = method else {
                continue;
            };
            if matches!(method.vis, syn::Visibility::Inherited) {
                continue;
            }
            let key = (method.sig.ident.to_string(), method.sig.inputs.len());
            self.inherent_methods
                .entry(key)
                .or_default()
                .insert(self_type.clone());
        }
    }

    fn check_conversion(&mut self, item: &syn::ItemImpl, trait_name: &str) {
        let body = item.to_token_stream().to_string();
        let copied = body.matches(" . into ()").count() + body.matches(": value .").count();
        if copied >= COPIED_FIELDS {
            let self_type = Self::subject(&item.self_ty).unwrap_or_default();
            self.report(
                Kind::FieldCopyConversion,
                item.span(),
                format!("impl {trait_name} for {self_type}, ~{copied} fields copied"),
            );
        }
    }
}

impl<'ast> Visit<'ast> for FileScan<'_> {
    fn visit_item_mod(&mut self, module: &'ast syn::ItemMod) {
        if !Self::is_test(&module.attrs) {
            visit::visit_item_mod(self, module);
        }
    }

    fn visit_item_fn(&mut self, function: &'ast syn::ItemFn) {
        if Self::is_test(&function.attrs) || function.sig.ident == "main" {
            return;
        }
        let subject = function.sig.inputs.first().and_then(|input| match input {
            FnArg::Typed(typed) => Self::subject(&typed.ty),
            FnArg::Receiver(_) => None,
        });
        if let Some(subject) = subject.filter(|subject| self.crate_types.contains(subject)) {
            let detail = format!("{} takes {subject} first", function.sig.ident);
            self.report(Kind::MethodCandidate, function.sig.ident.span(), detail);
        }
        visit::visit_item_fn(self, function);
    }

    fn visit_item_impl(&mut self, item: &'ast syn::ItemImpl) {
        if Self::is_test(&item.attrs) {
            return;
        }
        match &item.trait_ {
            None => self.record_inherent_methods(item),
            Some((_, path, _)) => {
                let trait_name = path
                    .segments
                    .last()
                    .map(|segment| segment.ident.to_string())
                    .unwrap_or_default();
                if trait_name == "From" || trait_name == "TryFrom" {
                    self.check_conversion(item, &trait_name);
                }
            }
        }
        visit::visit_item_impl(self, item);
    }

    fn visit_impl_item_fn(&mut self, method: &'ast syn::ImplItemFn) {
        if !Self::is_test(&method.attrs) {
            visit::visit_impl_item_fn(self, method);
        }
    }

    fn visit_expr(&mut self, expr: &'ast Expr) {
        if let Expr::MethodCall(call) = expr {
            let method = call.method.to_string();
            let lazy = ["ok_or_else", "unwrap_or_else", "map_err"].contains(&method.as_str());
            if let (true, Some(Expr::Closure(closure))) = (lazy, call.args.first())
                && Self::is_cheap(&closure.body)
            {
                let built = closure.body.to_token_stream().to_string();
                self.report(
                    Kind::LazyButCheap,
                    expr.span(),
                    format!(".{method}(|| {built})"),
                );
            }
        }
        let is_chain = matches!(expr, Expr::MethodCall(_) | Expr::Try(_));
        if is_chain && !self.inside_chains.contains(&std::ptr::from_ref(expr)) {
            let chain = MethodChain::of(expr);
            self.inside_chains.extend(
                chain
                    .receivers
                    .iter()
                    .map(|receiver| std::ptr::from_ref(*receiver)),
            );
            if chain.steps() >= LONG_CHAIN_STEPS {
                let lines = expr.span().end().line - expr.span().start().line + 1;
                let detail = format!(
                    "{} steps over {lines} lines: {}",
                    chain.steps(),
                    chain.methods.join(".")
                );
                self.report(Kind::LongChain, expr.span(), detail);
            }
        }
        visit::visit_expr(self, expr);
    }
}
