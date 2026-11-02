//! Function bodies that compute the same thing in two places: the same rule
//! written again against a different owner, often with different edge
//! handling (`normalize` on `Axis`, on `DesignNormalization`, on
//! `InterpolationAxis`).
//!
//! Two bodies are alike when either measure passes:
//!
//! - **Same tokens:** the Jaccard similarity of their 5-token shingles is at
//!   least [`SAME_TOKENS`], for bodies of [`MIN_TOKENS`] tokens or more. It
//!   finds copies that were pasted and lightly edited.
//! - **Same arithmetic:** they share at least [`MIN_SHARED_ARITHMETIC`]
//!   distinct binary operations on plain values (`value - default`,
//!   `default - minimum`), and those are at least [`SAME_ARITHMETIC`] of the
//!   two sets. It finds a rule rewritten with different control flow, which
//!   no token measure sees.
//!
//! Before either comparison, `self.` and `<parameter>.` are dropped before a
//! field or method, so `self.default`, `axis.default` and a local `default`
//! read the same, and string literals lose their text.

use std::collections::{BTreeMap, BTreeSet, HashSet};
use std::fmt::Write as _;
use std::hash::{DefaultHasher, Hash, Hasher};
use std::path::{Path, PathBuf};

use proc_macro2::{Delimiter, TokenStream, TokenTree};
use quote::ToTokens;
use syn::visit::{self, Visit};
use syn::{BinOp, Expr, FnArg, Pat};

use crate::file_scan::FileScan;
use crate::finding::{Finding, Kind};

/// Normalized tokens a body needs before its shape is compared. Shorter
/// bodies (getters, one-call wrappers) match each other by chance.
const MIN_TOKENS: usize = 60;
/// Tokens in a row that make one shingle.
const SHINGLE: usize = 5;
/// Shingle overlap at which two bodies are copies.
const SAME_TOKENS: f64 = 0.6;
/// Distinct plain-value operations two bodies must share to be one rule.
const MIN_SHARED_ARITHMETIC: usize = 4;
/// Overlap of the operation sets at which two bodies are one rule.
const SAME_ARITHMETIC: f64 = 0.5;
/// A shingle or operation in more bodies than this (`} else {`, `index + 1`)
/// says nothing about any two of them, and is not counted.
const COMMON: usize = 40;

/// One non-test function body, normalized for comparison.
pub(crate) struct FnBody {
    path: PathBuf,
    line: usize,
    name: String,
    shingles: BTreeSet<u64>,
    arithmetic: BTreeSet<String>,
}

impl FnBody {
    fn of(path: &Path, sig: &syn::Signature, block: &syn::Block) -> Self {
        let mut owners: HashSet<String> = sig
            .inputs
            .iter()
            .filter_map(|input| match input {
                FnArg::Typed(typed) => match &*typed.pat {
                    Pat::Ident(name) => Some(name.ident.to_string()),
                    _ => None,
                },
                FnArg::Receiver(_) => None,
            })
            .collect();
        owners.insert("self".to_string());

        let mut tokens = Vec::new();
        Self::normalize(block.to_token_stream(), &owners, &mut tokens);
        let shingles = if tokens.len() < MIN_TOKENS {
            BTreeSet::new()
        } else {
            tokens.windows(SHINGLE).map(Self::hash).collect()
        };

        let mut operations = PlainOperations::default();
        operations.visit_block(block);
        let arithmetic = operations
            .found
            .into_iter()
            .map(|operation| {
                let mut tokens = Vec::new();
                Self::normalize(operation, &owners, &mut tokens);
                tokens.join(" ")
            })
            .collect();

        Self {
            path: path.to_path_buf(),
            line: sig.ident.span().start().line,
            name: sig.ident.to_string(),
            shingles,
            arithmetic,
        }
    }

    fn hash(window: &[String]) -> u64 {
        let mut hasher = DefaultHasher::new();
        window.hash(&mut hasher);
        hasher.finish()
    }

