//! Kinds about test code: tests that reach private functions, public
//! functions only tests call, long and near-duplicate tests, helpers written
//! in several test files, setup copied between tests, and error asserts that
//! don't say which error.

use std::collections::{BTreeMap, BTreeSet};
use std::path::Path;

use quote::ToTokens;
use syn::punctuated::Punctuated;
use syn::spanned::Spanned;
use syn::visit::{self, Visit};
use syn::{Expr, ItemFn};

use crate::duplicate::{DuplicateBodies, FnBody};
use crate::finding::{Finding, Kind};
use crate::syntax;

/// Lines a unit test's body may have.
const LONG_TEST_LINES: usize = 40;
/// Token-pair overlap at which two tests in one file are near copies.
const SAME_TEST: f64 = 0.85;
/// Tokens a test needs before it is compared: shorter tests are alike by
/// chance.
const MIN_TEST_TOKENS: usize = 30;
/// Tests that must open with the same two statements before it is a fixture.
const SETUP_COPIES: usize = 5;
/// Attributes that mark a test function rather than a helper.
const TEST_ATTRIBUTES: [&str; 2] = ["test", "rstest"];
/// Method names the standard library and common traits define, which a
/// test calling on some other type doesn't make a call to the crate's
/// private function of that name.
const STANDARD_METHODS: [&str; 24] = [
    "new",
    "default",
    "from",
    "into",
    "clone",
    "collect",
    "len",
    "is_empty",
    "iter",
    "get",
    "insert",
    "remove",
    "push",
    "contains",
    "map",
    "unwrap",
    "expect",
    "as_str",
    "to_string",
    "parse",
    "next",
    "fmt",
    "eq",
    "write",
];
/// Names an error value goes by.
const ERROR_NAMES: [&str; 3] = ["e", "err", "error"];

/// What a source file holds.
#[derive(Clone, Copy, PartialEq, Eq)]
pub(crate) enum Role {
    /// Library code, perhaps with inline `#[cfg(test)]` modules.
    Library,
    /// A unit test file under `src`: `tests.rs`, `*_tests.rs`, `test_support.rs`.
    UnitTests,
    /// An integration test under the crate's `tests/`, which sees only the
    /// public API.
    IntegrationTests,
}

/// One `#[test]` function, and the helper names its module defines when it
/// is a unit test.
pub(crate) struct UnitTest<'a> {
    item: &'a ItemFn,
    module: Option<usize>,
}

/// The tests and helpers of one file.
pub(crate) struct TestCode<'a> {
    path: &'a Path,
    tests: Vec<UnitTest<'a>>,
    helpers: Vec<&'a ItemFn>,
    /// The function names each unit test module defines.
    modules: Vec<BTreeSet<String>>,
    in_test: bool,
    module: Option<usize>,
}

impl<'a> TestCode<'a> {
    pub(crate) fn of(path: &'a Path, syntax: &'a syn::File, role: Role) -> Self {
        let mut code = Self {
            path,
            tests: Vec::new(),
            helpers: Vec::new(),
            modules: Vec::new(),
            in_test: role != Role::Library,
            module: None,
        };
        if role == Role::UnitTests {
            code.modules
                .push(FnNames::of(|names| names.visit_file(syntax)));
            code.module = Some(0);
        }
        code.visit_file(syntax);
        code
    }

    pub(crate) fn helper_bodies(&self) -> Vec<FnBody> {
        self.helpers
            .iter()
            .map(|helper| FnBody::of(self.path, &helper.sig, &helper.block))
            .collect()
    }

    fn finding(&self, item: &ItemFn, kind: Kind, detail: String) -> Finding {
        Finding {
            path: self.path.to_path_buf(),
            line: item.sig.ident.span().start().line,
            kind,
            detail,
        }
    }

