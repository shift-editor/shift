//! Kinds about failures: errors carried as text, `*NotFound` built by hand
//! instead of through a `require_*` helper, and infallible trait impls that
//! can panic.

use std::path::Path;

use quote::ToTokens;
use syn::spanned::Spanned;
use syn::visit::{self, Visit};
use syn::{Expr, Fields, ReturnType, Type};

use crate::finding::{Finding, Kind, Report};
use crate::syntax;

/// Traits whose methods cannot report a failure, so a panic in them is the
/// only way out.
const INFALLIBLE_TRAITS: [&str; 16] = [
    "From",
    "Into",
    "Default",
    "Display",
    "Debug",
    "Index",
    "IndexMut",
    "Deref",
    "DerefMut",
    "AsRef",
    "Borrow",
    "PartialEq",
    "PartialOrd",
    "Ord",
    "Hash",
    "Clone",
];
/// Macros that panic.
const PANICS: [&str; 7] = [
    "panic",
    "unreachable",
    "todo",
    "unimplemented",
    "assert",
    "assert_eq",
    "assert_ne",
];
/// Field names that carry a message in place of a cause.
const MESSAGE_FIELDS: [&str; 3] = ["message", "details", "error"];
/// Names an error value goes by, whose `to_string()` flattens a cause to text.
const ERROR_NAMES: [&str; 5] = ["e", "err", "error", "source", "cause"];

/// Walks one file's library code (tests already removed).
pub(crate) struct ErrorScan<'a> {
    report: Report<'a>,
    /// The function being walked, innermost last.
    functions: Vec<String>,
    /// Whether the walk is inside an `impl Trait for T`.
    in_trait_impl: bool,
}

/// The findings of this module's kinds in one file's library code.
pub(crate) fn findings(path: &Path, code: &syn::File) -> Vec<Finding> {
    let mut scan = ErrorScan {
        report: Report::new(path),
        functions: Vec::new(),
        in_trait_impl: false,
    };
    scan.visit_file(code);
    scan.report.found
}

impl<'a> ErrorScan<'a> {
    fn check_signature(&mut self, sig: &syn::Signature) {
        let ReturnType::Type(_, output) = &sig.output else {
            return;
        };
        let is_result = syntax::type_name(output).as_deref() == Some("Result");
        let arguments = syntax::type_arguments(output);
        let error = arguments.get(1).and_then(|ty| syntax::type_name(ty));
        if is_result && error.as_deref() == Some("String") {
            let detail = format!(
                "{} returns `Result<_, String>`: give it an error type",
                sig.ident
            );
            self.report
                .add(Kind::StringlyError, sig.ident.span(), detail);
        }
    }

    fn check_error_enum(&mut self, item: &syn::ItemEnum) {
        if !item.ident.to_string().ends_with("Error") {
            return;
        }
        for variant in &item.variants {
            let Fields::Named(fields) = &variant.fields else {
                continue;
            };
            let message = fields.named.iter().any(|field| {
                let named = field.ident.as_ref().map(ToString::to_string);
                let carries = named.is_some_and(|name| MESSAGE_FIELDS.contains(&name.as_str()));
                carries && Self::is_string(&field.ty)
            });
            if message {
                let detail = format!(
                    "{}::{} carries a message: a variant per reason, `#[source]` for a cause",
                    item.ident, variant.ident
                );
                self.report
                    .add(Kind::StringlyError, variant.ident.span(), detail);
            }
        }
    }

    /// Whether an expression builds text: `format!(..)`, `"..".to_string()`,
    /// or an error's `to_string()`.
    fn is_text(expr: &Expr) -> bool {
        match expr {
            Expr::Macro(mac) => mac.mac.path.is_ident("format"),
            Expr::MethodCall(call) => {
                let method = call.method.to_string();
                let literal = matches!(&*call.receiver, Expr::Lit(lit) if matches!(lit.lit, syn::Lit::Str(_)));
                let flattens_error = method == "to_string"
                    && matches!(&*call.receiver, Expr::Path(path)
                    if path.path.get_ident().is_some_and(|name| {
                        let name = name.to_string();
                        ERROR_NAMES.contains(&name.as_str()) || name.ends_with("_error")
                    }));
                let converts = ["to_string", "into", "to_owned"].contains(&method.as_str());
                (literal && converts) || flattens_error
            }
            _ => false,
        }
    }

