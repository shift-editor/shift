use std::collections::{BTreeMap, BTreeSet};
use std::io;
use std::path::{Path, PathBuf};

use syn::Item;
use syn::visit::Visit;

use crate::duplicate::{FnBodies, FnBody};
use crate::errors;
use crate::file_scan::{FileScan, InherentMethods};
use crate::finding::{Finding, Kind};
use crate::layout;
use crate::runtime;
use crate::signature;
use crate::syntax;
use crate::test_code::{self, Role, TestCode};
use crate::test_only_pub::NameUses;
use crate::types::{TypeShape, TypeShapes};

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
    /// The file without its test items, for the kinds about library code.
    code: syn::File,
    role: Role,
}

impl SourceFile {
    fn new(path: PathBuf, syntax: syn::File, role: Role) -> Self {
        let code = syntax::without_tests(&syntax);
        Self {
            path,
            syntax,
            code,
            role,
        }
    }
}

/// The source files of one crate: a method candidate's type and a trait
/// candidate's types are only known across all of them.
pub(crate) struct CrateScan {
    root: PathBuf,
    files: Vec<SourceFile>,
}

impl CrateScan {
    /// Parses every `.rs` file under `root` (a crate's `src`) and the crate's
    /// `tests/`, skipping `benches/`. A file that fails to parse is skipped
    /// and named on stderr.
    pub(crate) fn read(root: &Path) -> io::Result<Self> {
        let mut paths = Vec::new();
        Self::collect(root, Role::Library, &mut paths)?;
        if let Some(tests) = root.parent().map(|crate_dir| crate_dir.join("tests"))
            && tests.is_dir()
        {
            Self::collect(&tests, Role::IntegrationTests, &mut paths)?;
        }
        let mut files = Vec::new();
        for (path, role) in paths {
            let text = std::fs::read_to_string(&path)?;
            match syn::parse_file(&text) {
                Ok(syntax) => files.push(SourceFile::new(path, syntax, role)),
                Err(error) => eprintln!("shift-scan: skipped {}: {error}", path.display()),
            }
        }
        Ok(Self {
            root: root.to_path_buf(),
            files,
        })
    }

    /// Gathers the `.rs` files under `dir`. Under `src`, a `tests/` directory
    /// and files named `tests.rs`, `*_tests.rs` or `test_support.rs` are
    /// unit tests.
    fn collect(dir: &Path, role: Role, paths: &mut Vec<(PathBuf, Role)>) -> io::Result<()> {
        let mut entries: Vec<_> = std::fs::read_dir(dir)?
            .map(|entry| entry.map(|entry| entry.path()))
            .collect::<io::Result<_>>()?;
        entries.sort();
        for path in entries {
            let name = path
                .file_name()
                .and_then(|name| name.to_str())
                .unwrap_or_default();
            if path.is_dir() {
                if !["target", "benches"].contains(&name) {
                    let inner = match role {
                        Role::Library if name == "tests" => Role::UnitTests,
                        role => role,
                    };
                    Self::collect(&path, inner, paths)?;
                }
            } else if name.ends_with(".rs") {
                let unit_tests = name.ends_with("tests.rs") || name == "test_support.rs";
                let file_role = match role {
                    Role::Library if unit_tests => Role::UnitTests,
                    role => role,
                };
                paths.push((path, file_role));
            }
        }
        Ok(())
    }

    fn library_files(&self) -> impl Iterator<Item = &SourceFile> {
        self.files.iter().filter(|file| file.role == Role::Library)
    }

    /// Every non-test function body, for comparing across crates.
    pub(crate) fn bodies(&self) -> Vec<FnBody> {
        let mut bodies = Vec::new();
        for file in self.library_files() {
            let mut collector = FnBodies::new(&file.path);
            collector.visit_file(&file.syntax);
            bodies.extend(collector.found);
        }
        bodies
    }

    /// Every test helper's body, for comparing across test files.
    pub(crate) fn test_helper_bodies(&self) -> Vec<FnBody> {
        self.files
            .iter()
            .flat_map(|file| TestCode::of(&file.path, &file.syntax, file.role).helper_bodies())
            .collect()
    }

    /// The names this crate's library and test code define and use.
    pub(crate) fn name_uses(&self) -> NameUses {
        let mut uses = NameUses::default();
        for file in &self.files {
            uses.add_file(&file.path, &file.syntax, &file.code, file.role);
        }
        uses
    }

    /// Function names only non-`pub` definitions in library code have.
    fn private_fns(&self) -> BTreeSet<String> {
        let mut visibility = PrivateFns::default();
        for file in self.library_files() {
            visibility.visit_file(&file.code);
        }
        visibility
            .private
            .difference(&visibility.visible)
            .cloned()
            .collect()
    }