    /// The kinds read off one test at a time, and near copies within the file.
    pub(crate) fn findings(&self, private: &BTreeSet<String>) -> Vec<Finding> {
        let mut findings = Vec::new();
        for test in &self.tests {
            let name = &test.item.sig.ident;
            let lines = syntax::line_count(test.item.block.brace_token.span.join());
            if lines > LONG_TEST_LINES {
                let detail = format!("{name} is {lines} lines: split it or name its setup");
                findings.push(self.finding(test.item, Kind::LongTest, detail));
            }
            if let Some(called) = self.private_call(test, private) {
                let detail =
                    format!("{name} calls non-pub `{called}`: test through the public API");
                findings.push(self.finding(test.item, Kind::TestCallsPrivate, detail));
            }
            let mut asserts = WeakAsserts::default();
            asserts.visit_block(&test.item.block);
            for weak in asserts.found {
                findings.push(Finding {
                    path: self.path.to_path_buf(),
                    line: weak.line,
                    kind: Kind::WeakErrorAssert,
                    detail: weak.detail,
                });
            }
        }
        findings.extend(self.near_duplicates());
        findings
    }

    /// The first private function of the crate a unit test calls that its
    /// own module doesn't define.
    fn private_call(&self, test: &UnitTest<'_>, private: &BTreeSet<String>) -> Option<String> {
        let local = &self.modules[test.module?];
        let mut calls = Calls::default();
        calls.visit_block(&test.item.block);
        calls.names.into_iter().find(|name| {
            let standard = STANDARD_METHODS.contains(&name.as_str());
            private.contains(name) && !local.contains(name) && !standard
        })
    }

    fn near_duplicates(&self) -> Vec<Finding> {
        let tokens: Vec<_> = self
            .tests
            .iter()
            .map(|test| TestTokens::of(&test.item.sig, &test.item.block))
            .collect();
        let mut alike: BTreeMap<usize, Vec<usize>> = BTreeMap::new();
        for (position, left) in tokens.iter().enumerate() {
            for (offset, right) in tokens[position + 1..].iter().enumerate() {
                if left.similarity(right) >= SAME_TEST {
                    let other = position + 1 + offset;
                    alike.entry(position).or_default().push(other);
                    alike.entry(other).or_default().push(position);
                }
            }
        }
        alike
            .into_iter()
            .map(|(index, others)| {
                let names: Vec<_> = others
                    .iter()
                    .map(|other| self.tests[*other].item.sig.ident.to_string())
                    .collect();
                let item = self.tests[index].item;
                let detail = format!(
                    "{} is a near copy of {}: one table-driven test",
                    item.sig.ident,
                    names.join(", ")
                );
                self.finding(item, Kind::NearDuplicateTests, detail)
            })
            .collect()
    }

    /// Each test's first two statements as text, for finding copied setup.
    pub(crate) fn setups(&self) -> Vec<(String, Finding)> {
        self.tests
            .iter()
            .filter(|test| test.item.block.stmts.len() > 2)
            .map(|test| {
                let setup: Vec<_> = test.item.block.stmts[..2]
                    .iter()
                    .map(|stmt| stmt.to_token_stream().to_string())
                    .collect();
                let finding = self.finding(test.item, Kind::TestSetupCopy, String::new());
                (setup.join(" "), finding)
            })
            .collect()
    }

    fn is_test_fn(attrs: &[syn::Attribute]) -> bool {
        attrs.iter().any(|attr| {
            attr.path().segments.last().is_some_and(|segment| {
                TEST_ATTRIBUTES.contains(&segment.ident.to_string().as_str())
            })
        })
    }
}

impl<'a> Visit<'a> for TestCode<'a> {
    fn visit_item_mod(&mut self, module: &'a syn::ItemMod) {
        let outer = (self.in_test, self.module);
        if !self.in_test && syntax::is_test(&module.attrs) {
            self.modules
                .push(FnNames::of(|names| names.visit_item_mod(module)));
            self.module = Some(self.modules.len() - 1);
            self.in_test = true;
        }
        visit::visit_item_mod(self, module);
        (self.in_test, self.module) = outer;
    }

    fn visit_item_fn(&mut self, function: &'a ItemFn) {
        if !self.in_test {
            return;
        }
        if Self::is_test_fn(&function.attrs) {
            self.tests.push(UnitTest {
                item: function,
                module: self.module,
            });
        } else {
            self.helpers.push(function);
        }
    }
}