    /// The error variant an expression builds from text: `FormatBackendError::Ufo(format!(..))`.
    fn text_built_variant(expr: &Expr) -> Option<String> {
        let Expr::Call(call) = expr else {
            return None;
        };
        let Expr::Path(path) = &*call.func else {
            return None;
        };
        let mut segments = path.path.segments.iter().rev();
        let variant = segments.next()?.ident.to_string();
        let owner = segments.next()?.ident.to_string();
        let from_text = call.args.iter().any(Self::is_text);
        (owner.ends_with("Error") && from_text).then(|| format!("{owner}::{variant}"))
    }

    fn check_text_error(&mut self, expr: &Expr) {
        if let Some(variant) = Self::text_built_variant(expr) {
            let detail =
                format!("{variant} built from text: a variant per reason, `#[source]` for a cause");
            self.report.add(Kind::StringlyError, expr.span(), detail);
        }
        let Expr::MethodCall(call) = expr else {
            return;
        };
        let Some(Expr::Closure(closure)) = call.args.first() else {
            return;
        };
        if call.method == "map_err" && Self::is_text(&closure.body) {
            let detail =
                "`.map_err` to text: wrap the error with `#[from]` or `#[source]`".to_string();
            self.report
                .add(Kind::StringlyError, call.method.span(), detail);
        }
    }

    fn is_string(ty: &Type) -> bool {
        syntax::type_name(ty).as_deref() == Some("String")
    }

    /// The variant an expression builds, when it names one: `CoreError::GlyphNotFound(..)`.
    fn built_variant(expr: &Expr) -> Option<&syn::Path> {
        let path = match expr {
            Expr::Call(call) => match &*call.func {
                Expr::Path(path) => &path.path,
                _ => return None,
            },
            Expr::Path(path) => &path.path,
            Expr::Struct(literal) => &literal.path,
            _ => return None,
        };
        let mut segments = path.segments.iter().rev();
        let variant = segments.next()?.ident.to_string();
        let is_error = segments.next()?.ident.to_string().ends_with("Error");
        let is_missing = variant.ends_with("NotFound") || variant == "MissingEntity";
        (is_error && is_missing).then_some(path)
    }

    fn in_helper(&self) -> bool {
        self.in_trait_impl
            || self.functions.last().is_some_and(|name| {
                name.starts_with("require")
                    || name.starts_with("or_")
                    || name.ends_with("not_found")
            })
    }

    fn check_infallible_impl(&mut self, item: &syn::ItemImpl) {
        let Some((_, path, _)) = &item.trait_ else {
            return;
        };
        let Some(trait_name) = path
            .segments
            .last()
            .map(|segment| segment.ident.to_string())
        else {
            return;
        };
        if !INFALLIBLE_TRAITS.contains(&trait_name.as_str()) {
            return;
        }
        let mut panics = Panics::default();
        for member in &item.items {
            if let syn::ImplItem::Fn(function) = member {
                panics.visit_block(&function.block);
            }
        }
        let Some(first) = panics.found.first() else {
            return;
        };
        let self_type = syntax::type_name(&item.self_ty).unwrap_or_default();
        let detail = format!(
            "impl {trait_name} for {self_type} can panic ({first}): make it fallible or total"
        );
        self.report
            .add(Kind::PanickingConversion, item.self_ty.span(), detail);
    }
}

/// What in a body can panic: `unwrap`, `expect` and the panicking macros.
#[derive(Default)]
struct Panics {
    found: Vec<String>,
}

impl<'ast> Visit<'ast> for Panics {
    fn visit_expr_method_call(&mut self, call: &'ast syn::ExprMethodCall) {
        if call.method == "unwrap" || call.method == "expect" {
            self.found.push(format!(".{}()", call.method));
        }
        visit::visit_expr_method_call(self, call);
    }

    fn visit_macro(&mut self, mac: &'ast syn::Macro) {
        let name = mac
            .path
            .segments
            .last()
            .map(|segment| segment.ident.to_string());
        if let Some(name) = name.filter(|name| PANICS.contains(&name.as_str())) {
            self.found.push(format!("{name}!"));
        }
        visit::visit_macro(self, mac);
    }
}