    /// The kinds about test code that one crate decides.
    fn test_findings(&self) -> Vec<Finding> {
        let private = self.private_fns();
        let mut findings = Vec::new();
        let mut setups = Vec::new();
        for file in &self.files {
            let code = TestCode::of(&file.path, &file.syntax, file.role);
            findings.extend(code.findings(&private));
            setups.extend(code.setups());
        }
        findings.extend(test_code::setup_copies(setups));
        findings
    }

    /// Every library struct and enum, for comparing across crates.
    pub(crate) fn type_shapes(&self) -> Vec<TypeShape> {
        self.library_files()
            .flat_map(|file| TypeShapes::of(&file.path, &file.code))
            .collect()
    }

    /// Structs and enums declared at the top level of any file.
    fn crate_types(&self) -> BTreeSet<String> {
        let mut types = BTreeSet::new();
        for file in self.library_files() {
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
        for file in self.library_files() {
            let mut scan = FileScan::new(&file.path, &crate_types, &mut inherent_methods);
            scan.visit_file(&file.syntax);
            findings.extend(scan.findings);
            findings.extend(Self::repeated_error_mappings(scan.error_mappings));
            findings.extend(signature::findings(&file.path, &file.code));
            findings.extend(errors::findings(&file.path, &file.code));
            findings.extend(runtime::findings(&file.path, &file.code));
            findings.extend(layout::large_inline_tests(&file.path, &file.syntax));
        }
        findings.extend(self.trait_candidates(&inherent_methods));
        findings.extend(self.crate_header());
        findings.extend(self.test_findings());
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

    /// The crate root's missing header, if it has one to miss.
    fn crate_header(&self) -> Option<Finding> {
        let roots = [self.root.join("lib.rs"), self.root.join("main.rs")];
        let root = self.files.iter().find(|file| roots.contains(&file.path))?;
        layout::crate_header(&root.path, &root.syntax)
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

/// Free functions and inherent methods by name: `pub`, or anything less
/// (`pub(crate)` included), which only the crate's own tests can reach.
#[derive(Default)]
struct PrivateFns {
    private: BTreeSet<String>,
    visible: BTreeSet<String>,
}

impl PrivateFns {
    fn record(&mut self, sig: &syn::Signature, vis: &syn::Visibility) {
        let names = if matches!(vis, syn::Visibility::Public(_)) {
            &mut self.visible
        } else {
            &mut self.private
        };
        names.insert(sig.ident.to_string());
    }
}

impl<'ast> Visit<'ast> for PrivateFns {
    fn visit_item_fn(&mut self, function: &'ast syn::ItemFn) {
        self.record(&function.sig, &function.vis);
        syn::visit::visit_item_fn(self, function);
    }

    fn visit_item_impl(&mut self, item: &'ast syn::ItemImpl) {
        if item.trait_.is_some() {
            // Trait methods are reached through the trait; every name is visible.
            for member in &item.items {
                if let syn::ImplItem::Fn(method) = member {
                    self.visible.insert(method.sig.ident.to_string());
                }
            }
            return;
        }
        for member in &item.items {
            if let syn::ImplItem::Fn(method) = member {
                self.record(&method.sig, &method.vis);
            }
        }
        syn::visit::visit_item_impl(self, item);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn findings(source: &str) -> Vec<(Kind, String)> {
        let file = SourceFile::new(
            PathBuf::from("lib.rs"),
            syn::parse_file(source).unwrap(),
            Role::Library,
        );
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

    #[test]
    fn a_collect_turbofish_where_the_type_is_known_is_reported() {
        let found = findings(
            "fn names(xs: &[X]) -> Vec<String> {
                 let glyphs = Glyphs { ids: xs.iter().map(id).collect::<Vec<_>>() };
                 store(xs.iter().collect::<Vec<_>>());
                 let boxed = xs.iter().map(h).collect::<Result<Vec<_>, _>>()?.into_boxed_slice();
                 xs.iter().map(name).collect::<Vec<_>>()
             }",
        );
        let details: Vec<_> = found.into_iter().map(|(_, detail)| detail).collect();
        assert_eq!(
            details,
            [
                "`collect::<Vec<_>>()` as the return value, whose type `collect()` infers",
                "`collect::<Vec<_>>()` as a field, whose type `collect()` infers",
                "`collect::<Vec<_>>()` as an argument, whose type `collect()` infers",
                "`collect::<Vec<_>>()` only to call `into_boxed_slice`: collect into `Box<[_]>`",
            ]
        );
    }

    #[test]
    fn a_collect_turbofish_the_type_needs_is_not_reported() {
        let found = findings(
            "fn f() {
                 let ids = xs.iter().collect::<Vec<_>>();
                 let text = xs.iter().map(name).collect::<Vec<_>>().join(\", \");
                 let glyphs = Glyphs { ids: xs.iter().map(id).collect::<Result<Vec<_>, _>>()? };
                 let direct: Box<[_]> = xs.iter().collect();
             }",
        );
        assert!(found.is_empty());
    }
}
