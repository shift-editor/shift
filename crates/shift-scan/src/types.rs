//! Types declared more than once: the same shape under two names
//! (`duplicate-type`), or one name for two types (`type-name-collision`).
//!
//! A shape is the set of a struct's field names or an enum's variant names.
//! Two structs, or two enums, are alike when one's set is the other's, or
//! they share at least [`SAME_MEMBERS`] of the larger set. Tuple and unit
//! structs, and types with fewer than [`MIN_MEMBERS`] members, have no shape
//! worth comparing.

use std::collections::{BTreeMap, BTreeSet};
use std::path::{Path, PathBuf};

use syn::visit::{self, Visit};
use syn::{Fields, Item};

use crate::finding::{Finding, Kind};

/// Fields or variants a type needs before its shape is compared.
const MIN_MEMBERS: usize = 2;
/// Share of the larger type's members two types must have in common.
const SAME_MEMBERS: f64 = 0.8;
/// Alike types named in one finding before the rest are counted.
const NAMED: usize = 4;

/// Whether a shape is a struct's fields or an enum's variants; only shapes of
/// one form are compared.
#[derive(Clone, Copy, PartialEq, Eq)]
enum Form {
    Struct,
    Enum,
}

/// One struct or enum declared in library code.
pub(crate) struct TypeShape {
    path: PathBuf,
    line: usize,
    name: String,
    form: Form,
    members: BTreeSet<String>,
}

impl TypeShape {
    fn place(&self) -> String {
        format!("{} ({}:{})", self.name, self.path.display(), self.line)
    }
}

/// Collects one file's structs and enums.
pub(crate) struct TypeShapes<'a> {
    path: &'a Path,
    pub(crate) found: Vec<TypeShape>,
}

impl<'a> TypeShapes<'a> {
    pub(crate) fn of(path: &'a Path, code: &syn::File) -> Vec<TypeShape> {
        let mut shapes = Self {
            path,
            found: Vec::new(),
        };
        shapes.visit_file(code);
        shapes.found
    }

    fn add(&mut self, ident: &syn::Ident, form: Form, members: BTreeSet<String>) {
        self.found.push(TypeShape {
            path: self.path.to_path_buf(),
            line: ident.span().start().line,
            name: ident.to_string(),
            form,
            members,
        });
    }
}

impl<'ast> Visit<'ast> for TypeShapes<'_> {
    fn visit_item(&mut self, item: &'ast Item) {
        match item {
            Item::Struct(item) => {
                let members = match &item.fields {
                    Fields::Named(fields) => fields
                        .named
                        .iter()
                        .filter_map(|field| field.ident.as_ref().map(ToString::to_string))
                        .collect(),
                    Fields::Unnamed(_) | Fields::Unit => BTreeSet::new(),
                };
                self.add(&item.ident, Form::Struct, members);
            }
            Item::Enum(item) => {
                let members = item
                    .variants
                    .iter()
                    .map(|variant| variant.ident.to_string())
                    .collect();
                self.add(&item.ident, Form::Enum, members);
            }
            _ => {}
        }
        visit::visit_item(self, item);
    }
}

/// Every scanned crate's types, compared with each other.
pub(crate) struct DuplicateTypes {
    shapes: Vec<TypeShape>,
}

impl DuplicateTypes {
    pub(crate) fn new(shapes: Vec<TypeShape>) -> Self {
        Self { shapes }
    }

    pub(crate) fn findings(&self) -> Vec<Finding> {
        let mut findings = self.alike_shapes();
        findings.extend(self.name_collisions());
        findings
    }

    /// One finding per type alike any other, naming the others.
    fn alike_shapes(&self) -> Vec<Finding> {
        let comparable: Vec<_> = self
            .shapes
            .iter()
            .enumerate()
            .filter(|(_, shape)| shape.members.len() >= MIN_MEMBERS)
            .collect();
        let mut holders: BTreeMap<&str, Vec<usize>> = BTreeMap::new();
        for (index, shape) in &comparable {
            for member in &shape.members {
                holders.entry(member).or_default().push(*index);
            }
        }
        let mut shared: BTreeMap<(usize, usize), usize> = BTreeMap::new();
        for holding in holders.values() {
            for (position, left) in holding.iter().enumerate() {
                for right in &holding[position + 1..] {
                    *shared.entry((*left, *right)).or_default() += 1;
                }
            }
        }
        let mut alike: BTreeMap<usize, Vec<usize>> = BTreeMap::new();
        for ((left, right), count) in shared {
            if self.are_alike(left, right, count) {
                alike.entry(left).or_default().push(right);
                alike.entry(right).or_default().push(left);
            }
        }
        alike
            .into_iter()
            .map(|(index, others)| self.alike_finding(index, &others))
            .collect()
    }