impl<'ast> Visit<'ast> for ErrorScan<'_> {
    fn visit_item_fn(&mut self, function: &'ast syn::ItemFn) {
        self.check_signature(&function.sig);
        self.functions.push(function.sig.ident.to_string());
        visit::visit_item_fn(self, function);
        self.functions.pop();
    }

    fn visit_impl_item_fn(&mut self, method: &'ast syn::ImplItemFn) {
        if !self.in_trait_impl {
            self.check_signature(&method.sig);
        }
        self.functions.push(method.sig.ident.to_string());
        visit::visit_impl_item_fn(self, method);
        self.functions.pop();
    }

    fn visit_trait_item_fn(&mut self, method: &'ast syn::TraitItemFn) {
        self.check_signature(&method.sig);
        self.functions.push(method.sig.ident.to_string());
        visit::visit_trait_item_fn(self, method);
        self.functions.pop();
    }

    fn visit_item_impl(&mut self, item: &'ast syn::ItemImpl) {
        self.check_infallible_impl(item);
        let outer = self.in_trait_impl;
        self.in_trait_impl = item.trait_.is_some();
        visit::visit_item_impl(self, item);
        self.in_trait_impl = outer;
    }

    fn visit_item_enum(&mut self, item: &'ast syn::ItemEnum) {
        self.check_error_enum(item);
        visit::visit_item_enum(self, item);
    }

    fn visit_expr(&mut self, expr: &'ast Expr) {
        self.check_text_error(expr);
        if let Some(path) = Self::built_variant(expr).filter(|_| !self.in_helper()) {
            let variant = path.to_token_stream().to_string().replace(' ', "");
            let detail = format!("{variant} built inline: call the `require_*` helper");
            self.report.add(Kind::InlineNotFound, expr.span(), detail);
            // The variant's path is an expression too; only its arguments
            // can build another error.
            if let Expr::Call(call) = expr {
                call.args.iter().for_each(|arg| self.visit_expr(arg));
                return;
            }
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

    #[test]
    fn a_string_error_is_reported_in_signatures_and_variants() {
        let found = findings(
            "pub fn parse(text: &str) -> Result<u32, String> {}
             pub fn read(text: &str) -> Result<u32, ParseError> {}
             enum FormatError { Ufo(String), Missing { message: String }, Io(#[from] io::Error), At { line: usize, path: String } }
             fn read_ufo(name: &str) {
                 let missing = FormatError::Ufo(format!(\"no glyph {name}\"));
                 let named = CoreError::InvalidGlyphName(name.to_string());
                 load(name).map_err(|e| e.to_string());
                 load(name).map_err(|error| FormatError::Ufo(error.to_string()));
                 load(name).map_err(FormatError::Io);
             }",
        );
        let details: Vec<_> = found.into_iter().map(|(_, detail)| detail).collect();
        assert_eq!(
            details,
            [
                "parse returns `Result<_, String>`: give it an error type",
                "FormatError::Missing carries a message: a variant per reason, `#[source]` for a cause",
                "FormatError::Ufo built from text: a variant per reason, `#[source]` for a cause",
                "`.map_err` to text: wrap the error with `#[from]` or `#[source]`",
                "FormatError::Ufo built from text: a variant per reason, `#[source]` for a cause",
            ]
        );
    }

    #[test]
    fn a_not_found_built_outside_a_helper_is_reported() {
        let found = findings(
            "fn remove(&mut self, id: &AnchorId) {
                 if !self.has(id) { return Err(CoreError::AnchorNotFound(id.clone())); }
             }
             fn require_anchor(&self, id: &AnchorId) { self.anchor(id).ok_or_else(|| CoreError::AnchorNotFound(id.clone())) }
             impl EntityRef for AnchorId { fn missing(&self) -> CoreError { CoreError::AnchorNotFound(self.clone()) } }
             fn matches(error: CoreError) { if let CoreError::AnchorNotFound(_) = error {} }",
        );
        assert_eq!(
            found,
            [(
                Kind::InlineNotFound,
                "CoreError::AnchorNotFound built inline: call the `require_*` helper".to_string()
            )]
        );
    }

    #[test]
    fn an_infallible_impl_that_can_panic_is_reported() {
        let found = findings(
            "impl From<String> for GlyphName { fn from(value: String) -> Self { Self::new(value).expect(\"named\") } }
             impl Default for Font { fn default() -> Self { Self::new() } }
             impl TryFrom<String> for Tag { fn try_from(value: String) -> Self { parse(value).unwrap() } }",
        );
        assert_eq!(
            found,
            [(
                Kind::PanickingConversion,
                "impl From for GlyphName can panic (.expect()): make it fallible or total"
                    .to_string()
            )]
        );
    }
}
