use std::collections::{BTreeMap, BTreeSet};
use std::io;
use std::path::{Path, PathBuf};

use syn::Item;
use syn::visit::Visit;

use crate::file_scan::{FileScan, InherentMethods};
use crate::finding::{Finding, Kind};

/// Types this many or more must share a method for it to suggest a trait.
const TRAIT_TYPES: usize = 3;
/// A file needs to build one error this many times before it's worth a helper.
const ERROR_MAPPING_REPEATS: usize = 3;
/// Method names too generic to suggest a trait.
const GENERIC_METHODS: [&str; 8] = [
    "new", "len", "is_empty", "iter", "id", "get", "as_str", "from_str",
];

/// One parsed source file.
struct SourceFile {
    path: PathBuf,
    syntax: syn::File,
}

/// The source files of one crate: a method candidate's type and a trait
/// candidate's types are only known across all of them.
pub(crate) struct CrateScan {
    root: PathBuf,
    files: Vec<SourceFile>,
}

impl CrateScan {
    /// Parses every `.rs` file under `root`, skipping `tests/`, `benches/`
    /// and test modules kept in their own files. A file that fails to parse is
    /// skipped and named on stderr.
    pub(crate) fn read(root: &Path) -> io::Result<Self> {
        let mut paths = Vec::new();
        Self::collect(root, &mut paths)?;
        let mut files = Vec::new();
        for path in paths {
            let text = std::fs::read_to_string(&path)?;
            match syn::parse_file(&text) {
                Ok(syntax) => files.push(SourceFile { path, syntax }),
                Err(error) => eprintln!("shift-scan: skipped {}: {error}", path.display()),
            }
        }
        Ok(Self {
            root: root.to_path_buf(),
            files,
        })
    }

    fn collect(dir: &Path, paths: &mut Vec<PathBuf>) -> io::Result<()> {
        for entry in std::fs::read_dir(dir)? {
            let path = entry?.path();
            let name = path
                .file_name()
                .and_then(|name| name.to_str())
                .unwrap_or_default();
            if path.is_dir() {
                if !["target", "tests", "benches"].contains(&name) {
                    Self::collect(&path, paths)?;
                }
            } else if name.ends_with(".rs")
                && !name.ends_with("tests.rs")
                && name != "test_support.rs"
            {
                paths.push(path);
            }
        }
        Ok(())
    }

    /// Structs and enums declared at the top level of any file.
    fn crate_types(&self) -> BTreeSet<String> {
        let mut types = BTreeSet::new();
        for file in &self.files {
            for item in &file.syntax.items {
                match item {
                    Item::Struct(item) => types.insert(item.ident.to_string()),
                    Item::Enum(item) => types.insert(item.ident.to_string()),
                    _ => false,
                };
            }
        }
        types
    }

    pub(crate) fn findings(&self) -> Vec<Finding> {
        let crate_types = self.crate_types();
        let mut inherent_methods = InherentMethods::new();
        let mut findings = Vec::new();
        for file in &self.files {
            let mut scan = FileScan::new(&file.path, &crate_types, &mut inherent_methods);
            scan.visit_file(&file.syntax);
            findings.extend(scan.findings);
            findings.extend(Self::repeated_error_mappings(scan.error_mappings));
        }
        findings.extend(self.trait_candidates(&inherent_methods));
        findings
    }

    /// Reports an error a file builds often enough to want one helper, once,
    /// at its first use.
    fn repeated_error_mappings(mappings: BTreeMap<String, Vec<Finding>>) -> Vec<Finding> {
        let mut findings = Vec::new();
        for (built, uses) in mappings {
            let Some(first) = uses.first().filter(|_| uses.len() >= ERROR_MAPPING_REPEATS) else {
                continue;
            };
            findings.push(Finding {
                detail: format!(
                    "this file builds `{built}` {} times, e.g. {}",
                    uses.len(),
                    first.detail
                ),
                ..first.clone()
            });
        }
        findings
    }

