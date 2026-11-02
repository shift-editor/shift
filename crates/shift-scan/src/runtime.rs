//! Kinds about what code does when it runs: panics that reach Node, parallel
//! collects whose error depends on scheduling, leaked memory, recursion with
//! no bound and lookups that scan.

use std::collections::HashSet;
use std::path::Path;

use quote::ToTokens;
use syn::spanned::Spanned;
use syn::visit::{self, Visit};
use syn::{Expr, ExprMethodCall, FnArg, Pat};

use crate::chain::MethodChain;
use crate::finding::{Finding, Kind, Report};
use crate::syntax;

/// Words that, in a recursive function's parameters or body, say the
/// recursion is bounded: a depth, a budget, or a record of where it has been.
const GUARDS: [&str; 13] = [
    "depth",
    "level",
    "budget",
    "remaining",
    "limit",
    "fuel",
    "visited",
    "seen",
    "visiting",
    "stack",
    "ancestors",
    "in_progress",
    "cycle",
];
/// Parallel iterator methods that stop at whichever thread fails first.
const PARALLEL_TRY: [&str; 4] = [
    "try_for_each",
    "try_for_each_with",
    "try_fold",
    "try_reduce",
];
/// Lookups that walk a collection.
const SCANS: [&str; 3] = ["find", "position", "rposition"];

/// Walks one file's library code (tests already removed).
pub(crate) struct RuntimeScan<'a> {
    report: Report<'a>,
    /// Whether the walk is inside an `impl Trait for T`, whose `self.name()`
    /// usually calls the inherent method of that name, not itself.
    in_trait_impl: bool,
    /// Whether the walk is inside a `#[napi]` impl, which exports its public
    /// methods.
    in_napi_impl: bool,
    /// Parallel collects already reported through an enclosing `?`.
    reported: HashSet<*const ExprMethodCall>,
}

/// The findings of this module's kinds in one file's library code.
pub(crate) fn findings(path: &Path, code: &syn::File) -> Vec<Finding> {
    let mut scan = RuntimeScan {
        report: Report::new(path),
        in_trait_impl: false,
        in_napi_impl: false,
        reported: HashSet::new(),
    };
    scan.visit_file(code);
    scan.report.found
}

impl<'a> RuntimeScan<'a> {
    fn napi_attr(attrs: &[syn::Attribute]) -> Option<&syn::Attribute> {
        attrs.iter().find(|attr| {
            attr.path()
                .segments
                .last()
                .is_some_and(|segment| segment.ident == "napi")
        })
    }

    /// Reports an exported function that doesn't catch a panic. A public
    /// method of a `#[napi]` impl is exported with or without its own attribute.
    fn check_napi(&mut self, attrs: &[syn::Attribute], sig: &syn::Signature, exported: bool) {
        let napi = Self::napi_attr(attrs);
        let catches =
            napi.is_some_and(|attr| attr.to_token_stream().to_string().contains("catch_unwind"));
        if (exported || napi.is_some()) && !catches {
            let detail = format!(
                "{}: a panic here aborts Node; `#[napi(catch_unwind)]`",
                sig.ident
            );
            self.report
                .add(Kind::NapiWithoutCatchUnwind, sig.ident.span(), detail);
        }
    }

    fn check_recursion(&mut self, sig: &syn::Signature, block: &syn::Block, method: bool) {
        let name = sig.ident.to_string();
        let mut calls = SelfCalls {
            name: &name,
            method,
            found: false,
            words: Vec::new(),
        };
        calls.visit_block(block);
        let parameters = sig.inputs.iter().filter_map(|input| match input {
            FnArg::Typed(typed) => match &*typed.pat {
                Pat::Ident(ident) => Some(ident.ident.to_string()),
                _ => None,
            },
            FnArg::Receiver(_) => None,
        });
        let mut words = parameters.chain(calls.words);
        let guarded = words.any(|word| {
            let word = word.to_lowercase();
            GUARDS.iter().any(|guard| word.contains(guard))
        });
        if calls.found && !guarded {
            let detail = format!("{name} calls itself with no depth, budget or visited set");
            self.report
                .add(Kind::UnguardedRecursion, sig.ident.span(), detail);
        }
    }