    /// Flattens `stream` into token text, dropping an owner and its `.`
    /// before a field or method, and the text of string literals.
    fn normalize(stream: TokenStream, owners: &HashSet<String>, tokens: &mut Vec<String>) {
        let mut trees = stream.into_iter().peekable();
        while let Some(tree) = trees.next() {
            match tree {
                TokenTree::Ident(ident) => {
                    let before_dot = matches!(
                        trees.peek(),
                        Some(TokenTree::Punct(punct)) if punct.as_char() == '.'
                    );
                    if before_dot && owners.contains(&ident.to_string()) {
                        trees.next();
                    } else {
                        tokens.push(ident.to_string());
                    }
                }
                TokenTree::Group(group) => {
                    let (open, close) = match group.delimiter() {
                        Delimiter::Parenthesis => ("(", ")"),
                        Delimiter::Brace => ("{", "}"),
                        Delimiter::Bracket => ("[", "]"),
                        Delimiter::None => ("", ""),
                    };
                    tokens.push(open.to_string());
                    Self::normalize(group.stream(), owners, tokens);
                    tokens.push(close.to_string());
                }
                TokenTree::Punct(punct) => tokens.push(punct.as_char().to_string()),
                TokenTree::Literal(literal) => {
                    let text = literal.to_string();
                    let string = text.starts_with('"') || text.starts_with("r#");
                    tokens.push(if string { "\"\"".to_string() } else { text });
                }
            }
        }
    }

    fn place(&self) -> String {
        format!("{}:{} {}", self.path.display(), self.line, self.name)
    }
}

/// Binary operations whose operands are plain values (names, fields,
/// literals): `value - default`, `range == 0.0`. Logical `&&`/`||` are
/// control flow, not arithmetic, and are left out.
#[derive(Default)]
struct PlainOperations {
    found: Vec<TokenStream>,
}

impl PlainOperations {
    fn is_plain(expr: &Expr) -> bool {
        match expr {
            Expr::Path(_) | Expr::Lit(_) => true,
            Expr::Field(field) => Self::is_plain(&field.base),
            Expr::Unary(unary) => Self::is_plain(&unary.expr),
            Expr::Paren(paren) => Self::is_plain(&paren.expr),
            _ => false,
        }
    }
}

impl<'ast> Visit<'ast> for PlainOperations {
    fn visit_expr_binary(&mut self, binary: &'ast syn::ExprBinary) {
        let logical = matches!(binary.op, BinOp::And(_) | BinOp::Or(_));
        if !logical && Self::is_plain(&binary.left) && Self::is_plain(&binary.right) {
            self.found.push(binary.to_token_stream());
        }
        visit::visit_expr_binary(self, binary);
    }
}

/// Collects one file's non-test function bodies.
pub(crate) struct FnBodies<'a> {
    path: &'a Path,
    pub(crate) found: Vec<FnBody>,
}

impl<'a> FnBodies<'a> {
    pub(crate) fn new(path: &'a Path) -> Self {
        Self {
            path,
            found: Vec::new(),
        }
    }
}

impl<'ast> Visit<'ast> for FnBodies<'_> {
    fn visit_item_mod(&mut self, module: &'ast syn::ItemMod) {
        if !FileScan::is_test(&module.attrs) {
            visit::visit_item_mod(self, module);
        }
    }

    fn visit_item_impl(&mut self, item: &'ast syn::ItemImpl) {
        if !FileScan::is_test(&item.attrs) {
            visit::visit_item_impl(self, item);
        }
    }

    fn visit_item_fn(&mut self, function: &'ast syn::ItemFn) {
        if FileScan::is_test(&function.attrs) {
            return;
        }
        let body = FnBody::of(self.path, &function.sig, &function.block);
        self.found.push(body);
        visit::visit_item_fn(self, function);
    }

    fn visit_impl_item_fn(&mut self, method: &'ast syn::ImplItemFn) {
        if FileScan::is_test(&method.attrs) {
            return;
        }
        let body = FnBody::of(self.path, &method.sig, &method.block);
        self.found.push(body);
        visit::visit_impl_item_fn(self, method);
    }

    fn visit_trait_item_fn(&mut self, method: &'ast syn::TraitItemFn) {
        if let Some(block) = &method.default {
            let body = FnBody::of(self.path, &method.sig, block);
            self.found.push(body);
        }
        visit::visit_trait_item_fn(self, method);
    }
}