/// A test's token pairs, counted, for comparing tests that differ in a
/// literal or a name.
struct TestTokens {
    pairs: BTreeMap<(String, String), usize>,
    total: usize,
}

impl TestTokens {
    fn of(sig: &syn::Signature, block: &syn::Block) -> Self {
        let tokens = FnBody::tokens(sig, block);
        let mut pairs: BTreeMap<(String, String), usize> = BTreeMap::new();
        if tokens.len() >= MIN_TEST_TOKENS {
            for pair in tokens.windows(2) {
                *pairs.entry((pair[0].clone(), pair[1].clone())).or_default() += 1;
            }
        }
        let total = pairs.values().sum();
        Self { pairs, total }
    }

    /// The Dice coefficient of the two pair counts: 1 for the same tokens.
    fn similarity(&self, other: &Self) -> f64 {
        if self.total == 0 || other.total == 0 {
            return 0.0;
        }
        let shared: usize = self
            .pairs
            .iter()
            .map(|(pair, count)| {
                other
                    .pairs
                    .get(pair)
                    .map_or(0, |theirs| (*count).min(*theirs))
            })
            .sum();
        2.0 * shared as f64 / (self.total + other.total) as f64
    }
}

/// The names of every function an item defines.
#[derive(Default)]
struct FnNames {
    names: BTreeSet<String>,
}

impl FnNames {
    fn of(walk: impl FnOnce(&mut Self)) -> BTreeSet<String> {
        let mut names = Self::default();
        walk(&mut names);
        names.names
    }
}

impl<'ast> Visit<'ast> for FnNames {
    fn visit_signature(&mut self, sig: &'ast syn::Signature) {
        self.names.insert(sig.ident.to_string());
    }
}

/// The expressions a macro call holds, when its body parses as a
/// comma-separated list: `assert!(a.is_err())`, `assert_eq!(f(x), 3)`.
fn macro_exprs(mac: &syn::Macro) -> Vec<Expr> {
    mac.parse_body_with(Punctuated::<Expr, syn::Token![,]>::parse_terminated)
        .map(|exprs| exprs.into_iter().collect())
        .unwrap_or_default()
}

/// The functions and methods a body calls, by name, inside macros too.
#[derive(Default)]
struct Calls {
    names: Vec<String>,
}

impl<'ast> Visit<'ast> for Calls {
    fn visit_expr_call(&mut self, call: &'ast syn::ExprCall) {
        if let Expr::Path(path) = &*call.func
            && let Some(segment) = path.path.segments.last()
        {
            self.names.push(segment.ident.to_string());
        }
        visit::visit_expr_call(self, call);
    }

    fn visit_expr_method_call(&mut self, call: &'ast syn::ExprMethodCall) {
        self.names.push(call.method.to_string());
        visit::visit_expr_method_call(self, call);
    }

    fn visit_macro(&mut self, mac: &'ast syn::Macro) {
        for expr in macro_exprs(mac) {
            self.visit_expr(&expr);
        }
    }
}

/// One assert that passes for any error.
struct WeakAssert {
    line: usize,
    detail: String,
}

/// `assert!(r.is_err())` and `error.to_string().contains(..)`.
#[derive(Default)]
struct WeakAsserts {
    found: Vec<WeakAssert>,
}

impl WeakAsserts {
    fn is_error(expr: &Expr) -> bool {
        match expr {
            Expr::MethodCall(call) => {
                ["unwrap_err", "expect_err", "err"].contains(&call.method.to_string().as_str())
            }
            Expr::Path(path) => path.path.get_ident().is_some_and(|name| {
                let name = name.to_string();
                ERROR_NAMES.contains(&name.as_str()) || name.ends_with("error")
            }),
            Expr::Reference(reference) => Self::is_error(&reference.expr),
            _ => false,
        }
    }