    /// The `collect` an expression ends in, when its chain is parallel.
    fn parallel_collect(expr: &Expr) -> Option<&ExprMethodCall> {
        let Expr::MethodCall(call) = expr else {
            return None;
        };
        (call.method == "collect" && Self::is_parallel(expr)).then_some(call)
    }

    fn is_parallel(expr: &Expr) -> bool {
        MethodChain::of(expr)
            .methods
            .iter()
            .any(|method| method.starts_with("par_") || method == "into_par_iter")
    }

    /// A parallel collect returned as a function's `Result`.
    fn check_parallel_tail(&mut self, sig: &syn::Signature, block: &syn::Block) {
        let syn::ReturnType::Type(_, output) = &sig.output else {
            return;
        };
        let returns_result = syntax::type_name(output).is_some_and(|name| name.ends_with("Result"));
        let tail = match block.stmts.last() {
            Some(syn::Stmt::Expr(expr, None)) => Self::parallel_collect(expr),
            _ => None,
        };
        if let Some(call) = tail.filter(|_| returns_result) {
            self.report_parallel(call);
        }
    }

    fn report_parallel(&mut self, call: &ExprMethodCall) {
        if self.reported.insert(std::ptr::from_ref(call)) {
            let detail = format!(
                ".{}() on a parallel iterator: which error wins depends on scheduling; collect every result, then the first in order",
                call.method
            );
            self.report
                .add(Kind::ParallelFirstError, call.method.span(), detail);
        }
    }

    fn check_linear_lookup(&mut self, call: &ExprMethodCall) {
        if !SCANS.contains(&call.method.to_string().as_str()) {
            return;
        }
        let Some(Expr::Closure(closure)) = call.args.first() else {
            return;
        };
        let Some(Expr::Binary(binary)) = Self::single_expr(&closure.body) else {
            return;
        };
        if !matches!(binary.op, syn::BinOp::Eq(_)) {
            return;
        }
        let Some(key) = Self::key(&binary.left).or_else(|| Self::key(&binary.right)) else {
            return;
        };
        let detail = format!(
            ".{}() comparing `{key}`: look it up in an index",
            call.method
        );
        self.report
            .add(Kind::LinearLookup, call.method.span(), detail);
    }

    /// A closure body that is one expression, through a block holding only it.
    fn single_expr(body: &Expr) -> Option<&Expr> {
        match body {
            Expr::Block(block) => match block.block.stmts.as_slice() {
                [syn::Stmt::Expr(expr, None)] => Self::single_expr(expr),
                _ => None,
            },
            Expr::Paren(paren) => Self::single_expr(&paren.expr),
            expr => Some(expr),
        }
    }

    /// The identity an operand reads: `.id()`, `.name`, `.glyph_id()`.
    fn key(expr: &Expr) -> Option<String> {
        let is_key = |name: &str| name == "id" || name == "name" || name.ends_with("_id");
        match expr {
            Expr::MethodCall(call) if call.args.is_empty() && is_key(&call.method.to_string()) => {
                Some(format!("{}()", call.method))
            }
            Expr::Field(field) => match &field.member {
                syn::Member::Named(name) if is_key(&name.to_string()) => Some(name.to_string()),
                _ => None,
            },
            Expr::Unary(unary) => Self::key(&unary.expr),
            Expr::Reference(reference) => Self::key(&reference.expr),
            Expr::Paren(paren) => Self::key(&paren.expr),
            _ => None,
        }
    }
}

/// Whether a body calls the function it belongs to, and every name it uses.
struct SelfCalls<'a> {
    name: &'a str,
    method: bool,
    found: bool,
    words: Vec<String>,
}