/// How two bodies were found alike.
#[derive(Clone, Copy)]
enum Likeness {
    SameTokens { similarity: f64 },
    SameArithmetic { shared: usize, of: usize },
}

impl Likeness {
    fn describe(self) -> String {
        match self {
            Self::SameTokens { similarity } => format!("{:.0}% same tokens", similarity * 100.0),
            Self::SameArithmetic { shared, of } => format!("{shared} of {of} operations shared"),
        }
    }
}

/// The bodies of every scanned crate, compared with each other.
pub(crate) struct DuplicateBodies {
    bodies: Vec<FnBody>,
}

impl DuplicateBodies {
    pub(crate) fn new(bodies: Vec<FnBody>) -> Self {
        Self { bodies }
    }

    /// Reports every body that is alike another, at its signature, naming the
    /// rest of its group.
    pub(crate) fn findings(&self) -> Vec<Finding> {
        let mut likeness: BTreeMap<(usize, usize), Likeness> = BTreeMap::new();
        let shingles = Self::overlaps(self.bodies.iter().map(|body| &body.shingles));
        for ((left, right), shared) in shingles {
            let union =
                self.bodies[left].shingles.len() + self.bodies[right].shingles.len() - shared;
            #[allow(clippy::cast_precision_loss, reason = "counts of a few thousand")]
            let similarity = shared as f64 / union as f64;
            if similarity >= SAME_TOKENS {
                likeness.insert((left, right), Likeness::SameTokens { similarity });
            }
        }
        let arithmetic = Self::overlaps(self.bodies.iter().map(|body| &body.arithmetic));
        for ((left, right), shared) in arithmetic {
            let of =
                self.bodies[left].arithmetic.len() + self.bodies[right].arithmetic.len() - shared;
            #[allow(clippy::cast_precision_loss, reason = "counts of a few dozen")]
            let overlap = shared as f64 / of as f64;
            if shared >= MIN_SHARED_ARITHMETIC && overlap >= SAME_ARITHMETIC {
                likeness
                    .entry((left, right))
                    .or_insert(Likeness::SameArithmetic { shared, of });
            }
        }
        self.report(&likeness)
    }

    /// How many items each pair of sets shares, for pairs sharing any, through
    /// an index from item to sets so that unrelated pairs cost nothing.
    fn overlaps<'a, T: Ord + 'a>(
        sets: impl Iterator<Item = &'a BTreeSet<T>>,
    ) -> BTreeMap<(usize, usize), usize> {
        let mut holders: BTreeMap<&T, Vec<usize>> = BTreeMap::new();
        for (set, items) in sets.enumerate() {
            for item in items {
                holders.entry(item).or_default().push(set);
            }
        }
        let mut shared = BTreeMap::new();
        for sets in holders.values().filter(|sets| sets.len() <= COMMON) {
            for (position, left) in sets.iter().enumerate() {
                for right in &sets[position + 1..] {
                    *shared.entry((*left, *right)).or_default() += 1;
                }
            }
        }
        shared
    }