    fn add(&mut self, span: proc_macro2::Span, detail: &str) {
        self.found.push(WeakAssert {
            line: span.start().line,
            detail: detail.to_string(),
        });
    }
}

impl<'ast> Visit<'ast> for WeakAsserts {
    fn visit_macro(&mut self, mac: &'ast syn::Macro) {
        let exprs = macro_exprs(mac);
        let is_assert = mac.path.is_ident("assert");
        let any_error = matches!(exprs.first(), Some(Expr::MethodCall(call))
            if call.method == "is_err" && call.args.is_empty());
        if is_assert && any_error {
            let span = mac.path.span();
            self.add(span, "`assert!(..is_err())` passes for any error: `assert!(matches!(.., Err(Error::Variant(..))))`");
        }
        for expr in &exprs {
            self.visit_expr(expr);
        }
    }

    fn visit_expr_method_call(&mut self, call: &'ast syn::ExprMethodCall) {
        let text_of_error = matches!(&*call.receiver, Expr::MethodCall(inner)
            if inner.method == "to_string" && Self::is_error(&inner.receiver));
        if call.method == "contains" && text_of_error {
            self.add(
                call.method.span(),
                "an error's text is matched: match its variant",
            );
        }
        visit::visit_expr_method_call(self, call);
    }
}

/// Tests across one crate that open with the same two statements, when at
/// least [`SETUP_COPIES`] do.
pub(crate) fn setup_copies(setups: Vec<(String, Finding)>) -> Vec<Finding> {
    let mut groups: BTreeMap<String, Vec<Finding>> = BTreeMap::new();
    for (setup, finding) in setups {
        groups.entry(setup).or_default().push(finding);
    }
    let mut findings = Vec::new();
    for (setup, copies) in groups
        .into_iter()
        .filter(|(_, copies)| copies.len() >= SETUP_COPIES)
    {
        let count = copies.len();
        let shown: String = setup.chars().take(80).collect();
        for copy in copies {
            findings.push(Finding {
                detail: format!("{count} tests open with `{shown}`: one fixture"),
                ..copy
            });
        }
    }
    findings
}

/// Helpers defined in two or more test files under one name, or with alike
/// bodies: one finding per copy.
pub(crate) fn repeated_helpers(helpers: Vec<FnBody>) -> Vec<Finding> {
    let mut files: BTreeMap<&str, BTreeSet<&Path>> = BTreeMap::new();
    for helper in &helpers {
        files.entry(&helper.name).or_default().insert(&helper.path);
    }
    let mut findings: Vec<_> = helpers
        .iter()
        .filter_map(|helper| {
            let copies = &files[helper.name.as_str()];
            (copies.len() > 1).then(|| Finding {
                path: helper.path.clone(),
                line: helper.line,
                kind: Kind::RepeatedTestHelper,
                detail: format!(
                    "{} is defined in {} test files: share one in test support",
                    helper.name,
                    copies.len()
                ),
            })
        })
        .collect();
    let named: BTreeSet<_> = findings
        .iter()
        .map(|finding| (finding.path.clone(), finding.line))
        .collect();
    let alike = DuplicateBodies::new(helpers, Kind::RepeatedTestHelper).findings();
    findings.extend(
        alike
            .into_iter()
            .filter(|finding| !named.contains(&(finding.path.clone(), finding.line))),
    );
    findings
}

#[cfg(test)]
mod tests {
    use super::*;

    fn unit_findings(source: &str, private: &[&str]) -> Vec<(Kind, String)> {
        let syntax = syn::parse_file(source).unwrap();
        let private: BTreeSet<_> = private.iter().map(ToString::to_string).collect();
        TestCode::of(Path::new("lib.rs"), &syntax, Role::Library)
            .findings(&private)
            .into_iter()
            .map(|finding| (finding.kind, finding.detail))
            .collect()
    }

