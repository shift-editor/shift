use std::collections::{BTreeMap, BTreeSet, HashSet};
use std::path::Path;

use quote::ToTokens;
use syn::spanned::Spanned;
use syn::visit::{self, Visit};
use syn::{Expr, FnArg, ImplItem, Type};

use crate::chain::MethodChain;
use crate::finding::{Finding, Kind};

/// A chain this long or longer is reported.
const LONG_CHAIN_STEPS: usize = 6;
/// Methods that walk or reshape a collection or an option. A chain with none
/// of them is a builder (`Command::new().arg().flag()`), which reads fine long.
const ADAPTORS: [&str; 22] = [
    "iter",
    "into_iter",
    "map",
    "filter",
    "filter_map",
    "flat_map",
    "flatten",
    "and_then",
    "zip",
    "enumerate",
    "chain",
    "find",
    "find_map",
    "fold",
    "collect",
    "sum",
    "any",
    "all",
    "rev",
    "copied",
    "cloned",
    "take",
];
/// A conversion copying this many fields or more is reported.
const COPIED_FIELDS: usize = 4;
/// Name endings of types that only carry one call's arguments: a function
/// taking one first is a handler, not a method.
const ARGUMENT_BUNDLES: [&str; 3] = ["Args", "Options", "Input"];

/// The public inherent methods seen so far, by name and arity, with the types
/// that have one.
pub(crate) type InherentMethods = BTreeMap<(String, usize), BTreeSet<String>>;

/// Walks one file's syntax tree, skipping tests, and records what it finds.
pub(crate) struct FileScan<'a> {
    path: &'a Path,
    crate_types: &'a BTreeSet<String>,
    pub(crate) findings: Vec<Finding>,
    pub(crate) inherent_methods: &'a mut InherentMethods,
    /// Each `ok_or_else`/`map_err` closure, by the error it builds.
    pub(crate) error_mappings: BTreeMap<String, Vec<Finding>>,
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
            error_mappings: BTreeMap::new(),
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

    /// What a closure's error is built by: the function it calls, or the
    /// variant it names. `None` for anything more involved.
    fn error_built(body: &Expr) -> Option<String> {
        match body {
            Expr::Call(call) => match &*call.func {
                Expr::Path(path) => Some(Self::compact(&path.to_token_stream().to_string())),
                _ => None,
            },
            Expr::Path(path) => Some(Self::compact(&path.to_token_stream().to_string())),
            _ => None,
        }
    }

    /// A closure as it was written, near enough: `|e| io_error("x", &e)`.
    fn closure_text(closure: &syn::ExprClosure) -> String {
        let inputs: Vec<_> = closure
            .inputs
            .iter()
            .map(|input| Self::compact(&input.to_token_stream().to_string()))
            .collect();
        let body = Self::compact(&closure.body.to_token_stream().to_string());
        format!("|{}| {body}", inputs.join(", "))
    }

    /// Token text without the spaces `to_string` puts between tokens.
    fn compact(tokens: &str) -> String {
        [
            (" :: ", "::"),
            (" . ", "."),
            (" (", "("),
            ("( ", "("),
            (" )", ")"),
            (" ,", ","),
            ("& ", "&"),
        ]
        .iter()
        .fold(tokens.to_string(), |text, (spaced, tight)| {
            text.replace(spaced, tight)
        })
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
        let Some((parameter, body)) = Self::conversion_fn(item) else {
            return;
        };
        let mut literals = StructLiterals::default();
        literals.visit_block(body);
        let self_type = Self::subject(&item.self_ty).unwrap_or_default();
        for literal in literals.found {
            let copied = literal
                .fields
                .iter()
                .filter(|field| Self::reads(&field.expr, &parameter))
                .count();
            if copied >= COPIED_FIELDS {
                let detail = format!(
                    "impl {trait_name} for {self_type}: {copied} of {} fields read straight off `{parameter}`",
                    literal.fields.len()
                );
                self.report(Kind::FieldCopyConversion, literal.span(), detail);
            }
        }
    }

    /// The `from`/`try_from` function's parameter name and body.
    fn conversion_fn(item: &syn::ItemImpl) -> Option<(String, &syn::Block)> {
        item.items.iter().find_map(|member| {
            let ImplItem::Fn(function) = member else {
                return None;
            };
            let Some(FnArg::Typed(typed)) = function.sig.inputs.first() else {
                return None;
            };
            let syn::Pat::Ident(name) = &*typed.pat else {
                return None;
            };
            Some((name.ident.to_string(), &function.block))
        })
    }

    /// Whether a field's value is the parameter's own field, perhaps converted:
    /// `value.name`, `value.id.into()`, `value.points.clone()?`.
    fn reads(expr: &Expr, parameter: &str) -> bool {
        match expr {
            Expr::Field(field) => match &*field.base {
                Expr::Path(path) => path.path.is_ident(parameter),
                base => Self::reads(base, parameter),
            },
            Expr::MethodCall(call) => Self::reads(&call.receiver, parameter),
            Expr::Try(attempt) => Self::reads(&attempt.expr, parameter),
            Expr::Reference(reference) => Self::reads(&reference.expr, parameter),
            _ => false,
        }
    }
}

/// The struct literals inside one function body.
#[derive(Default)]
struct StructLiterals {
    found: Vec<syn::ExprStruct>,
}

impl<'ast> Visit<'ast> for StructLiterals {
    fn visit_expr_struct(&mut self, literal: &'ast syn::ExprStruct) {
        self.found.push(literal.clone());
        visit::visit_expr_struct(self, literal);
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
        let is_method_subject = |subject: &String| {
            self.crate_types.contains(subject)
                && !ARGUMENT_BUNDLES
                    .iter()
                    .any(|ending| subject.ends_with(ending))
        };
        if let Some(subject) = subject.filter(is_method_subject) {
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
            let maps_error = ["ok_or_else", "map_err"].contains(&method.as_str());
            if let (true, Some(Expr::Closure(closure))) = (maps_error, call.args.first())
                && let Some(built) = Self::error_built(&closure.body)
            {
                let finding = Finding {
                    path: self.path.to_path_buf(),
                    line: expr.span().start().line,
                    kind: Kind::RepeatedErrorMapping,
                    detail: format!(".{method}({})", Self::closure_text(closure)),
                };
                self.error_mappings.entry(built).or_default().push(finding);
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
            let adapts = chain
                .methods
                .iter()
                .any(|method| ADAPTORS.contains(&method.as_str()));
            if adapts && chain.steps() >= LONG_CHAIN_STEPS {
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