    fn are_alike(&self, left: usize, right: usize, shared: usize) -> bool {
        let (left, right) = (&self.shapes[left], &self.shapes[right]);
        let larger = left.members.len().max(right.members.len());
        let same_form = left.form == right.form;
        same_form && shared as f64 / larger as f64 >= SAME_MEMBERS
    }

    fn alike_finding(&self, index: usize, others: &[usize]) -> Finding {
        let shape = &self.shapes[index];
        let mut places: Vec<_> = others
            .iter()
            .take(NAMED)
            .map(|other| self.shapes[*other].place())
            .collect();
        if others.len() > NAMED {
            places.push(format!("{} more", others.len() - NAMED));
        }
        let members: Vec<_> = shape.members.iter().map(String::as_str).collect();
        Finding {
            path: shape.path.clone(),
            line: shape.line,
            kind: Kind::DuplicateType,
            detail: format!(
                "{} {{{}}} is alike {}",
                shape.name,
                members.join(", "),
                places.join(", ")
            ),
        }
    }

    /// One finding per declaration of a name declared more than once.
    fn name_collisions(&self) -> Vec<Finding> {
        let mut by_name: BTreeMap<&str, Vec<&TypeShape>> = BTreeMap::new();
        for shape in &self.shapes {
            by_name.entry(&shape.name).or_default().push(shape);
        }
        let mut findings = Vec::new();
        for (name, declared) in by_name
            .into_iter()
            .filter(|(_, declared)| declared.len() > 1)
        {
            for shape in &declared {
                let elsewhere: Vec<_> = declared
                    .iter()
                    .filter(|other| other.path != shape.path || other.line != shape.line)
                    .map(|other| format!("{}:{}", other.path.display(), other.line))
                    .collect();
                findings.push(Finding {
                    path: shape.path.clone(),
                    line: shape.line,
                    kind: Kind::TypeNameCollision,
                    detail: format!("{name} is also declared at {}", elsewhere.join(", ")),
                });
            }
        }
        findings
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn findings(files: &[(&str, &str)]) -> Vec<(Kind, String)> {
        let mut shapes = Vec::new();
        for (path, source) in files {
            let code = syn::parse_file(source).unwrap();
            shapes.extend(TypeShapes::of(Path::new(path), &code));
        }
        DuplicateTypes::new(shapes)
            .findings()
            .into_iter()
            .map(|finding| (finding.kind, finding.detail))
            .collect()
    }

    #[test]
    fn types_with_the_same_fields_are_alike_across_files() {
        let found = findings(&[
            (
                "check.rs",
                "struct Extent { min_x: f64, min_y: f64, max_x: f64, max_y: f64 }",
            ),
            (
                "wasm.rs",
                "struct SegmentBounds { min_x: f64, min_y: f64, max_x: f64, max_y: f64, closed: bool }",
            ),
            ("cli.rs", "struct Report { min_x: f64, name: String }"),
        ]);
        assert_eq!(
            found,
            [
                (
                    Kind::DuplicateType,
                    "Extent {max_x, max_y, min_x, min_y} is alike SegmentBounds (wasm.rs:1)"
                        .to_string()
                ),
                (
                    Kind::DuplicateType,
                    "SegmentBounds {closed, max_x, max_y, min_x, min_y} is alike Extent (check.rs:1)"
                        .to_string()
                ),
            ]
        );
    }

    #[test]
    fn enums_compare_variants_and_never_match_structs() {
        let found = findings(&[(
            "lib.rs",
            "enum Direction { Ltr, Rtl } enum TextDirection { Ltr, Rtl }
             struct Pair { ltr: u8, rtl: u8 } struct Unit; struct Id(u32);",
        )]);
        let kinds: Vec<_> = found.into_iter().map(|(kind, _)| kind).collect();
        assert_eq!(kinds, [Kind::DuplicateType, Kind::DuplicateType]);
    }

    #[test]
    fn a_name_declared_twice_is_a_collision_at_each() {
        let found = findings(&[
            ("proof.rs", "struct ShapedRun { glyphs: Vec<u32> }"),
            ("text.rs", "enum ShapedRun { Empty }"),
        ]);
        assert_eq!(
            found,
            [
                (
                    Kind::TypeNameCollision,
                    "ShapedRun is also declared at text.rs:1".to_string()
                ),
                (
                    Kind::TypeNameCollision,
                    "ShapedRun is also declared at proof.rs:1".to_string()
                ),
            ]
        );
    }
}
