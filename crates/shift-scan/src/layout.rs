//! Kinds about how a crate is laid out: crate roots without a `//!` header
//! and inline test modules grown past a page.

use std::path::Path;

use syn::visit::{self, Visit};

use crate::finding::{Finding, Kind, Report};
use crate::syntax;

/// Lines an inline test module may have before it moves to a sibling
/// `tests.rs`.
const INLINE_TEST_LINES: usize = 300;

/// A crate root (`lib.rs`, `main.rs`) with no `//!` header.
pub(crate) fn crate_header(path: &Path, syntax: &syn::File) -> Option<Finding> {
    let has_header = syntax.attrs.iter().any(|attr| attr.path().is_ident("doc"));
    (!has_header).then(|| Finding {
        path: path.to_path_buf(),
        line: 1,
        kind: Kind::CrateHeader,
        detail: "no `//!` header: say what the crate is for".to_string(),
    })
}

/// Inline `#[cfg(test)]` modules over [`INLINE_TEST_LINES`].
pub(crate) fn large_inline_tests(path: &Path, syntax: &syn::File) -> Vec<Finding> {
    let mut modules = InlineTests {
        report: Report::new(path),
    };
    modules.visit_file(syntax);
    modules.report.found
}

struct InlineTests<'a> {
    report: Report<'a>,
}

impl<'ast> Visit<'ast> for InlineTests<'_> {
    fn visit_item_mod(&mut self, module: &'ast syn::ItemMod) {
        let Some((brace, _)) = &module.content else {
            return;
        };
        let lines = syntax::line_count(brace.span.join());
        if syntax::is_test(&module.attrs) && lines > INLINE_TEST_LINES {
            let detail = format!(
                "mod {} is {lines} lines inline: move it to a sibling `tests.rs`",
                module.ident
            );
            self.report
                .add(Kind::LargeInlineTests, module.ident.span(), detail);
            return;
        }
        visit::visit_item_mod(self, module);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_crate_root_without_a_header_is_reported() {
        let bare = syn::parse_file("pub mod font;").unwrap();
        let documented = syn::parse_file("//! The font model.\npub mod font;").unwrap();
        assert!(crate_header(Path::new("lib.rs"), &bare).is_some());
        assert!(crate_header(Path::new("lib.rs"), &documented).is_none());
    }

    #[test]
    fn an_inline_test_module_over_a_page_is_reported() {
        let tests = "#[test] fn t() {}\n".repeat(INLINE_TEST_LINES);
        let source = format!(
            "fn f() {{}}\n#[cfg(test)]\nmod tests {{\n{tests}}}\n#[cfg(test)] mod small {{ }}"
        );
        let syntax = syn::parse_file(&source).unwrap();
        let found: Vec<_> = large_inline_tests(Path::new("lib.rs"), &syntax)
            .into_iter()
            .map(|finding| (finding.line, finding.detail))
            .collect();
        assert_eq!(
            found,
            [(
                3,
                "mod tests is 302 lines inline: move it to a sibling `tests.rs`".to_string()
            )]
        );
    }
}