impl<'ast> Visit<'ast> for SelfCalls<'_> {
    fn visit_expr_call(&mut self, call: &'ast syn::ExprCall) {
        if let Expr::Path(path) = &*call.func {
            let segments: Vec<_> = path
                .path
                .segments
                .iter()
                .map(|segment| segment.ident.to_string())
                .collect();
            let calls_self = match segments.as_slice() {
                [name] => !self.method && name == self.name,
                [owner, name] => self.method && owner == "Self" && name == self.name,
                _ => false,
            };
            self.found |= calls_self;
        }
        visit::visit_expr_call(self, call);
    }

    fn visit_expr_method_call(&mut self, call: &'ast ExprMethodCall) {
        let on_self = matches!(&*call.receiver, Expr::Path(path) if path.path.is_ident("self"));
        self.found |= self.method && on_self && call.method == self.name;
        visit::visit_expr_method_call(self, call);
    }

    fn visit_ident(&mut self, ident: &'ast proc_macro2::Ident) {
        self.words.push(ident.to_string());
    }

    fn visit_item_fn(&mut self, _: &'ast syn::ItemFn) {}
}

impl<'ast> Visit<'ast> for RuntimeScan<'_> {
    fn visit_item_fn(&mut self, function: &'ast syn::ItemFn) {
        self.check_napi(&function.attrs, &function.sig, false);
        self.check_recursion(&function.sig, &function.block, false);
        self.check_parallel_tail(&function.sig, &function.block);
        visit::visit_item_fn(self, function);
    }

    fn visit_item_impl(&mut self, item: &'ast syn::ItemImpl) {
        let outer = (self.in_trait_impl, self.in_napi_impl);
        self.in_trait_impl = item.trait_.is_some();
        self.in_napi_impl = Self::napi_attr(&item.attrs).is_some();
        visit::visit_item_impl(self, item);
        (self.in_trait_impl, self.in_napi_impl) = outer;
    }

    fn visit_impl_item_fn(&mut self, method: &'ast syn::ImplItemFn) {
        let exported = self.in_napi_impl && syntax::is_visible(&method.vis);
        self.check_napi(&method.attrs, &method.sig, exported);
        if !self.in_trait_impl {
            self.check_recursion(&method.sig, &method.block, true);
        }
        self.check_parallel_tail(&method.sig, &method.block);
        visit::visit_impl_item_fn(self, method);
    }

    fn visit_trait_item_fn(&mut self, method: &'ast syn::TraitItemFn) {
        if let Some(block) = &method.default {
            self.check_recursion(&method.sig, block, true);
        }
        visit::visit_trait_item_fn(self, method);
    }

    fn visit_expr_try(&mut self, attempt: &'ast syn::ExprTry) {
        if let Some(call) = Self::parallel_collect(&attempt.expr) {
            self.report_parallel(call);
        }
        visit::visit_expr_try(self, attempt);
    }

    fn visit_local(&mut self, local: &'ast syn::Local) {
        let annotated_result = match &local.pat {
            Pat::Type(typed) => {
                syntax::type_name(&typed.ty).is_some_and(|name| name.ends_with("Result"))
            }
            _ => false,
        };
        let init = local.init.as_ref().map(|init| &*init.expr);
        if let Some(call) = init
            .and_then(Self::parallel_collect)
            .filter(|_| annotated_result)
        {
            self.report_parallel(call);
        }
        visit::visit_local(self, local);
    }

    fn visit_expr(&mut self, expr: &'ast Expr) {
        if let Expr::MethodCall(call) = expr {
            let turbofish_result = call.turbofish.as_ref().is_some_and(|turbofish| {
                turbofish.to_token_stream().to_string().contains("Result")
            });
            let tries = PARALLEL_TRY.contains(&call.method.to_string().as_str());
            let collects_result = call.method == "collect" && turbofish_result;
            if (tries || collects_result) && Self::is_parallel(expr) {
                self.report_parallel(call);
            }
            if call.method == "leak" {
                let detail = ".leak(): memory never freed".to_string();
                self.report
                    .add(Kind::LeakedStatic, call.method.span(), detail);
            }
            self.check_linear_lookup(call);
        }
        if let Expr::Call(call) = expr
            && let Expr::Path(path) = &*call.func
            && path.path.segments.len() >= 2
            && path
                .path
                .segments
                .last()
                .is_some_and(|segment| segment.ident == "leak")
        {
            let leak = path.path.to_token_stream().to_string().replace(' ', "");
            let detail = format!("{leak}: memory never freed");
            self.report.add(Kind::LeakedStatic, expr.span(), detail);
        }
        visit::visit_expr(self, expr);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn findings(source: &str) -> Vec<(Kind, String)> {
        let code = syn::parse_file(source).unwrap();
        super::findings(Path::new("lib.rs"), &code)
            .into_iter()
            .map(|finding| (finding.kind, finding.detail))
            .collect()
    }

    fn kinds(source: &str) -> Vec<Kind> {
        findings(source).into_iter().map(|(kind, _)| kind).collect()
    }

    #[test]
    fn a_napi_function_without_catch_unwind_is_reported() {
        let found = findings(
            "#[napi] pub fn open(path: String) {}
             #[napi(catch_unwind)] pub fn save(path: String) {}
             impl Bridge { #[napi(getter)] pub fn name(&self) {} }
             #[napi] impl Reader { pub fn close(&self) {} fn helper(&self) {} }",
        );
        let details: Vec<_> = found.into_iter().map(|(_, detail)| detail).collect();
        assert_eq!(
            details,
            [
                "open: a panic here aborts Node; `#[napi(catch_unwind)]`",
                "name: a panic here aborts Node; `#[napi(catch_unwind)]`",
                "close: a panic here aborts Node; `#[napi(catch_unwind)]`",
            ]
        );
    }

    #[test]
    fn a_parallel_collect_into_a_result_is_reported_once() {
        let found = kinds(
            "fn read(&self) -> R {
                 let glyphs = records.par_iter().map(read).collect::<Result<Vec<_>>>()?;
                 let sources: FormatResult<Vec<_>> = sources.into_par_iter().map(load).collect();
                 records.par_iter().try_for_each(check)?;
                 let results: Vec<_> = records.par_iter().map(read).collect();
                 let serial = records.iter().map(read).collect::<Result<Vec<_>>>()?;
             }
             fn compress(layers: Vec<Layer>) -> Result<Vec<Stored>, StoreError> {
                 layers.into_par_iter().map(compress).collect()
             }",
        );
        assert_eq!(kinds_of(&found, Kind::ParallelFirstError), 4);
    }

    fn kinds_of(found: &[Kind], kind: Kind) -> usize {
        found.iter().filter(|found| **found == kind).count()
    }

    #[test]
    fn a_leak_is_reported() {
        let found = kinds(
            "fn intern(text: String) -> &'static str { Box::leak(text.into_boxed_str()); text.leak() }",
        );
        assert_eq!(found, [Kind::LeakedStatic, Kind::LeakedStatic]);
    }

    #[test]
    fn recursion_without_a_guard_is_reported() {
        let found = findings(
            "fn flatten(glyph: &Glyph) { for base in glyph.components() { flatten(base); } }
             fn include(path: &Path, depth: usize) { include(path, depth + 1); }
             impl Font { fn walk(&self, glyph: &Glyph, visited: &mut Set) { self.walk(glyph, visited); } }
             impl Font { fn resolve(&self, glyph: &Glyph) { Self::resolve(self, glyph); } }",
        );
        let details: Vec<_> = found.into_iter().map(|(_, detail)| detail).collect();
        assert_eq!(
            details,
            [
                "flatten calls itself with no depth, budget or visited set",
                "resolve calls itself with no depth, budget or visited set",
            ]
        );
    }

    #[test]
    fn a_scan_comparing_an_id_or_name_is_a_linear_lookup() {
        let found = findings(
            "fn f() {
                 glyphs.iter().find(|glyph| glyph.id() == id);
                 groups.iter().position(|group| { group.name == *name });
                 values.iter().find(|value| **value > 3);
             }",
        );
        let details: Vec<_> = found.into_iter().map(|(_, detail)| detail).collect();
        assert_eq!(
            details,
            [
                ".find() comparing `id()`: look it up in an index",
                ".position() comparing `name`: look it up in an index",
            ]
        );
    }
}