    #[test]
    fn a_test_calling_a_private_function_is_reported() {
        let found = unit_findings(
            "fn normalize() {}
             #[cfg(test)] mod tests {
                 fn square() {}
                 #[test] fn reaches_in() { assert_eq!(normalize(), 0); }
                 #[test] fn uses_its_helper() { square(); }
             }",
            &["normalize", "square"],
        );
        assert_eq!(
            found,
            [(
                Kind::TestCallsPrivate,
                "reaches_in calls non-pub `normalize`: test through the public API".to_string()
            )]
        );
    }

    #[test]
    fn a_long_test_is_reported() {
        let body = "let x = 1;\n".repeat(LONG_TEST_LINES);
        let source = format!("#[cfg(test)] mod tests {{ #[test] fn long() {{\n{body}}} }}");
        let found = unit_findings(&source, &[]);
        assert_eq!(
            found,
            [(
                Kind::LongTest,
                "long is 42 lines: split it or name its setup".to_string()
            )]
        );
    }

    #[test]
    fn an_assert_that_passes_for_any_error_is_reported() {
        let found = unit_findings(
            "#[cfg(test)] mod tests {
                 #[test] fn weak() {
                     assert!(parse(\"\").is_err());
                     assert!(parse(\"\").unwrap_err().to_string().contains(\"empty\"));
                     assert!(matches!(parse(\"\"), Err(ParseError::Empty)));
                 }
             }",
            &[],
        );
        let kinds: Vec<_> = found.into_iter().map(|(kind, _)| kind).collect();
        assert_eq!(kinds, [Kind::WeakErrorAssert, Kind::WeakErrorAssert]);
    }

    #[test]
    fn near_copies_in_one_file_are_reported() {
        let test = |name: &str, value: u32| {
            format!(
                "#[test] fn {name}() {{ let font = Font::new(); let glyph = font.add_glyph(\"a\"); \
                 let layer = glyph.layer(font.default_source()); layer.add_contour(square(0, 0, 10)); \
                 assert_eq!(layer.contours().len(), {value}); assert!(layer.is_closed()); }}"
            )
        };
        let source = format!(
            "#[cfg(test)] mod tests {{ {} {} }}",
            test("adds_one", 1),
            test("adds_two", 2)
        );
        let kinds: Vec<_> = unit_findings(&source, &[])
            .into_iter()
            .map(|(kind, _)| kind)
            .collect();
        assert_eq!(kinds, [Kind::NearDuplicateTests, Kind::NearDuplicateTests]);
    }

    #[test]
    fn setup_shared_by_five_tests_is_reported_at_each() {
        let tests: String = (0..SETUP_COPIES)
            .map(|index| format!("#[test] fn t{index}() {{ let font = Font::new(); let id = font.add(); check({index}); }}"))
            .collect();
        let source =
            format!("#[cfg(test)] mod tests {{ {tests} #[test] fn other() {{ a(); b(); c(); }} }}");
        let syntax = syn::parse_file(&source).unwrap();
        let setups = TestCode::of(Path::new("lib.rs"), &syntax, Role::Library).setups();
        assert_eq!(setup_copies(setups).len(), SETUP_COPIES);
    }

    #[test]
    fn a_helper_in_two_test_files_is_repeated() {
        let mut helpers = Vec::new();
        for path in ["a/tests.rs", "b/tests.rs"] {
            let syntax = syn::parse_file("fn square() {} #[test] fn t() {}").unwrap();
            helpers.extend(TestCode::of(Path::new(path), &syntax, Role::UnitTests).helper_bodies());
        }
        let details: Vec<_> = repeated_helpers(helpers)
            .into_iter()
            .map(|finding| finding.detail)
            .collect();
        assert_eq!(
            details,
            [
                "square is defined in 2 test files: share one in test support",
                "square is defined in 2 test files: share one in test support",
            ]
        );
    }
}