    fn trait_candidates(&self, inherent_methods: &InherentMethods) -> Vec<Finding> {
        let mut findings = Vec::new();
        for ((name, arity), types) in inherent_methods {
            if types.len() < TRAIT_TYPES || GENERIC_METHODS.contains(&name.as_str()) {
                continue;
            }
            let types: Vec<_> = types.iter().map(String::as_str).collect();
            let detail = format!(
                "{name}/{arity} on {} types: {}",
                types.len(),
                types.join(", ")
            );
            findings.push(Finding {
                path: self.root.clone(),
                line: 0,
                kind: Kind::TraitCandidate,
                detail,
            });
        }
        findings
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn findings(source: &str) -> Vec<(Kind, String)> {
        let file = SourceFile {
            path: PathBuf::from("lib.rs"),
            syntax: syn::parse_file(source).unwrap(),
        };
        let scan = CrateScan {
            root: PathBuf::from("crate"),
            files: vec![file],
        };
        scan.findings()
            .into_iter()
            .map(|finding| (finding.kind, finding.detail))
            .collect()
    }

    #[test]
    fn a_free_function_taking_a_crate_type_first_is_a_method_candidate() {
        let found = findings("struct Font; fn charset(font: &Font) {} fn parse(text: &str) {}");
        assert_eq!(
            found,
            [(
                Kind::MethodCandidate,
                "charset takes Font first".to_string()
            )]
        );
    }

    #[test]
    fn a_public_method_on_three_types_is_a_trait_candidate() {
        let found = findings(
            "struct A; struct B; struct C;
             impl A { pub fn lib(&self) {} } impl B { pub fn lib(&self) {} } impl C { pub fn lib(&self) {} }",
        );
        assert_eq!(
            found,
            [(
                Kind::TraitCandidate,
                "lib/1 on 3 types: A, B, C".to_string()
            )]
        );
    }

    #[test]
    fn a_chain_is_reported_once_at_its_outermost_call() {
        let found = findings(
            "fn f() { let names = font.glyphs().iter().filter(kept).map(name).rev().collect(); }",
        );
        assert_eq!(
            found,
            [(
                Kind::LongChain,
                "6 steps over 1 lines: glyphs.iter.filter.map.rev.collect".to_string()
            )]
        );
    }

    #[test]
    fn an_ordinary_iterator_chain_is_not_long() {
        let found = findings("fn f() { let ids = points.iter().filter_map(id).collect(); }");
        assert!(found.is_empty());
    }

    #[test]
    fn a_long_builder_chain_is_not_reported() {
        let found = findings(
            "fn f() { let styles = Styles::new().header(a).usage(b).literal(c).placeholder(d).error(e).valid(f); }",
        );
        assert!(found.is_empty());
    }

    #[test]
    fn a_function_taking_an_argument_bundle_is_a_handler() {
        let found = findings("struct AddGlyphArgs; fn add_glyph(args: AddGlyphArgs) {}");
        assert!(found.is_empty());
    }

    #[test]
    fn a_conversion_reading_fields_off_its_parameter_is_reported() {
        let found = findings(
            "struct Glyph; struct Record;
             impl From<Glyph> for Record {
                 fn from(glyph: Glyph) -> Self {
                     Self { id: glyph.id.into(), name: glyph.name, advance: glyph.metrics.advance, points: glyph.points.clone(), kind: Kind::Base }
                 }
             }",
        );
        assert_eq!(
            found,
            [(
                Kind::FieldCopyConversion,
                "impl From for Record: 4 of 5 fields read straight off `glyph`".to_string()
            )]
        );
    }

    #[test]
    fn a_conversion_computing_its_fields_is_not_reported() {
        let found = findings(
            "struct Workspace; struct State;
             impl From<&Workspace> for State {
                 fn from(workspace: &Workspace) -> Self {
                     Self { dirty: workspace.is_dirty(), kind: kind_of(workspace), target: None, id: workspace.id().to_string() }
                 }
             }",
        );
        assert!(found.is_empty());
    }

    #[test]
    fn an_error_built_three_times_in_a_file_is_reported_once() {
        let once = findings("fn f() { a.ok_or_else(|| invalid(\"a\")); }");
        assert!(once.is_empty());

        let repeated = findings(
            "fn f() { a.ok_or_else(|| invalid(\"a\")); b.map_err(|e| invalid(&e)); c.ok_or_else(|| invalid(\"c\")); d.map_err(|e| other(e)); }",
        );
        assert_eq!(
            repeated,
            [(
                Kind::RepeatedErrorMapping,
                "this file builds `invalid` 3 times, e.g. .ok_or_else(|| invalid(\"a\"))"
                    .to_string()
            )]
        );
    }

    #[test]
    fn test_modules_are_skipped() {
        let found = findings("struct Font; #[cfg(test)] mod tests { fn helper(font: &Font) {} }");
        assert!(found.is_empty());
    }
}