    /// One finding per body in a pair, naming each body it is alike.
    fn report(&self, likeness: &BTreeMap<(usize, usize), Likeness>) -> Vec<Finding> {
        let mut alike: BTreeMap<usize, Vec<(usize, Likeness)>> = BTreeMap::new();
        for (&(left, right), &how) in likeness {
            alike.entry(left).or_default().push((right, how));
            alike.entry(right).or_default().push((left, how));
        }
        alike
            .into_iter()
            .map(|(index, others)| {
                let body = &self.bodies[index];
                let mut detail = format!("{} is alike", body.name);
                for (other, how) in others {
                    let _ = write!(
                        detail,
                        "; {} ({})",
                        self.bodies[other].place(),
                        how.describe()
                    );
                }
                Finding {
                    path: body.path.clone(),
                    line: body.line,
                    kind: Kind::DuplicateBody,
                    detail,
                }
            })
            .collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn findings(files: &[(&str, &str)]) -> Vec<(String, String)> {
        let mut bodies = Vec::new();
        for (path, source) in files {
            let syntax = syn::parse_file(source).unwrap();
            let mut collector = FnBodies::new(Path::new(path));
            collector.visit_file(&syntax);
            bodies.extend(collector.found);
        }
        DuplicateBodies::new(bodies)
            .findings()
            .into_iter()
            .map(|finding| {
                let place = format!("{}:{}", finding.path.display(), finding.line);
                (place, finding.detail)
            })
            .collect()
    }

    /// Two of the axis normalizations on main: the same rule against a
    /// method's fields and against a function's parameters.
    const AXIS_NORMALIZE: &str = "impl Axis {
        pub fn normalize(&self, value: f64) -> f64 {
            let minimum = self.minimum();
            let default = self.default();
            let maximum = self.maximum();
            if value < default {
                if (default - minimum).abs() < f64::EPSILON { 0.0 } else { (value - default) / (default - minimum) }
            } else if value > default {
                if (maximum - default).abs() < f64::EPSILON { 0.0 } else { (value - default) / (maximum - default) }
            } else {
                0.0
            }
        }
    }";
    const DESIGN_NORMALIZE: &str = "impl DesignNormalization {
        pub fn normalize(&self, value: f64) -> f64 {
            let tolerance = 1e-9 * (1.0 + self.default.abs());
            let range = if value < self.default { self.default - self.minimum } else { self.maximum - self.default };
            if range.abs() < tolerance || (value - self.default).abs() < tolerance {
                return 0.0;
            }
            snap((value - self.default) / range)
        }
    }";

    #[test]
    fn a_rule_rewritten_with_other_control_flow_shares_its_arithmetic() {
        let found = findings(&[
            ("axis.rs", AXIS_NORMALIZE),
            ("variation.rs", DESIGN_NORMALIZE),
        ]);
        assert_eq!(
            found,
            [
                (
                    "axis.rs:2".to_string(),
                    "normalize is alike; variation.rs:2 normalize (4 of 5 operations shared)"
                        .to_string()
                ),
                (
                    "variation.rs:2".to_string(),
                    "normalize is alike; axis.rs:2 normalize (4 of 5 operations shared)"
                        .to_string()
                ),
            ]
        );
    }

    #[test]
    fn a_copy_against_another_owner_has_the_same_tokens() {
        let on_self = "impl Font { fn shown_names(&self, prefix: &str) -> Vec<String> {
            let shown = self.layers.iter().filter(|layer| layer.visible && !layer.locked);
            let names = shown.map(|layer| format!(\"{prefix}{}\", layer.name.to_uppercase()));
            names.filter(|name| !name.is_empty()).take(self.limit).collect()
        } }";
        let on_parameter = "fn shown_names(font: &Font, prefix: &str) -> Vec<String> {
            let shown = font.layers.iter().filter(|layer| layer.visible && !layer.locked);
            let names = shown.map(|layer| format!(\"{prefix}-{}\", layer.name.to_uppercase()));
            names.filter(|name| !name.is_empty()).take(font.limit).collect()
        }";
        let found = findings(&[("a.rs", on_self), ("b.rs", on_parameter)]);
        assert_eq!(
            found,
            [
                (
                    "a.rs:1".to_string(),
                    "shown_names is alike; b.rs:1 shown_names (100% same tokens)".to_string()
                ),
                (
                    "b.rs:1".to_string(),
                    "shown_names is alike; a.rs:1 shown_names (100% same tokens)".to_string()
                ),
            ]
        );
    }

    #[test]
    fn short_or_unrelated_bodies_are_not_alike() {
        let getters =
            "impl A { fn id(&self) -> u32 { self.id } } impl B { fn id(&self) -> u32 { self.id } }";
        assert!(findings(&[("lib.rs", getters)]).is_empty());

        let unrelated = "fn area(width: f64, height: f64) -> f64 { width * height - width / height + 1.0 * 2.0 }";
        assert!(findings(&[("a.rs", AXIS_NORMALIZE), ("b.rs", unrelated)]).is_empty());
    }

    #[test]
    fn test_bodies_are_skipped() {
        let tested = format!("#[cfg(test)] mod tests {{ {AXIS_NORMALIZE} }}");
        assert!(findings(&[("a.rs", AXIS_NORMALIZE), ("b.rs", &tested)]).is_empty());
    }
}
